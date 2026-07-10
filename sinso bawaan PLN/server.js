const net = require("net");
const WebSocket = require("ws");

const DEVICE_IP = process.env.DEVICE_IP || "192.168.1.60";
const DEVICE_PORT = parseInt(process.env.DEVICE_PORT || "4196", 10);
const WS_PORT = parseInt(process.env.WS_PORT || "8765", 10);
const ADDR = 0x00;

// Pelco-D command bytes [Cmd1, Cmd2, Data1(speed_pan), Data2(speed_tilt)].
// Confirmed from the original exe's Prompt Area log + live network capture:
//   pan-right  FF 00 00 02 28 00 2a   pan-left FF 00 00 04 28 00 2c   (Data1=0x28 = Speed_H 40)
//   tilt-up    FF 00 00 08 00 3F 47   tilt-down FF 00 00 10 00 3F 4F  (Data2=0x3F = Speed_V 63)
//   laser-on   FF 00 00 09 00 02 0b   laser-off FF 00 00 0b 00 02 0d  (Pelco-D AUX on/off)
//   stop       FF 00 00 00 00 00 00
const COMMANDS = {
  stop: [0x00, 0x00, 0x00, 0x00],
  "pan-right": [0x00, 0x02, 0x28, 0x00],
  "pan-left": [0x00, 0x04, 0x28, 0x00],
  "tilt-up": [0x00, 0x08, 0x00, 0x3f],
  "tilt-down": [0x00, 0x10, 0x00, 0x3f],
  "laser-on": [0x00, 0x09, 0x00, 0x02],
  "laser-off": [0x00, 0x0b, 0x00, 0x02],
};

function buildFrame(cmdBytes) {
  const [cmd1, cmd2, data1, data2] = cmdBytes;
  const checksum = (ADDR + cmd1 + cmd2 + data1 + data2) & 0xff;
  return Buffer.from([0xff, ADDR, cmd1, cmd2, data1, data2, checksum]);
}

// Set Angle_H / Angle_V: confirmed from exe Prompt Area log across two test points
// (H=30->FF 00 00 4B 0B B8 0E, H=100->FF 00 00 4B 27 10 82; V=10->...4D 03 E8 38, V=45->...4D 11 94 F2).
// Value = degrees * 100, packed as 16-bit big-endian into Data1(hi)/Data2(lo).
function buildAngleFrame(cmd2, degrees) {
  const v = Math.round(degrees * 100) & 0xffff;
  const data1 = (v >> 8) & 0xff;
  const data2 = v & 0xff;
  return buildFrame([0x00, cmd2, data1, data2]);
}

// Query Angle_H/V: confirmed via live capture.
//   send FF 00 00 51 00 00 51 -> reply FF 00 00 59 [HI] [LO] cs  (Angle_H)
//   send FF 00 00 53 00 00 53 -> reply FF 00 00 5B [HI] [LO] cs  (Angle_V)
// Value = degrees * 100, 16-bit big-endian, same encoding as Set Angle_H/V.
const QUERY_H = Buffer.from([0xff, 0x00, 0x00, 0x51, 0x00, 0x00, 0x51]);
const QUERY_V = Buffer.from([0xff, 0x00, 0x00, 0x53, 0x00, 0x00, 0x53]);

let deviceSocket = null;
let deviceConnected = false;
let rxBuffer = Buffer.alloc(0);
let latestByCmd2 = new Map(); // cmd2 -> decoded angle (degrees), updated as frames arrive
let currentGotoId = 0; // tracking active goto execution to allow cancellation

function connectDevice() {
  deviceSocket = net.connect(DEVICE_PORT, DEVICE_IP, () => {
    deviceConnected = true;
    console.log(`Connected to device ${DEVICE_IP}:${DEVICE_PORT}`);
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
connectDevice();

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

const wss = new WebSocket.Server({ port: WS_PORT });
console.log(`WebSocket bridge listening on ws://localhost:${WS_PORT}`);

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "status", deviceConnected }));

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type !== "command") return;

    // Cancel any active goto operation if a stop/jog command is received.
    // NOTE: goto-angle is NOT listed here — gotoAngleAndWait handles its own
    // cancellation via ++currentGotoId inside. Adding it here caused a
    // double-increment race that silently broke position tracking.
    if (msg.action === "stop" || msg.action.startsWith("pan-") || msg.action.startsWith("tilt-")) {
      currentGotoId++;
    }

    if (msg.action === "goto-angle") {
      if (!deviceConnected) {
        ws.send(JSON.stringify({ type: "error", message: "device not connected" }));
        return;
      }
      console.log(`goto-angle H=${msg.h} V=${msg.v} (waiting for arrival via Position Query)`);
      gotoAngleAndWait(msg.h, msg.v, (pos, gotoId) => {
        if (gotoId === currentGotoId) {
          ws.send(JSON.stringify({ type: "position", h: pos.h, v: pos.v, target_h: msg.h, target_v: msg.v }));
        }
      }).then((result) => {
        if (result && result.gotoId === currentGotoId) {
          ws.send(JSON.stringify({ type: "arrived", h: result.pos.h, v: result.pos.v }));
        }
      });
      return;
    }

    if (msg.action === "query-position") {
      if (!deviceConnected) {
        ws.send(JSON.stringify({ type: "error", message: "device not connected" }));
        return;
      }
      getPosition().then((pos) => {
        ws.send(JSON.stringify({ type: "position", h: pos.h, v: pos.v }));
      });
      return;
    }

    const cmdBytes = COMMANDS[msg.action];
    if (!cmdBytes) {
      ws.send(JSON.stringify({ type: "error", message: `unknown action ${msg.action}` }));
      return;
    }
    if (!deviceConnected) {
      ws.send(JSON.stringify({ type: "error", message: "device not connected" }));
      return;
    }
    deviceSocket.write(buildFrame(cmdBytes));
  });
});
