const net = require("net");
const { buildFrame, buildAngleFrame, QUERY_H, QUERY_V } = require("./pelco");

// Ported verbatim from the root server.js device bridge - same timing constants,
// same sequential-query invariant. Do not "optimize" getPosition() to run H/V in
// parallel: the device can only handle one outstanding query at a time, and querying
// both back-to-back makes it silently drop the second reply (position updates stop
// mid-move). See PROJECT_CONTEXT.md.
function createDeviceClient({ deviceIp, devicePort }) {
  let deviceSocket = null;
  let deviceConnected = false;
  let rxBuffer = Buffer.alloc(0);
  let latestByCmd2 = new Map(); // cmd2 -> decoded angle (degrees), updated as frames arrive
  let currentGotoId = 0; // tracking active goto execution to allow cancellation

  function connectDevice() {
    deviceSocket = net.connect(devicePort, deviceIp, () => {
      deviceConnected = true;
      console.log(`Connected to device ${deviceIp}:${devicePort}`);
    });
    deviceSocket.on("data", (chunk) => {
      rxBuffer = Buffer.concat([rxBuffer, chunk]);
      // device frames are 6 (idle) or 7 (FF-prefixed) bytes; scan for FF-prefixed ones and
      // decode angle replies (cmd2 0x59=Angle_H, 0x5b=Angle_V) as soon as they arrive.
      while (rxBuffer.length >= 7) {
        const ffIdx = rxBuffer.indexOf(0xff);
        if (ffIdx < 0) { rxBuffer = Buffer.alloc(0); break; }
        if (ffIdx + 7 > rxBuffer.length) { rxBuffer = rxBuffer.subarray(ffIdx); break; }
        const frame = rxBuffer.subarray(ffIdx, ffIdx + 7);
        const cmd2 = frame[3];
        if (cmd2 === 0x59 || cmd2 === 0x5b) {
          latestByCmd2.set(cmd2, ((frame[4] << 8) | frame[5]) / 100);
        }
        rxBuffer = rxBuffer.subarray(ffIdx + 7);
      }
      if (rxBuffer.length > 64) rxBuffer = Buffer.alloc(0); // safety: never let it grow unbounded
    });
    deviceSocket.on("error", (err) => {
      console.error("Device socket error:", err.message);
    });
    deviceSocket.on("close", () => {
      deviceConnected = false;
      console.log("Device connection closed, retrying in 2s...");
      setTimeout(connectDevice, 2000);
    });
  }

  function queryAngle(queryFrame, cmd2Reply, timeoutMs) {
    return new Promise((resolve) => {
      if (!deviceConnected) return resolve(null);
      latestByCmd2.delete(cmd2Reply);
      deviceSocket.write(queryFrame);
      const start = Date.now();
      const poll = () => {
        if (latestByCmd2.has(cmd2Reply)) return resolve(latestByCmd2.get(cmd2Reply));
        if (Date.now() - start > timeoutMs) return resolve(null);
        setTimeout(poll, 10);
      };
      poll();
    });
  }

  // Device can only handle one outstanding query at a time (sending H+V queries back-to-back
  // makes it drop the second one) - query V only after H's reply has arrived.
  async function getPosition() {
    const h = await queryAngle(QUERY_H, 0x59, 400);
    const v = await queryAngle(QUERY_V, 0x5b, 400);
    return { h, v };
  }

  // Move to (h, v) and resolve once the device reports it has arrived (within tolerance),
  // or after maxWaitMs as a safety fallback (motor speed is fixed in firmware, not controllable).
  async function gotoAngleAndWait(h, v, onProgress) {
    const gotoId = ++currentGotoId;

    // Initial delay: give device time to finish processing any previous command (e.g. laser)
    await new Promise((r) => setTimeout(r, 80));
    if (gotoId !== currentGotoId) return null;

    console.log(`[goto id=${gotoId}] Sending pan H=${h}`);
    deviceSocket.write(buildAngleFrame(0x4b, h));
    await new Promise((r) => setTimeout(r, 100));
    if (gotoId !== currentGotoId) return null;

    console.log(`[goto id=${gotoId}] Sending tilt V=${v}`);
    deviceSocket.write(buildAngleFrame(0x4d, v));
    await new Promise((r) => setTimeout(r, 50));
    if (gotoId !== currentGotoId) return null;

    const tolerance = 0.5; // degrees
    const maxWaitMs = 8000;
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      if (gotoId !== currentGotoId) return null;
      const pos = await getPosition();
      if (gotoId !== currentGotoId) return null;

      if (pos.h !== null && pos.v !== null) {
        if (onProgress) onProgress(pos, gotoId);
        if (Math.abs(pos.h - h) <= tolerance && Math.abs(pos.v - v) <= tolerance) {
          console.log(`[goto id=${gotoId}] Arrived at H=${pos.h} V=${pos.v}`);
          return { pos, gotoId };
        }
      }
      await new Promise((r) => setTimeout(r, 30)); // Fast polling for responsive tracking
    }
    console.log(`[goto id=${gotoId}] Timed out waiting for H=${h} V=${v}`);
    return { pos: { h, v }, gotoId }; // timed out; assume arrived close enough
  }

  function sendCommand(cmdBytes) {
    deviceSocket.write(buildFrame(cmdBytes));
  }

  // Bump currentGotoId to cancel any in-flight gotoAngleAndWait (same mechanism the
  // WS handler in the root server.js uses when a jog/stop command interrupts a goto).
  function cancelGoto() {
    currentGotoId++;
  }

  connectDevice();

  return {
    isConnected: () => deviceConnected,
    getPosition,
    gotoAngleAndWait,
    sendCommand,
    cancelGoto,
  };
}

module.exports = { createDeviceClient };
