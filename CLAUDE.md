# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read PROJECT_CONTEXT.md first

`PROJECT_CONTEXT.md` (Indonesian) has live device protocol findings, confirmed mechanical limits, and current TODO state. It is the source of truth for in-progress work — read it before making changes here, and keep it updated as facts are confirmed (don't re-derive protocol bytes from scratch).

## What this is

Custom web HMI replacing the original Sinso exe, to control a PTZ + laser bird-deterrent device over the network.

- `hmi.html` — browser UI (open directly as `file://`). 3D dome wireframe for aiming, waypoint/track builder, manual jog controls, laser toggle. Talks to `server.js` over `ws://localhost:8765`.
- `server.js` — Node WebSocket↔TCP bridge (`npm install && node server.js`). Translates JSON commands to Pelco-D byte frames, sends over raw TCP to the device (`192.168.1.60:4196` by default, override via `DEVICE_IP`/`DEVICE_PORT`/`WS_PORT` env vars), and polls Position Query to report real device position back to the browser.
- `package.json` — single dependency `ws`. `npm start` runs `node server.js`.

Legacy/obsolete files, kept but not used by the current HMI:
- `path-builder.html` — earlier config builder from before the device was known to be PTZ (assumed a 99-channel relay box).
- `321.ini` / `322.ini` / `123.ini` — config for the original `.exe`, not read by `hmi.html`/`server.js`. `321.ini` is a per-channel (`00`-`98`) schedule table (ON/OFF time + Rotating Mode); `322.ini` is index-aligned per-channel boolean enable flags; `123.ini` is a device IP. Preserve field order/delimiters/line-count if ever editing these.
- `Sinso Control System V3.1.2.exe` — original compiled app, no source available.

## Running it

```
npm install
node server.js          # bridge: ws://localhost:8765 <-> TCP device:4196
```
Then open `hmi.html` in a browser. No build/lint/test tooling exists for this repo.

## Pelco-D protocol — confirmed live, do not re-derive

Full frame table and confirmation notes are in `server.js` comments and `PROJECT_CONTEXT.md`. Key facts:
- Frame: `FF [Addr] [Cmd1] [Cmd2] [Data1] [Data2] [Checksum]`, checksum = sum of all preceding bytes & 0xFF.
- Set Angle_H = cmd2 `0x4B`, Set Angle_V = cmd2 `0x4D`. Value = degrees*100, 16-bit big-endian across Data1(hi)/Data2(lo).
- Query Angle_H: send cmd2 `0x51` → reply cmd2 `0x59`. Query Angle_V: send cmd2 `0x53` → reply cmd2 `0x5B`. Same degrees*100 encoding.
- **Device handles only one outstanding query at a time.** `getPosition()` in `server.js` queries H, awaits its reply, then queries V — sequentially. Do not "optimize" this to parallel/`Promise.all`; that was tried and silently drops replies (position updates stop mid-move).

## hmi.html canvas model + laser rules (current state)

The canvas draws the real device shape (static baseplate + pan body + tilting laser head as wireframe boxes), not a dome. `angleToVec3(h,v)` returns the laser-head tip position; `screenToAngle` raycasts onto the head-tip reach sphere. Angle constants are the confirmed limits (`ANGLE_H_MAX = 298`, `ANGLE_V_MAX = 58`); H-min is still unconfirmed (placeholder 0 — see `PROJECT_CONTEXT.md`).

Behavior rules that must not regress:
- **Laser manual latch**: `manualLaser` (user intent) is separate from `laserOn` (indicator). While playing a track, per-waypoint laser flags must never turn the laser off if the user manually latched it ON; laser-on is resent at every waypoint start and arrival as keep-alive.
- **Marker smoothing**: `sim` holds the last *reported* device position; `simDisplay` is the *drawn* pose, glided toward `sim` by a rAF loop capped at `PAN_DPS`/`TILT_DPS` deg/s (display-only estimates, calibrate on-site). Don't draw `sim` directly — that reintroduces the teleporting-marker bug.
