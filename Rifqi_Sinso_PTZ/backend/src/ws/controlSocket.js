const { COMMANDS } = require("../device/pelco");

// Ported from the root server.js WS handler (same actions, same message shapes) so the
// frontend's WS client needs no protocol changes versus the old bridge. Adds one thing:
// a best-effort activity_log insert on laser/goto/jog actions (fire-and-forget, never
// blocks or throws into the device-control path).
function attachControlSocket(wss, { deviceClient, activityLogRepo, scheduleRunner }) {
  let currentGotoId = 0; // mirrors deviceClient's internal counter for local cancellation bookkeeping

  function logEvent(eventType, extra) {
    if (!activityLogRepo) return;
    activityLogRepo.insert({ eventType, source: "manual", ...extra }).catch((err) => {
      console.error("activity_log insert failed:", err.message);
    });
  }

  wss.on("connection", (ws) => {
    ws.send(JSON.stringify({ type: "status", deviceConnected: deviceClient.isConnected() }));

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (msg.type !== "command") return;

      // Any manual command (anything but a read-only position query) always wins over
      // an automatic schedule session - pause it so the schedule doesn't fight the
      // operator by resuming on the very next 10s check (see scheduleRunner.js).
      if (msg.action !== "query-position" && scheduleRunner) {
        scheduleRunner.interruptAllSessions();
      }

      // Cancel any active goto operation if a stop/jog command is received.
      // NOTE: goto-angle is NOT listed here - gotoAngleAndWait handles its own
      // cancellation internally. Adding it here caused a double-increment race
      // that silently broke position tracking (see root server.js comment).
      if (msg.action === "stop" || msg.action.startsWith("pan-") || msg.action.startsWith("tilt-")) {
        deviceClient.cancelGoto();
        if (msg.action !== "stop") logEvent("jog", { message: msg.action });
      }

      if (msg.action === "goto-angle") {
        if (!deviceClient.isConnected()) {
          ws.send(JSON.stringify({ type: "error", message: "device not connected" }));
          return;
        }
        console.log(`goto-angle H=${msg.h} V=${msg.v} (waiting for arrival via Position Query)`);
        logEvent("goto", { angleH: msg.h, angleV: msg.v });
        deviceClient
          .gotoAngleAndWait(msg.h, msg.v, (pos, gotoId) => {
            ws.send(JSON.stringify({ type: "position", h: pos.h, v: pos.v, target_h: msg.h, target_v: msg.v }));
          })
          .then((result) => {
            if (result) {
              ws.send(JSON.stringify({ type: "arrived", h: result.pos.h, v: result.pos.v }));
              logEvent("arrived", { angleH: result.pos.h, angleV: result.pos.v });
            }
          });
        return;
      }

      if (msg.action === "query-position") {
        if (!deviceClient.isConnected()) {
          ws.send(JSON.stringify({ type: "error", message: "device not connected" }));
          return;
        }
        deviceClient.getPosition().then((pos) => {
          if (pos.h === null || pos.v === null) return; // dropped/timeout reply - don't poison the canvas with null
          ws.send(JSON.stringify({ type: "position", h: pos.h, v: pos.v }));
        });
        return;
      }

      const cmdBytes = COMMANDS[msg.action];
      if (!cmdBytes) {
        ws.send(JSON.stringify({ type: "error", message: `unknown action ${msg.action}` }));
        return;
      }
      if (!deviceClient.isConnected()) {
        ws.send(JSON.stringify({ type: "error", message: "device not connected" }));
        return;
      }
      if (msg.action === "laser-on" || msg.action === "laser-off") {
        logEvent(msg.action === "laser-on" ? "laser_on" : "laser_off", {});
      }
      deviceClient.sendCommand(cmdBytes);
    });
  });
}

module.exports = { attachControlSocket };
