import { useRef } from "react";
import { parseTrackJSON } from "../constants";

// Play/stop/dwell/loop + track load/save. Orchestration (goto/dwell/loop state machine)
// lives in App.jsx (usePlayback) per the migration plan - this component stays
// presentational, mirroring hmi.html's playback card markup.
export default function PlaybackPanel({
  playing, onPlay, onStopPlay,
  dwellMs, setDwellMs, loopDwellMs, setLoopDwellMs, loop, setLoop,
  waypoints, onLoadWaypoints,
  tracks, selectedTrackId, onSelectTrack, onSaveAsNewTrack, onUpdateSelectedTrack, onDeleteTrack,
}) {
  const fileInputRef = useRef(null);

  function handleSaveFile() {
    const blob = new Blob([JSON.stringify(waypoints, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "track.json";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handleFileChange(e) {
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        onLoadWaypoints(parseTrackJSON(reader.result));
      } catch (err) {
        alert("Gagal parse file: " + err.message);
      }
    };
    reader.readAsText(f);
    e.target.value = "";
  }

  function handleSaveAsNewTrack() {
    const name = prompt("Nama track baru:", "Track " + new Date().toLocaleString());
    if (name) onSaveAsNewTrack(name);
  }

  function handleDeleteTrack() {
    const track = tracks.find((t) => String(t.id) === String(selectedTrackId));
    if (!track) return;
    const ok = confirm(
      `Hapus track "${track.name}"?\n\n` +
      `Jadwal otomatis yang memakai track ini akan IKUT TERHAPUS juga (bukan cuma track-nya).`
    );
    if (ok) onDeleteTrack(selectedTrackId);
  }

  return (
    <div className="card gc-playback">
      <div className="card-head">
        <span className="icon-chip chip-slate">
          <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20" /></svg>
        </span>
        <h3>Playback</h3>
      </div>
      <div className="playback-actions">
        <button className="std primary" onClick={onPlay} disabled={playing}>&#9654; Play track</button>
        <button className="std danger-outline" onClick={onStopPlay}>&#9632; Stop</button>
      </div>
      <div className="playback-settings">
        <label className="field">Tahan
          <input type="number" value={dwellMs} step="100" min="0" onChange={(e) => setDwellMs(parseInt(e.target.value, 10) || 0)} /> ms
        </label>
        <label className="toggle">
          <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
          <span className="toggle-track"><span className="toggle-thumb" /></span>Loop
        </label>
        <label className="field" title="Jeda tambahan khusus setiap kali track selesai satu putaran dan mengulang dari titik awal">Diam di awal
          <input type="number" value={loopDwellMs} step="1000" min="0" onChange={(e) => setLoopDwellMs(parseInt(e.target.value, 10) || 0)} /> ms
        </label>
        <button className="std" onClick={() => fileInputRef.current.click()}>&#8593; Load</button>
        <button className="std" onClick={handleSaveFile}>&#8595; Save</button>
        <input ref={fileInputRef} type="file" accept=".json" style={{ display: "none" }} onChange={handleFileChange} />
      </div>
      <div className="playback-io">
        <select className="std" value={selectedTrackId || ""} onChange={(e) => onSelectTrack(e.target.value || null)}>
          <option value="">-- pilih track tersimpan --</option>
          {tracks.map((t) => (
            <option key={t.id} value={t.id}>{t.name} ({t.waypoint_count} titik)</option>
          ))}
        </select>
        <button className="std" onClick={handleSaveAsNewTrack}>&#128190; Simpan sebagai baru</button>
        {selectedTrackId && (
          <>
            <button className="std" onClick={onUpdateSelectedTrack}>&#8635; Update track ini</button>
            <button className="std danger-outline" title="Hapus track ini" onClick={handleDeleteTrack}>&#128465;</button>
          </>
        )}
      </div>
    </div>
  );
}
