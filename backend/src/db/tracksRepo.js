const pool = require("./pool");

async function listTracks() {
  const [rows] = await pool.query(
    `SELECT t.id, t.name, t.updated_at, COUNT(w.id) AS waypoint_count
     FROM tracks t LEFT JOIN track_waypoints w ON w.track_id = t.id
     GROUP BY t.id, t.name, t.updated_at
     ORDER BY t.updated_at DESC`
  );
  return rows;
}

async function getTrack(id) {
  const [[track]] = await pool.query(`SELECT id, name, created_at, updated_at FROM tracks WHERE id = ?`, [id]);
  if (!track) return null;
  const [waypoints] = await pool.query(
    `SELECT angle_h AS h, angle_v AS v, laser FROM track_waypoints WHERE track_id = ? ORDER BY seq ASC`,
    [id]
  );
  return { ...track, waypoints: waypoints.map((w) => ({ h: Number(w.h), v: Number(w.v), laser: !!w.laser })) };
}

async function insertWaypoints(conn, trackId, waypoints) {
  if (!waypoints || waypoints.length === 0) return;
  const values = waypoints.map((w, seq) => [trackId, seq, w.h, w.v, w.laser ? 1 : 0]);
  await conn.query(`INSERT INTO track_waypoints (track_id, seq, angle_h, angle_v, laser) VALUES ?`, [values]);
}

async function createTrack({ name, waypoints }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(`INSERT INTO tracks (name) VALUES (?)`, [name]);
    await insertWaypoints(conn, result.insertId, waypoints);
    await conn.commit();
    return getTrack(result.insertId);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Replace name + waypoints in one transaction (delete-then-reinsert waypoints - simplest
// correct semantics for reordering/inserting-in-the-middle vs. a diff-based update).
async function updateTrack(id, { name, waypoints }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`UPDATE tracks SET name = ? WHERE id = ?`, [name, id]);
    await conn.query(`DELETE FROM track_waypoints WHERE track_id = ?`, [id]);
    await insertWaypoints(conn, id, waypoints);
    await conn.commit();
    return getTrack(id);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function deleteTrack(id) {
  await pool.query(`DELETE FROM tracks WHERE id = ?`, [id]); // cascades to track_waypoints, schedules
}

module.exports = { listTracks, getTrack, createTrack, updateTrack, deleteTrack };
