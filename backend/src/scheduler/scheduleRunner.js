const { COMMANDS } = require("../device/pelco");
const schedulesRepo = require("../db/schedulesRepo");
const tracksRepo = require("../db/tracksRepo");

const DEFAULT_DWELL_MS = 800; // matches the frontend's manual-playback default
// Must stay in sync with frontend/src/constants.js DWELL_KEEPALIVE_MS - the device firmware
// auto-drives to its own hardware preset after ~45-50s with no move command (confirmed live,
// see PROJECT_CONTEXT.md); resending the current goto-angle at this interval during any long
// dwell keeps it from ever going idle that long. Schedules can now carry a per-track
// loopDwellMs (see tracksRepo.js) that's long enough to hit this, so this needs the same
// protection the frontend's manual Play already has (App.jsx scheduleDwell).
const DWELL_KEEPALIVE_MS = 20000;

// Runs schedules independent of any frontend connection - the backend process itself
// checks the clock and drives the device directly via deviceClient, so schedules keep
// working even if no browser is ever connected (see PROJECT_CONTEXT.md discussion:
// this replaces the old client-side setInterval(checkSchedules) that died the moment
// the browser tab closed and couldn't resume correctly even on reconnect).
function createScheduleRunner({ deviceClient, activityLogRepo }) {
  const activeSessions = new Map(); // scheduleId -> session

  function isWithinWindow(hm, startTime, endTime) {
    const start = startTime.slice(0, 5);
    const end = endTime.slice(0, 5);
    return start <= hm && hm < end;
  }

  function log(eventType, extra) {
    activityLogRepo.insert({ eventType, source: "schedule", ...extra }).catch((err) => {
      console.error("activity_log insert failed:", err.message);
    });
  }

  // Waits out `dwellMs` at `waypoint`. If longer than DWELL_KEEPALIVE_MS, periodically
  // resends the same goto-angle as a keep-alive (see DWELL_KEEPALIVE_MS comment above) -
  // mirrors frontend/src/App.jsx's scheduleDwell(). session._dwellResolve/session.dwellTimer
  // always point at the CURRENT pending wait so stopSession() can cancel/wake it at any
  // point in the tick chain, not just the final leg.
  function dwellWait(session, waypoint, dwellMs) {
    return new Promise((resolve) => {
      const deadline = Date.now() + dwellMs;
      function tick() {
        if (session.interrupted) { resolve(); return; }
        const remaining = deadline - Date.now();
        session._dwellResolve = resolve;
        if (remaining <= DWELL_KEEPALIVE_MS) {
          session.dwellTimer = setTimeout(() => {
            session.dwellTimer = null;
            session._dwellResolve = null;
            resolve();
          }, Math.max(remaining, 0));
        } else {
          session.dwellTimer = setTimeout(() => {
            session.dwellTimer = null;
            session._dwellResolve = null;
            if (session.interrupted) { resolve(); return; }
            deviceClient.gotoAngleAndWait(waypoint.h, waypoint.v).catch(() => {});
            tick();
          }, DWELL_KEEPALIVE_MS);
        }
      }
      tick();
    });
  }

  async function runSession(scheduleId, session) {
    while (!session.interrupted) {
      const wp = session.waypoints[session.currentIndex];
      // Schedule playback always keeps the laser on for the whole window (like the
      // frontend's manual-latch: manualLaser=true overrides any per-waypoint laser:false)
      // - resend laser-on at every waypoint as a keep-alive, matching goToWaypoint().
      deviceClient.sendCommand(COMMANDS["laser-on"]);
      const result = await deviceClient.gotoAngleAndWait(wp.h, wp.v);
      if (session.interrupted) break;
      if (!result) break; // cancelled by a manual command elsewhere - stop, don't retry
      log("arrived", { angleH: result.pos.h, angleV: result.pos.v });

      // Loop back to waypoint 0 after a full lap uses the track's loopDwellMs ("Diam di
      // awal") instead of the normal per-waypoint dwellMs - mirrors App.jsx's
      // isLoopBackToStart/justLoopedRef exactly.
      const isLoopBackToStart = session.currentIndex === 0 && session.justLooped;
      const dwellMs = isLoopBackToStart ? session.loopDwellMs : session.dwellMs;
      if (isLoopBackToStart) session.justLooped = false;

      await dwellWait(session, wp, dwellMs);
      if (session.interrupted) break;

      const nextIndex = session.currentIndex + 1;
      if (nextIndex >= session.waypoints.length) {
        session.currentIndex = 0;
        session.justLooped = true;
      } else {
        session.currentIndex = nextIndex;
      }
    }
  }

  async function startSession(schedule) {
    if (!deviceClient.isConnected()) return;
    const track = await tracksRepo.getTrack(schedule.track_id);
    if (!track || track.waypoints.length === 0) return;

    const session = {
      waypoints: track.waypoints,
      currentIndex: 0,
      dwellMs: track.dwellMs ?? DEFAULT_DWELL_MS,
      loopDwellMs: track.loopDwellMs ?? DEFAULT_DWELL_MS,
      justLooped: false,
      interrupted: false,
      dwellTimer: null,
      _dwellResolve: null,
    };
    activeSessions.set(schedule.id, session);

    deviceClient.sendCommand(COMMANDS["laser-on"]);
    log("laser_on", { message: `schedule ${schedule.start_time}-${schedule.end_time}` });
    log("schedule_start", { message: `"${track.name}" (${schedule.start_time}-${schedule.end_time})` });

    // Don't await here - the loop runs in the background for the whole window;
    // stopSession() (called from checkSchedules or interruptAllSessions) is what
    // ends it, by flipping session.interrupted and waking the pending dwell wait.
    runSession(schedule.id, session).catch((err) => console.error("scheduleRunner runSession error:", err.message));
  }

  // manual=true: pause in place (user override wins) - the map entry is KEPT (marked
  // interrupted) so the next checkSchedules tick sees "session exists" and does NOT
  // restart it while still inWindow; it's only removed once the window actually ends.
  // manual=false: the window ended (or the schedule was disabled/deleted) - clean up
  // fully and remove the entry so a future window can start fresh.
  function stopSession(scheduleId, session, { manual } = {}) {
    session.interrupted = true;
    if (session.dwellTimer) { clearTimeout(session.dwellTimer); session.dwellTimer = null; }
    if (session._dwellResolve) { session._dwellResolve(); session._dwellResolve = null; }
    if (manual) return;
    deviceClient.sendCommand(COMMANDS["laser-off"]);
    log("laser_off", { message: "schedule window ended" });
    log("schedule_stop", { message: `schedule id=${scheduleId}` });
    activeSessions.delete(scheduleId);
  }

  async function checkSchedules() {
    let schedules;
    try {
      schedules = await schedulesRepo.listSchedules();
    } catch (err) {
      console.error("scheduleRunner: failed to list schedules:", err.message);
      return;
    }
    const now = new Date();
    const hm = now.toTimeString().slice(0, 5);
    const scheduleById = new Map(schedules.map((s) => [s.id, s]));

    // Drop sessions for schedules that got disabled/deleted since we last checked.
    for (const [id, session] of activeSessions) {
      const s = scheduleById.get(id);
      if (!s || !s.enabled) stopSession(id, session, { manual: false });
    }

    for (const s of schedules) {
      if (!s.enabled) continue;
      const inWindow = isWithinWindow(hm, s.start_time, s.end_time);
      const session = activeSessions.get(s.id);
      if (inWindow && !session) {
        startSession(s).catch((err) => console.error("scheduleRunner startSession error:", err.message));
      } else if (!inWindow && session) {
        stopSession(s.id, session, { manual: false });
      }
    }
  }

  let intervalHandle = null;

  return {
    start() {
      if (intervalHandle) return;
      checkSchedules();
      intervalHandle = setInterval(checkSchedules, 10000);
    },
    stop() {
      if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
    },
    getActiveScheduleIds() {
      return [...activeSessions.keys()].filter((id) => !activeSessions.get(id).interrupted);
    },
    // Manual commands from any WS client always win: pause any running schedule session
    // until its time window ends naturally (next check will see !inWindow and clean it
    // up, or the window is still open and it just stays paused - it will NOT immediately
    // restart on the next 10s tick because the map entry is only removed by stopSession).
    interruptAllSessions() {
      for (const [id, session] of activeSessions) {
        if (!session.interrupted) stopSession(id, session, { manual: true });
      }
    },
  };
}

module.exports = { createScheduleRunner };
