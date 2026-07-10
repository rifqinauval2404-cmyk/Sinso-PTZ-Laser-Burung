import { ANGLE_H_MAX, ANGLE_V_MAX, PAN_DPS, TILT_DPS, clamp } from "../../constants";

// Ported verbatim (math/drawing/pointer-event logic unchanged) from hmi.html's inline
// script - see CLAUDE.md: this dual-input (orbit vs aim vs long-press-delete) pointer
// model and the sim/simDisplay marker-smoothing split are protected behaviors that must
// not regress. Only the *shape* changed: module-level globals -> closure state inside
// this factory, external reads/writes go through getters/callbacks instead of
// `document.getElementById` / bare globals, so this can be mounted/unmounted cleanly
// from a React component.
export function createCanvasEngine({ canvas, initialWaypoints, initialMode, getManualLaser, onWaypointsChange }) {
  const ctx = canvas.getContext("2d");

  let waypoints = (initialWaypoints || []).map((w) => ({ ...w }));
  let mode = initialMode || "click"; // "click" | "free"
  let sim = null; // latest REPORTED device state: {hx, vy, laser}
  let simDisplay = null; // smoothed DISPLAYED pose {h, v}
  let animId = null;
  let lastFrameT = 0;

  const BASE_H = 26;
  const BODY_W = 30, BODY_D = 34, BODY_H = 46;
  const HEAD_LEN = 64, HEAD_W = 26, HEAD_H = 26;
  const PIVOT_Y = BASE_H + BODY_H;
  let viewYaw = 0.6;
  let viewPitch = 0.45;
  const viewDist = 430;

  function notifyWaypointsChange() {
    if (onWaypointsChange) onWaypointsChange(waypoints.map((w) => ({ ...w })));
  }

  function sizeCanvas() {
    const wrap = canvas.parentElement;
    const w = Math.max(260, Math.floor(wrap.clientWidth));
    const h = Math.max(200, Math.floor(wrap.clientHeight));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  function rotY(p, deg) {
    const a = (deg / 180) * Math.PI;
    return { x: p.x * Math.cos(a) + p.z * Math.sin(a), y: p.y, z: -p.x * Math.sin(a) + p.z * Math.cos(a) };
  }
  function rotX(p, deg) {
    const a = (deg / 180) * Math.PI;
    return { x: p.x, y: p.y * Math.cos(a) - p.z * Math.sin(a), z: p.y * Math.sin(a) + p.z * Math.cos(a) };
  }
  function addv(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }

  function angleToVec3(h, v) {
    const local = rotX({ x: 0, y: 0, z: HEAD_LEN }, -v);
    const world = rotY(local, h);
    return addv(world, { x: 0, y: PIVOT_Y, z: 0 });
  }
  function vec3ToAngle(p) {
    const rel = { x: p.x, y: p.y - PIVOT_Y, z: p.z };
    let h = (Math.atan2(rel.x, rel.z) / Math.PI) * 180;
    if (h < 0) h += 360;
    const horiz = Math.hypot(rel.x, rel.z);
    let v = (Math.atan2(rel.y, horiz) / Math.PI) * 180;
    return { h: clamp(Math.round(h), 0, ANGLE_H_MAX), v: clamp(Math.round(v), 0, ANGLE_V_MAX) };
  }

  function project(p) {
    let x = p.x * Math.cos(viewYaw) - p.z * Math.sin(viewYaw);
    let z = p.x * Math.sin(viewYaw) + p.z * Math.cos(viewYaw);
    let y = p.y;
    const y2 = y * Math.cos(viewPitch) - z * Math.sin(viewPitch);
    const z2 = y * Math.sin(viewPitch) + z * Math.cos(viewPitch);
    y = y2; z = z2;
    const camZ = viewDist;
    const f = camZ / (camZ - z);
    return { x: canvas.width / 2 + x * f, y: canvas.height / 2 - y * f, depth: z, scale: f };
  }

  function screenToAngle(px, py) {
    const camZ = viewDist;
    const sx = px - canvas.width / 2;
    const sy = canvas.height / 2 - py;
    const dirRot = { x: sx, y: sy, z: -camZ };
    const len = Math.hypot(dirRot.x, dirRot.y, dirRot.z);
    const d = { x: dirRot.x / len, y: dirRot.y / len, z: dirRot.z / len };
    const o = { x: 0, y: 0, z: camZ };
    const centerWorld = { x: 0, y: PIVOT_Y, z: 0 };
    let cx = centerWorld.x * Math.cos(viewYaw) - centerWorld.z * Math.sin(viewYaw);
    let cz = centerWorld.x * Math.sin(viewYaw) + centerWorld.z * Math.cos(viewYaw);
    let cy = centerWorld.y * Math.cos(viewPitch) - cz * Math.sin(viewPitch);
    cz = centerWorld.y * Math.sin(viewPitch) + cz * Math.cos(viewPitch);
    const oc = { x: o.x - cx, y: o.y - cy, z: o.z - cz };
    const b = 2 * (oc.x * d.x + oc.y * d.y + oc.z * d.z);
    const c = oc.x * oc.x + oc.y * oc.y + oc.z * oc.z - HEAD_LEN * HEAD_LEN;
    const disc = b * b - 4 * c;
    if (disc < 0) return null;
    const t = (-b - Math.sqrt(disc)) / 2;
    if (t <= 0) return null;
    const hit = { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t };
    let y = hit.y * Math.cos(-viewPitch) - hit.z * Math.sin(-viewPitch);
    let z = hit.y * Math.sin(-viewPitch) + hit.z * Math.cos(-viewPitch);
    let x = hit.x * Math.cos(-viewYaw) - z * Math.sin(-viewYaw);
    z = hit.x * Math.sin(-viewYaw) + z * Math.cos(-viewYaw);
    return vec3ToAngle({ x, y, z });
  }

  function boxVerts(center, hw, hh, hd, panDeg, tiltDeg, pivotY) {
    const corners = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      corners.push({ x: sx * hw, y: sy * hh, z: sz * hd });
    }
    return corners.map((c) => {
      let p = addv(c, center);
      if (tiltDeg !== undefined) {
        p = { x: p.x, y: p.y - pivotY, z: p.z };
        p = rotX(p, -tiltDeg);
        p = { x: p.x, y: p.y + pivotY, z: p.z };
      }
      if (panDeg !== undefined) p = rotY(p, panDeg);
      return p;
    });
  }

  function displayPose() {
    if (simDisplay) return { h: simDisplay.h, v: simDisplay.v };
    if (sim) return { h: sim.hx, v: sim.vy };
    if (waypoints.length) {
      const w = waypoints[waypoints.length - 1];
      return { h: w.h, v: w.v };
    }
    return { h: 0, v: 0 };
  }

  function stepAnim(t) {
    animId = null;
    if (!sim) return;
    if (!simDisplay) simDisplay = { h: sim.hx, v: sim.vy };
    const dt = lastFrameT ? Math.min((t - lastFrameT) / 1000, 0.1) : 0.016;
    lastFrameT = t;
    const moveToward = (cur, tgt, maxStep) => {
      const d = tgt - cur;
      return Math.abs(d) <= maxStep ? tgt : cur + Math.sign(d) * maxStep;
    };
    simDisplay = {
      h: moveToward(simDisplay.h, sim.hx, PAN_DPS * dt),
      v: moveToward(simDisplay.v, sim.vy, TILT_DPS * dt),
    };
    drawCanvas();
    if (Math.abs(simDisplay.h - sim.hx) > 0.05 || Math.abs(simDisplay.v - sim.vy) > 0.05) {
      animId = requestAnimationFrame(stepAnim);
    } else {
      lastFrameT = 0;
    }
  }
  function kickAnim() {
    if (animId === null) {
      lastFrameT = 0;
      animId = requestAnimationFrame(stepAnim);
    }
  }

  const BOX_EDGES = [[0,1],[0,2],[0,4],[1,3],[1,5],[2,3],[2,6],[3,7],[4,5],[4,6],[5,7],[6,7]];
  function drawBox(verts, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.3;
    const proj = verts.map(project);
    for (const [a, b] of BOX_EDGES) {
      ctx.beginPath();
      ctx.moveTo(proj[a].x, proj[a].y);
      ctx.lineTo(proj[b].x, proj[b].y);
      ctx.stroke();
    }
  }

  function drawSurfaceArc(a, b) {
    const steps = 16;
    ctx.beginPath();
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const h = a.h + (b.h - a.h) * t;
      const v = a.v + (b.v - a.v) * t;
      const p = project(angleToVec3(h, v));
      if (s === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }

  function drawCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const pose = displayPose();
    const h = pose.h, v = pose.v;
    const laserLit = sim ? sim.laser : false;

    const PLATE_W = BODY_W * 1.5, PLATE_D = BODY_D * 1.5, PLATE_H = 8;
    const plateVerts = boxVerts({ x: 0, y: PLATE_H / 2, z: 0 }, PLATE_W / 2, PLATE_H / 2, PLATE_D / 2);
    drawBox(plateVerts, "#8a6a4a");
    const arrowFrom = project({ x: 0, y: PLATE_H + 1, z: PLATE_D / 2 });
    const arrowTo = project({ x: 0, y: PLATE_H + 1, z: PLATE_D / 2 + 22 });
    ctx.strokeStyle = "#8a6a4a";
    ctx.fillStyle = "#8a6a4a";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(arrowFrom.x, arrowFrom.y); ctx.lineTo(arrowTo.x, arrowTo.y); ctx.stroke();
    ctx.beginPath(); ctx.arc(arrowTo.x, arrowTo.y, 3, 0, Math.PI * 2); ctx.fill();
    ctx.font = "11px system-ui";
    ctx.fillText("0°", arrowTo.x + 6, arrowTo.y + 4);

    const riserVerts = boxVerts({ x: 0, y: PLATE_H + (BASE_H - PLATE_H) / 2, z: 0 }, BODY_W * 0.45, (BASE_H - PLATE_H) / 2, BODY_D * 0.45);
    drawBox(riserVerts, "#8a6a4a");

    const bodyVerts = boxVerts({ x: 0, y: BASE_H + BODY_H / 2, z: 0 }, BODY_W / 2, BODY_H / 2, BODY_D / 2, h);
    drawBox(bodyVerts, "#3a6ea5");

    const headVerts = boxVerts({ x: 0, y: PIVOT_Y, z: HEAD_LEN / 2 }, HEAD_W / 2, HEAD_H / 2, HEAD_LEN / 2, h, v, PIVOT_Y);
    ctx.lineWidth = 1.8;
    drawBox(headVerts, laserLit ? "#d22" : "#5a6673");

    const tip = angleToVec3(h, v);
    const tipP = project(tip);
    const dir = { x: (tip.x - 0) / HEAD_LEN, y: (tip.y - PIVOT_Y) / HEAD_LEN, z: (tip.z - 0) / HEAD_LEN };
    const rayEnd = project(addv(tip, { x: dir.x * 26, y: dir.y * 26, z: dir.z * 26 }));
    ctx.strokeStyle = laserLit ? "#e33" : "#98a4b0";
    ctx.lineWidth = laserLit ? 2.5 : 1.5;
    ctx.beginPath(); ctx.moveTo(tipP.x, tipP.y); ctx.lineTo(rayEnd.x, rayEnd.y); ctx.stroke();
    ctx.fillStyle = laserLit ? "#e33" : "#5a6673";
    ctx.beginPath(); ctx.arc(tipP.x, tipP.y, 4, 0, Math.PI * 2); ctx.fill();

    ctx.strokeStyle = "#9fb0c0";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let hh = 0; hh <= ANGLE_H_MAX; hh += 4) {
      const p = project(angleToVec3(hh, 0));
      if (hh === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.fillStyle = "#5a6673";
    ctx.font = "10px system-ui";
    const tick0 = project(angleToVec3(0, 0));
    const tickMax = project(angleToVec3(ANGLE_H_MAX, 0));
    ctx.beginPath(); ctx.arc(tick0.x, tick0.y, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(tickMax.x, tickMax.y, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillText("H0°", tick0.x + 5, tick0.y - 4);
    ctx.fillText(`H${ANGLE_H_MAX}°`, tickMax.x + 5, tickMax.y - 4);
    ctx.strokeStyle = "#9fb0c0";
    ctx.beginPath();
    for (let vv = 0; vv <= ANGLE_V_MAX; vv += 4) {
      const p = project(angleToVec3(0, vv));
      if (vv === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    const tickV = project(angleToVec3(0, ANGLE_V_MAX));
    ctx.fillStyle = "#5a6673";
    ctx.beginPath(); ctx.arc(tickV.x, tickV.y, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillText(`V${ANGLE_V_MAX}°`, tickV.x + 5, tickV.y - 4);

    const center = project({ x: 0, y: 0, z: 0 });
    ctx.fillStyle = "#8a95a1";
    ctx.beginPath(); ctx.arc(center.x, center.y, 4, 0, Math.PI * 2); ctx.fill();

    if (waypoints.length > 1) {
      ctx.strokeStyle = "#4a7aaa";
      ctx.lineWidth = 2;
      for (let i = 0; i < waypoints.length - 1; i++) {
        drawSurfaceArc(waypoints[i], waypoints[i + 1]);
      }
    }

    const wpProjected = waypoints.map((w, i) => ({ w, i, p: project(angleToVec3(w.h, w.v)) }));
    wpProjected.sort((a, b) => a.p.depth - b.p.depth);
    wpProjected.forEach(({ w, i, p }) => {
      ctx.fillStyle = w.laser ? "#d22" : "#7a8694";
      ctx.beginPath(); ctx.arc(p.x, p.y, 6 * p.scale, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#38424e";
      ctx.font = "10px system-ui";
      ctx.fillText(String(i + 1), p.x + 8, p.y - 6);
    });

    if (sim) {
      const p = project(angleToVec3(h, v));
      if (sim.laser) {
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 16);
        grad.addColorStop(0, "rgba(230,40,40,0.85)");
        grad.addColorStop(1, "rgba(230,40,40,0)");
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(p.x, p.y, 16, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = sim.laser ? "#e01f1f" : "#2a6fd1";
      ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#1a232e";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = "#1a232e";
      ctx.font = "11px system-ui";
      ctx.fillText(`H${h.toFixed(0)} V${v.toFixed(0)}`, p.x + 10, p.y + 4);
    }
  }

  function hitTest(px, py) {
    for (let i = waypoints.length - 1; i >= 0; i--) {
      const p = project(angleToVec3(waypoints[i].h, waypoints[i].v));
      if (Math.hypot(p.x - px, p.y - py) <= 9) return i;
    }
    return -1;
  }

  let dragIdx = -1;
  let freeDrawing = false;
  let lastFreePoint = null;
  let orbiting = false;
  let lastOrbit = null;

  const activePointers = new Map();
  let longPressTimer = null;
  let longPressStart = null;
  const LONG_PRESS_MS = 500;
  const LONG_PRESS_MOVE_TOLERANCE = 10;

  function orbitMidpoint() {
    const pts = [...activePointers.values()];
    return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  }
  function clearLongPress() {
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    longPressStart = null;
  }
  function tryLongPressDelete(px, py) {
    const idx = hitTest(px, py);
    if (idx >= 0) {
      waypoints.splice(idx, 1);
      dragIdx = -1;
      renderAll();
      if (navigator.vibrate) navigator.vibrate(15);
    }
  }
  function addFreePoint(px, py) {
    if (lastFreePoint && Math.hypot(px - lastFreePoint.x, py - lastFreePoint.y) < 18) return;
    lastFreePoint = { x: px, y: py };
    const a = screenToAngle(px, py);
    if (!a) return;
    waypoints.push({ h: a.h, v: a.v, laser: getManualLaser() });
    renderAll();
  }

  function renderAll() {
    drawCanvas();
    notifyWaypointsChange();
  }

  function onContextMenu(e) {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const idx = hitTest(e.clientX - r.left, e.clientY - r.top);
    if (idx >= 0) { waypoints.splice(idx, 1); renderAll(); }
  }

  function onPointerDown(e) {
    if (e.button === 2) return;
    canvas.setPointerCapture(e.pointerId);
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.size === 2) {
      dragIdx = -1; freeDrawing = false; lastFreePoint = null;
      clearLongPress();
      orbiting = true;
      lastOrbit = orbitMidpoint();
      return;
    }
    if (activePointers.size > 2) return;

    const r = canvas.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;

    if (e.button === 1 || e.shiftKey || e.altKey) {
      orbiting = true; lastOrbit = { x: e.clientX, y: e.clientY };
      return;
    }
    if (mode === "click") {
      const idx = hitTest(px, py);
      if (idx >= 0) { dragIdx = idx; }
      else {
        const a = screenToAngle(px, py);
        if (a) { waypoints.push({ h: a.h, v: a.v, laser: getManualLaser() }); renderAll(); }
      }
    } else {
      freeDrawing = true;
      lastFreePoint = null;
      addFreePoint(px, py);
    }

    if (e.pointerType !== "mouse") {
      longPressStart = { x: px, y: py };
      longPressTimer = setTimeout(() => { tryLongPressDelete(px, py); longPressTimer = null; }, LONG_PRESS_MS);
    }
  }

  function onPointerMove(e) {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (longPressStart) {
      const r = canvas.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      if (Math.hypot(px - longPressStart.x, py - longPressStart.y) > LONG_PRESS_MOVE_TOLERANCE) clearLongPress();
    }

    if (orbiting && activePointers.size === 2) {
      const mid = orbitMidpoint();
      viewYaw += (mid.x - lastOrbit.x) * 0.008;
      viewPitch = clamp(viewPitch - (mid.y - lastOrbit.y) * 0.008, -1.4, 1.4);
      lastOrbit = mid;
      drawCanvas();
      return;
    }
    if (orbiting && lastOrbit) {
      viewYaw += (e.clientX - lastOrbit.x) * 0.008;
      viewPitch = clamp(viewPitch - (e.clientY - lastOrbit.y) * 0.008, -1.4, 1.4);
      lastOrbit = { x: e.clientX, y: e.clientY };
      drawCanvas();
      return;
    }

    const r = canvas.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    if (mode === "click" && dragIdx >= 0) {
      const a = screenToAngle(px, py);
      if (a) { waypoints[dragIdx].h = a.h; waypoints[dragIdx].v = a.v; renderAll(); }
    } else if (mode === "free" && freeDrawing) {
      addFreePoint(px, py);
    }
  }

  function onWheel(e) { e.preventDefault(); }

  function endPointer(e) {
    activePointers.delete(e.pointerId);
    clearLongPress();
    if (activePointers.size < 2) { orbiting = false; lastOrbit = null; }
    dragIdx = -1; freeDrawing = false; lastFreePoint = null;
  }

  function onResize() { sizeCanvas(); drawCanvas(); }

  canvas.addEventListener("contextmenu", onContextMenu);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("pointerup", endPointer);
  window.addEventListener("pointercancel", endPointer);
  window.addEventListener("resize", onResize);

  // window "resize" only fires for actual browser-window size changes, not for the
  // canvas-wrap's own box changing due to CSS (grid row sizing, layout shifts from
  // sibling content changing height, etc.) - a ResizeObserver on the wrapper catches
  // those too, so the canvas buffer never stays stuck at a stale/smaller measurement
  // (which otherwise shows as the wireframe being clipped/off-center in its box).
  const resizeObserver = new ResizeObserver(() => { sizeCanvas(); drawCanvas(); });
  resizeObserver.observe(canvas.parentElement);

  sizeCanvas();
  drawCanvas();

  return {
    setMode(m) { mode = m; },
    setWaypoints(arr) { waypoints = (arr || []).map((w) => ({ ...w })); renderAll(); },
    getWaypoints() { return waypoints.map((w) => ({ ...w })); },
    undo() { waypoints.pop(); renderAll(); },
    clear() { waypoints = []; sim = null; renderAll(); },
    setSim(newSim) { sim = newSim; kickAnim(); drawCanvas(); },
    getSim() { return sim; },
    // Mark the CURRENT sim position as a new waypoint - reuses the exact click-to-add
    // pattern (waypoints.push + renderAll), just sourced from the live device position
    // instead of a screen raycast. Uses getManualLaser() (not sim.laser) so it stays
    // consistent with click/freehand add: a marked waypoint always follows the manual
    // latch, not a momentary laser state.
    addWaypointFromSim() {
      if (!sim) return false;
      waypoints.push({ h: sim.hx, v: sim.vy, laser: getManualLaser() });
      renderAll();
      return true;
    },
    // Update just the laser flag on the existing sim (h/v unchanged) - used when the user
    // toggles the manual laser latch without a position update in flight.
    setSimLaser(on) { if (sim) { sim = { ...sim, laser: on }; drawCanvas(); } },
    draw: drawCanvas,
    destroy() {
      canvas.removeEventListener("contextmenu", onContextMenu);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("pointerup", endPointer);
      window.removeEventListener("pointercancel", endPointer);
      window.removeEventListener("resize", onResize);
      resizeObserver.disconnect();
      if (animId !== null) cancelAnimationFrame(animId);
    },
  };
}
