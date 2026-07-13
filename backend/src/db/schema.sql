-- Run this once against your MySQL server (e.g. `mysql -u root -p sinso_ptz < schema.sql`).
-- Idempotent: safe to re-run, existing tables/data are left alone.

CREATE TABLE IF NOT EXISTS tracks (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Dwell timing travels WITH the track (not per-schedule) so both manual Play and
-- Jadwal Otomatis (scheduleRunner.js) use the same "Tahan"/"Diam di awal" values the
-- track was saved with. ADD COLUMN IF NOT EXISTS so re-running this file against an
-- existing database backfills these on old tracks via the DEFAULT.
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS dwell_ms INT UNSIGNED NOT NULL DEFAULT 800;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS loop_dwell_ms INT UNSIGNED NOT NULL DEFAULT 30000;

CREATE TABLE IF NOT EXISTS track_waypoints (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  track_id INT UNSIGNED NOT NULL,
  seq SMALLINT UNSIGNED NOT NULL,
  angle_h DECIMAL(6,2) NOT NULL,
  angle_v DECIMAL(6,2) NOT NULL,
  laser TINYINT(1) NOT NULL DEFAULT 0,
  FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_track_seq (track_id, seq)
);

CREATE TABLE IF NOT EXISTS schedules (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  track_id INT UNSIGNED NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  last_started_on DATE NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS activity_log (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  event_type ENUM('laser_on','laser_off','goto','arrived','jog','schedule_start','schedule_stop','error') NOT NULL,
  angle_h DECIMAL(6,2) NULL,
  angle_v DECIMAL(6,2) NULL,
  message VARCHAR(500) NULL,
  source ENUM('manual','schedule','system') NOT NULL DEFAULT 'manual',
  INDEX idx_occurred_at (occurred_at)
);
