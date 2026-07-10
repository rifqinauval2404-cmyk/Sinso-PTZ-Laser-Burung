const pool = require("./pool");

async function insert({ eventType, angleH, angleV, message, source }) {
  await pool.query(
    `INSERT INTO activity_log (event_type, angle_h, angle_v, message, source) VALUES (?, ?, ?, ?, ?)`,
    [eventType, angleH ?? null, angleV ?? null, message ?? null, source || "manual"]
  );
}

async function list({ limit, since, type } = {}) {
  const clauses = [];
  const params = [];
  if (since) { clauses.push("occurred_at >= ?"); params.push(since); }
  if (type) { clauses.push("event_type = ?"); params.push(type); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const cappedLimit = Math.min(parseInt(limit, 10) || 100, 500);
  const [rows] = await pool.query(
    `SELECT id, occurred_at, event_type, angle_h, angle_v, message, source
     FROM activity_log ${where} ORDER BY occurred_at DESC LIMIT ?`,
    [...params, cappedLimit]
  );
  return rows;
}

module.exports = { insert, list };
