const pool = require("./pool");

async function listSchedules() {
  const [rows] = await pool.query(
    `SELECT s.id, s.track_id, t.name AS track_name, s.start_time, s.end_time, s.enabled, s.last_started_on
     FROM schedules s JOIN tracks t ON t.id = s.track_id
     ORDER BY s.start_time ASC`
  );
  return rows.map((r) => ({ ...r, enabled: !!r.enabled }));
}

async function createSchedule({ track_id, start_time, end_time, enabled }) {
  const [result] = await pool.query(
    `INSERT INTO schedules (track_id, start_time, end_time, enabled) VALUES (?, ?, ?, ?)`,
    [track_id, start_time, end_time, enabled === false ? 0 : 1]
  );
  return result.insertId;
}

async function updateSchedule(id, { track_id, start_time, end_time, enabled, last_started_on }) {
  const fields = [];
  const params = [];
  if (track_id !== undefined) { fields.push("track_id = ?"); params.push(track_id); }
  if (start_time !== undefined) { fields.push("start_time = ?"); params.push(start_time); }
  if (end_time !== undefined) { fields.push("end_time = ?"); params.push(end_time); }
  if (enabled !== undefined) { fields.push("enabled = ?"); params.push(enabled ? 1 : 0); }
  if (last_started_on !== undefined) { fields.push("last_started_on = ?"); params.push(last_started_on); }
  if (fields.length === 0) return;
  params.push(id);
  await pool.query(`UPDATE schedules SET ${fields.join(", ")} WHERE id = ?`, params);
}

async function deleteSchedule(id) {
  await pool.query(`DELETE FROM schedules WHERE id = ?`, [id]);
}

module.exports = { listSchedules, createSchedule, updateSchedule, deleteSchedule };
