import { useState } from "react";

// Replaces hmi.html's localStorage-backed schedule list with REST-backed CRUD against
// MySQL (see backend/src/routes/schedules.js). Schedules reference a saved track_id
// (live FK, not a frozen upload snapshot - see PROJECT_CONTEXT.md/plan for the tradeoff).
// Trigger logic (checking current time, starting/stopping playback) now lives in the
// backend's scheduleRunner - this component is just the CRUD UI; `schedule.active` is
// reported by the backend (GET /api/schedules) so the "Berjalan" badge reflects real
// device state even if this browser was disconnected when the schedule started.
export default function ScheduleManager({ schedules, tracks, onCreate, onToggleEnabled, onDelete }) {
  const [start, setStart] = useState("06:00");
  const [end, setEnd] = useState("18:00");
  const [trackId, setTrackId] = useState("");

  function handleAdd() {
    if (!trackId) { alert("Pilih track dulu"); return; }
    onCreate({ track_id: trackId, start_time: start, end_time: end });
  }

  return (
    <div className="card gc-schedule">
      <div className="card-head">
        <span className="icon-chip chip-teal">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" /><polyline points="12,7 12,12 16,14" />
          </svg>
        </span>
        <h3>Jadwal Otomatis</h3>
      </div>
      <div className="schedule-add">
        <input type="time" value={start} onChange={(e) => setStart(e.target.value)} title="Waktu mulai" />
        <span className="schedule-arrow">&#8594;</span>
        <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} title="Waktu berhenti" />
        <select className="std" value={trackId} onChange={(e) => setTrackId(e.target.value)}>
          <option value="">-- pilih track --</option>
          {tracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <button className="std primary schedule-upload" onClick={handleAdd}>&#43; Tambah jadwal</button>
      </div>
      <div className="schedule-list" id="scheduleList">
        {schedules.length === 0 ? (
          <div className="schedule-empty">
            <span className="emoji" role="img" aria-label="jadwal">&#128197;</span>
            Belum ada jadwal. Pilih track lalu atur jam mulai/berhenti.
          </div>
        ) : (
          schedules.map((s) => (
            <div key={s.id} className={"schedule-item" + (s.active ? " active" : "")}>
              <span className="schedule-time">{s.start_time}&ndash;{s.end_time}</span>
              <span className="schedule-meta">
                <div className="schedule-file">{s.track_name}</div>
                <div className="schedule-points">
                  {s.active ? <span className="schedule-running">Berjalan</span> : null}
                </div>
              </span>
              <label className="toggle" title={s.enabled ? "Aktif" : "Nonaktif"}>
                <input type="checkbox" checked={s.enabled} onChange={(e) => onToggleEnabled(s.id, e.target.checked)} />
                <span className="toggle-track"><span className="toggle-thumb" /></span>
              </label>
              <button className="std" title="Hapus jadwal" onClick={() => onDelete(s.id)}>&#10005;</button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
