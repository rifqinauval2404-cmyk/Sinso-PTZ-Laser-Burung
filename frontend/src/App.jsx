import { useEffect, useRef, useState, useCallback } from "react";
import { DWELL_KEEPALIVE_MS } from "./constants";
import { useWebSocket } from "./api/useWebSocket";
import { api } from "./api/client";
import StatusBar from "./components/StatusBar";
import JogPad from "./components/JogPad";
import LaserControls from "./components/LaserControls";
import PlaybackPanel from "./components/PlaybackPanel";
import TrackCanvas from "./components/TrackCanvas/TrackCanvas";
import WaypointTable from "./components/WaypointTable";
import ScheduleManager from "./components/ScheduleManager";
import ActivityLog from "./components/ActivityLog";

const INFO_TITLE =
  "Model 3D = bentuk alat: baseplate (coklat, panah 0° = acuan arah pan), badan pan (biru, putar H 0-298°), " +
  "kepala laser (titik + garis merah = moncong laser). Garis lengkung = jangkauan gerak. Klik area jangkauan = " +
  "tambah waypoint, drag titik = geser, klik-kanan titik = hapus (atau tahan di HP). Freehand: tahan + seret. " +
  "Shift+drag, Alt+drag, atau dua jari = putar sudut pandang kamera (tidak menggerakkan alat).";

export default function App() {
  const { bridgeConnected, deviceConnected, sendCommand, onMessage } = useWebSocket();

  const [waypoints, setWaypoints] = useState([]);
  const [manualLaser, setManualLaser] = useState(false);
  const [laserOn, setLaserOn] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [dwellMs, setDwellMs] = useState(800);
  const [loopDwellMs, setLoopDwellMs] = useState(30000);
  const [loop, setLoop] = useState(true);
  const [logLines, setLogLines] = useState([]);
  const [tracks, setTracks] = useState([]);
  const [selectedTrackId, setSelectedTrackId] = useState(null);
  const [schedules, setSchedules] = useState([]);

  const canvasApiRef = useRef(null);

  // Refs mirroring the latest state, read inside WS message handlers / setTimeout
  // callbacks / the schedule-check interval so those closures never see stale values
  // (registered once on mount, same as hmi.html's module-level globals were always
  // "live" reads).
  const waypointsRef = useRef(waypoints); waypointsRef.current = waypoints;
  const manualLaserRef = useRef(manualLaser); manualLaserRef.current = manualLaser;
  const laserOnRef = useRef(laserOn); laserOnRef.current = laserOn;
  const playingRef = useRef(playing); playingRef.current = playing;
  const dwellMsRef = useRef(dwellMs); dwellMsRef.current = dwellMs;
  const loopDwellMsRef = useRef(loopDwellMs); loopDwellMsRef.current = loopDwellMs;
  const loopRef = useRef(loop); loopRef.current = loop;
  const playTargetRef = useRef(-1);
  const playTimerRef = useRef(null);
  // set inside nextIndex() when it wraps back to index 0 - lets the "arrived" handler
  // tell "just started playing, first visit to waypoint 0" apart from "finished a full
  // lap and looped back to the start", so only the latter uses loopDwellMs.
  const justLoopedRef = useRef(false);
  // 'moving' while waiting for the arrival of a REAL goToWaypoint() transition, 'dwelling'
  // during the post-arrival wait (which may itself send keep-alive goto-angle resends - see
  // scheduleDwell). The "arrived" handler only advances playback when this is 'moving'; a
  // keep-alive's own "arrived" reply arrives while still 'dwelling' and is ignored, so it
  // can't spawn a second, overlapping dwell-then-advance chain.
  const playPhaseRef = useRef("idle");
  // While a track is playing, holds a Screen Wake Lock so the OS doesn't sleep mid-track -
  // a long "Diam di awal" dwell has no mouse/keyboard activity at all, and on a laptop with
  // a short sleep timer the whole system (not just the browser tab) can suspend mid-dwell,
  // freezing every JS timer (including the keep-alive above) until it wakes back up with
  // stale/confused timing - confirmed as a real-world cause of "gerakan aneh" after a loop.
  const wakeLockRef = useRef(null);

  async function acquireWakeLock() {
    if (!("wakeLock" in navigator)) return;
    try {
      wakeLockRef.current = await navigator.wakeLock.request("screen");
    } catch (err) {
      log("Wake Lock tidak aktif (" + err.message + ") - pastikan PC tidak sleep sendiri saat track panjang berjalan");
    }
  }
  function releaseWakeLock() {
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
  }
  useEffect(() => {
    // the browser auto-releases the wake lock when the tab is hidden - re-acquire it once
    // the tab becomes visible again if a track is still playing.
    function onVisibilityChange() {
      if (document.visibilityState === "visible" && playingRef.current && !wakeLockRef.current) {
        acquireWakeLock();
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const log = useCallback((msg) => {
    const time = new Date().toLocaleTimeString();
    setLogLines((prev) => [`[${time}] ${msg}`, ...prev]);
  }, []);

  useEffect(() => {
    log("HMI build: react-backend-1 (2026-07-07)");
    api.listActivityLog({ limit: 50 }).then((rows) => {
      setLogLines((prev) => [
        ...prev,
        ...rows.map((r) => `[${new Date(r.occurred_at).toLocaleTimeString()}] (db) ${r.event_type}${r.message ? ": " + r.message : ""}`),
      ]);
    }).catch(() => {});
    refreshTracks();
    refreshSchedules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function refreshTracks() {
    api.listTracks().then(setTracks).catch((err) => log("Gagal load tracks: " + err.message));
  }
  function refreshSchedules() {
    api.listSchedules().then(setSchedules).catch((err) => log("Gagal load jadwal: " + err.message));
  }

  function handleMarkWaypointFromManual() {
    const added = canvasApiRef.current?.addWaypointFromSim();
    log(added ? "Titik ditandai dari posisi manual saat ini" : "Gagal tandai titik: posisi device belum diketahui (gerakkan jog dulu)");
  }

  // --- laser: manual buttons latch the state (playback never overrides a manual ON) ---
  const setLaser = useCallback((on) => {
    setManualLaser(on);
    setLaserOn(on);
    sendCommand(on ? "laser-on" : "laser-off");
    canvasApiRef.current?.setSimLaser(on);
    log("Laser " + (on ? "ON (latch manual)" : "OFF (manual)"));
  }, [sendCommand, log]);

  // --- playback state machine (ported from hmi.html goToWaypoint/onPositionUpdate/startPlay/stopPlay) ---
  function goToWaypoint(idx) {
    playTargetRef.current = idx;
    playPhaseRef.current = "moving";
    const w = waypointsRef.current[idx];
    const want = manualLaserRef.current || w.laser;
    log(`Goto #${idx + 1}: H=${w.h} V=${w.v}`);
    sendCommand(want ? "laser-on" : "laser-off");
    setLaserOn(want);
    sendCommand("goto-angle", { h: w.h, v: w.v });
  }

  function nextIndex(i) {
    const wps = waypointsRef.current;
    if (i + 1 < wps.length) { justLoopedRef.current = false; return i + 1; }
    if (!loopRef.current) return -1;
    justLoopedRef.current = true;
    return 0;
  }

  function startPlay() {
    if (waypointsRef.current.length === 0) { log("Track kosong"); return; }
    if (playingRef.current) return;
    setPlaying(true);
    playingRef.current = true;
    playPhaseRef.current = "idle";
    log("Mulai play track (mengikuti posisi asli device)");
    acquireWakeLock();
    goToWaypoint(0);
  }

  // Waits out `dwellMs` at the waypoint the device just arrived at. If the wait is longer
  // than DWELL_KEEPALIVE_MS, periodically resends the SAME goto-angle as a keep-alive so
  // the device's own firmware never goes idle long enough to auto-drift to its hardware
  // preset (confirmed live: idle ~45-50s with no move command triggers this - a read-only
  // Position Query does NOT reset the timer, only a real move command does; see
  // PROJECT_CONTEXT.md / constants.js). playPhaseRef stays "dwelling" through the keep-alive
  // resends, so their own "arrived" replies are ignored by the main handler instead of
  // spawning a second, overlapping dwell-then-advance chain.
  function scheduleDwell(currentWaypoint, dwellMs) {
    const deadline = Date.now() + dwellMs;
    function tick() {
      if (!playingRef.current) return;
      const remaining = deadline - Date.now();
      if (remaining <= DWELL_KEEPALIVE_MS) {
        playTimerRef.current = setTimeout(() => {
          if (!playingRef.current) return;
          const ni = nextIndex(playTargetRef.current);
          if (ni < 0) { stopPlay(true); return; }
          goToWaypoint(ni);
        }, Math.max(remaining, 0));
      } else {
        playTimerRef.current = setTimeout(() => {
          if (!playingRef.current) return;
          sendCommand("goto-angle", { h: currentWaypoint.h, v: currentWaypoint.v });
          tick();
        }, DWELL_KEEPALIVE_MS);
      }
    }
    tick();
  }

  function stopPlay(finished) {
    setPlaying(false);
    playingRef.current = false;
    playTargetRef.current = -1;
    playPhaseRef.current = "idle";
    clearTimeout(playTimerRef.current);
    releaseWakeLock();
    sendCommand("stop");
    if (manualLaserRef.current) {
      log("Laser tetap ON (latch manual, matikan lewat tombol Laser OFF)");
    } else if (laserOnRef.current) {
      sendCommand("laser-off");
      setLaserOn(false);
    }
    log(finished ? "Track selesai" : "Track dihentikan");
  }

  useEffect(() => {
    const unsubscribe = onMessage((msg) => {
      if (msg.type === "error") log("Error: " + msg.message);
      if (msg.type === "position" || msg.type === "arrived") {
        const sim = { hx: msg.h, vy: msg.v, laser: canvasApiRef.current?.getSim?.()?.laser ?? laserOnRef.current };
        canvasApiRef.current?.setSim(sim);

        if (
          msg.type === "arrived" &&
          playingRef.current &&
          playTargetRef.current >= 0 &&
          playPhaseRef.current === "moving"
        ) {
          const w = waypointsRef.current[playTargetRef.current];
          const want = manualLaserRef.current || w.laser;
          sendCommand(want ? "laser-on" : "laser-off");
          setLaserOn(want);
          canvasApiRef.current?.setSim({ ...sim, laser: want });
          const isLoopBackToStart = playTargetRef.current === 0 && justLoopedRef.current;
          const dwell = isLoopBackToStart ? loopDwellMsRef.current : dwellMsRef.current;
          if (isLoopBackToStart) justLoopedRef.current = false;
          log(`Sampai #${playTargetRef.current + 1}, dwell ${dwell}ms${isLoopBackToStart ? " (diam di titik awal loop)" : ""}`);
          playPhaseRef.current = "dwelling";
          scheduleDwell(w, dwell);
        }
      }
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onMessage, sendCommand, log]);

  // Schedule triggering itself now lives in the backend (scheduleRunner.js) so it keeps
  // working independent of this browser being connected at all - see PROJECT_CONTEXT.md.
  // The frontend just polls the schedule list periodically to keep the "Berjalan" badge
  // (schedule.active, computed server-side) fresh; it no longer decides when to play/stop.
  useEffect(() => {
    const interval = setInterval(refreshSchedules, 10000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleWaypointsChangeFromCanvas(newWaypoints) {
    setWaypoints(newWaypoints);
  }
  function handleLoadWaypoints(arr) {
    setWaypoints(arr);
    canvasApiRef.current?.setWaypoints(arr);
    log("Track loaded: " + arr.length + " titik");
  }
  function handleDeleteWaypoint(i) {
    const arr = waypoints.filter((_, idx) => idx !== i);
    handleLoadWaypoints(arr);
  }

  function handleSaveAsNewTrack(name) {
    api.createTrack({ name, waypoints, dwellMs, loopDwellMs }).then((track) => {
      log(`Track "${name}" disimpan ke database (${track.waypoints.length} titik)`);
      refreshTracks();
      setSelectedTrackId(track.id);
    }).catch((err) => log("Gagal simpan track: " + err.message));
  }
  function handleUpdateSelectedTrack() {
    const t = tracks.find((x) => String(x.id) === String(selectedTrackId));
    if (!t) return;
    api.updateTrack(selectedTrackId, { name: t.name, waypoints, dwellMs, loopDwellMs }).then(() => {
      log(`Track "${t.name}" diperbarui di database`);
      refreshTracks();
    }).catch((err) => log("Gagal update track: " + err.message));
  }
  function handleDeleteTrack(id) {
    const t = tracks.find((x) => String(x.id) === String(id));
    api.deleteTrack(id).then(() => {
      log(`Track "${t ? t.name : id}" dihapus (jadwal terkait ikut terhapus)`);
      refreshTracks();
      refreshSchedules();
      setSelectedTrackId(null);
    }).catch((err) => log("Gagal hapus track: " + err.message));
  }
  function handleSelectTrack(id) {
    setSelectedTrackId(id);
    if (!id) return;
    api.getTrack(id).then((track) => {
      handleLoadWaypoints(track.waypoints);
      setDwellMs(track.dwellMs);
      setLoopDwellMs(track.loopDwellMs);
    }).catch((err) => log("Gagal load track: " + err.message));
  }

  function handleCreateSchedule(data) {
    api.createSchedule(data).then(() => { refreshSchedules(); log("Jadwal ditambahkan"); })
      .catch((err) => log("Gagal tambah jadwal: " + err.message));
  }
  function handleToggleSchedule(id, enabled) {
    api.updateSchedule(id, { enabled }).then(refreshSchedules)
      .catch((err) => log("Gagal update jadwal: " + err.message));
  }
  function handleDeleteSchedule(id) {
    api.deleteSchedule(id).then(refreshSchedules)
      .catch((err) => log("Gagal hapus jadwal: " + err.message));
  }

  return (
    <div className="wrap">
      <header className="top">
        <div>
          <h1>
            <span className="brand-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3" />
              </svg>
            </span>
            Sinso PTZ Control
          </h1>
          <div className="sub" title="Kendali PTZ + laser + track builder. Backend Node.js + MySQL, ws://.../ws -> TCP Pelco-D.">
            Kendali PTZ + laser + track builder. Backend Node.js + MySQL menggantikan bridge lokal lama, protokol Pelco-D ke device tidak berubah.
          </div>
        </div>
        <StatusBar deviceConnected={bridgeConnected && deviceConnected} />
      </header>

      <div className="bento">
        <div className="sidebar">
          <div className="card gc-manual">
            <div className="card-head">
              <span className="icon-chip chip-indigo">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="12" r="7" /><line x1="12" y1="2" x2="12" y2="5" />
                  <line x1="12" y1="19" x2="12" y2="22" /><line x1="2" y1="12" x2="5" y2="12" /><line x1="19" y1="12" x2="22" y2="12" />
                </svg>
              </span>
              <h3>Kontrol Manual</h3>
            </div>
            <JogPad sendCommand={sendCommand} onMessage={onMessage} />
            <div className="manual-mark-row">
              <button
                className="std"
                onClick={handleMarkWaypointFromManual}
                title="Tandai posisi device saat ini sebagai waypoint baru di Track Builder"
              >
                &#128204; Tandai titik di sini
              </button>
            </div>
            <div className="divider" />
            <LaserControls laserOn={laserOn} onSetLaser={setLaser} />
          </div>

          <PlaybackPanel
            playing={playing}
            onPlay={startPlay}
            onStopPlay={() => stopPlay(false)}
            dwellMs={dwellMs}
            setDwellMs={setDwellMs}
            loopDwellMs={loopDwellMs}
            setLoopDwellMs={setLoopDwellMs}
            loop={loop}
            setLoop={setLoop}
            waypoints={waypoints}
            onLoadWaypoints={handleLoadWaypoints}
            tracks={tracks}
            selectedTrackId={selectedTrackId}
            onSelectTrack={handleSelectTrack}
            onSaveAsNewTrack={handleSaveAsNewTrack}
            onUpdateSelectedTrack={handleUpdateSelectedTrack}
            onDeleteTrack={handleDeleteTrack}
          />
        </div>

        <TrackCanvas
          ref={canvasApiRef}
          initialWaypoints={waypoints}
          manualLaser={manualLaser}
          onWaypointsChange={handleWaypointsChangeFromCanvas}
          infoTitle={INFO_TITLE}
        />

        <ScheduleManager
          schedules={schedules}
          tracks={tracks}
          onCreate={handleCreateSchedule}
          onToggleEnabled={handleToggleSchedule}
          onDelete={handleDeleteSchedule}
        />
        <ActivityLog lines={logLines} />
        <WaypointTable waypoints={waypoints} onDelete={handleDeleteWaypoint} />
      </div>
    </div>
  );
}
