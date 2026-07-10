import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createCanvasEngine } from "./canvasEngine";

// Thin React wrapper around the imperative canvas engine: mount on ref, keep a live
// getter for manualLaser (avoids recreating the engine when that value changes), forward
// an imperative API (setSim/setWaypoints/getWaypoints/addWaypointFromSim/undo/clear) so
// parent components (PlaybackPanel for position updates, Load/Schedule for loading a
// track, manual jog for marking a waypoint) can drive it.
const TrackCanvas = forwardRef(function TrackCanvas({ initialWaypoints, manualLaser, onWaypointsChange, infoTitle }, ref) {
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const manualLaserRef = useRef(manualLaser);
  manualLaserRef.current = manualLaser;
  const [mode, setModeState] = useState("click");

  useEffect(() => {
    const engine = createCanvasEngine({
      canvas: canvasRef.current,
      initialWaypoints,
      initialMode: "click",
      getManualLaser: () => manualLaserRef.current,
      onWaypointsChange,
    });
    engineRef.current = engine;
    return () => engine.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({
    setSim: (sim) => engineRef.current?.setSim(sim),
    getSim: () => engineRef.current?.getSim(),
    setSimLaser: (on) => engineRef.current?.setSimLaser(on),
    setWaypoints: (arr) => engineRef.current?.setWaypoints(arr),
    getWaypoints: () => engineRef.current?.getWaypoints() ?? [],
    addWaypointFromSim: () => engineRef.current?.addWaypointFromSim() ?? false,
    undo: () => engineRef.current?.undo(),
    clear: () => engineRef.current?.clear(),
  }));

  function selectMode(m) {
    setModeState(m);
    engineRef.current?.setMode(m);
  }

  return (
    <div className="card gc-canvas">
      <div className="card-head">
        <span className="icon-chip chip-indigo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="5" cy="6" r="2.3" fill="currentColor" stroke="none" />
            <circle cx="19" cy="18" r="2.3" fill="currentColor" stroke="none" />
            <path d="M7 7 C11 8 9 16 17 17" />
          </svg>
        </span>
        <h3>Track / Route Builder</h3>
      </div>
      <div className="toolbar">
        <div className="segmented">
          <button className={mode === "click" ? "active" : ""} onClick={() => selectMode("click")}>Klik titik</button>
          <button className={mode === "free" ? "active" : ""} onClick={() => selectMode("free")}>Freehand</button>
        </div>
        <div className="toolbar-icons">
          <button className="std info-btn" title={infoTitle}>&#8505;</button>
          <button className="std" onClick={() => engineRef.current?.undo()}>&#8630; Undo</button>
          <button className="std" onClick={() => engineRef.current?.clear()}>&#10005; Clear</button>
        </div>
      </div>
      <div className="canvas-wrap">
        <canvas ref={canvasRef} id="trackCanvas" width="480" height="360" />
      </div>
    </div>
  );
});

export default TrackCanvas;
