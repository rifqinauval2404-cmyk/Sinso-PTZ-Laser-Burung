export default function ActivityLog({ lines }) {
  return (
    <div className="card gc-log">
      <div className="card-head">
        <span className="icon-chip chip-slate">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <polyline points="7,9 11,12 7,15" />
            <line x1="13" y1="15" x2="17" y2="15" />
          </svg>
        </span>
        <h3>Activity Log</h3>
      </div>
      <div id="log">{lines.join("\n")}</div>
    </div>
  );
}
