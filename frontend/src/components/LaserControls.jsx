// Manual buttons latch the state (playback never overrides a manual ON) - see App.jsx's
// setLaser, which mirrors hmi.html's manualLaser/laserOn split exactly.
export default function LaserControls({ laserOn, onSetLaser }) {
  return (
    <>
      <div className="laser-row">
        <span className="icon-chip chip-red laser-chip">
          <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="13,2 3,14 11,14 9,22 21,10 13,10" /></svg>
        </span>
        <button className="std on-btn" onClick={() => onSetLaser(true)}>Laser ON</button>
        <button className="std off-btn" onClick={() => onSetLaser(false)}>Laser OFF</button>
      </div>
      <div className="laser-state">Status: <b className={laserOn ? "on" : ""}>{laserOn ? "ON" : "OFF"}</b></div>
    </>
  );
}
