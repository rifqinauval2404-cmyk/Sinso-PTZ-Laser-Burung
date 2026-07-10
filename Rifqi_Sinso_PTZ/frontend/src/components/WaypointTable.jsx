export default function WaypointTable({ waypoints, onDelete }) {
  return (
    <div className="card gc-table">
      <div className="card-head">
        <span className="icon-chip chip-slate">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <rect x="3" y="4" width="18" height="3.4" rx="1" />
            <rect x="3" y="10.3" width="18" height="3.4" rx="1" />
            <rect x="3" y="16.6" width="18" height="3.4" rx="1" />
          </svg>
        </span>
        <h3>Waypoints</h3>
      </div>
      <div className="table-scroll">
        <table>
          <thead><tr><th>#</th><th>Angle_H&deg;</th><th>Angle_V&deg;</th><th>Laser</th><th></th></tr></thead>
          <tbody id="routeRows">
            {waypoints.length === 0 ? (
              <tr>
                <td colSpan={5} className="table-empty">
                  <span className="emoji" role="img" aria-label="titik">&#128204;</span>
                  Belum ada waypoint. Klik area jangkauan di canvas untuk menambah titik.
                </td>
              </tr>
            ) : (
              waypoints.map((w, i) => (
                <tr key={i}>
                  <td className="stepnum">{i + 1}</td>
                  <td>{w.h}</td>
                  <td>{w.v}</td>
                  <td><span className={`badge ${w.laser ? "badge-on" : "badge-off"}`}>{w.laser ? "ON" : "off"}</span></td>
                  <td><button className="std" onClick={() => onDelete(i)}>&#10005;</button></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
