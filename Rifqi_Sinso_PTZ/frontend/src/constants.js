// Ported from hmi.html - same confirmed-live values, do not re-derive.
// H: confirmed live (jog test, PROJECT_CONTEXT.md) max ~298.27deg; min not yet found, using 0 as placeholder.
export const ANGLE_H_MAX = 298;
// V: head joint mechanical design range is 0-180deg, but the only confirmed-safe limit so far is
// ~58deg (jog test) - keep clamping/clickable/visual range at the confirmed value until re-tested
// on-site, per PROJECT_CONTEXT.md TODO.
export const ANGLE_V_MAX = 58;

// display-only estimates of the firmware-fixed motor speed (deg/s), used to glide the
// canvas marker between sparse Position Query reports - calibrate against the real device.
export const PAN_DPS = 25;
export const TILT_DPS = 15;

// max duration a single jog press moves the device before auto-stopping, so one click/tap
// = one small bounded nudge instead of a long continuous move - calibrate against the real
// device's motor speed (shorter = smaller nudge per click).
export const JOG_NUDGE_MS = 200;

// The device firmware autonomously drives to its own home/preset position after being
// left with no MOVE command for ~45-50s (confirmed live: idle 45s = no drift, 50s = full
// drift to a fixed preset; a read-only Position Query does NOT reset this timer, only a
// real move command does - see PROJECT_CONTEXT.md). During any dwell longer than this,
// resend the current goto-angle at this interval as a keep-alive so the device never goes
// idle long enough to trigger it. Keep comfortably under the ~45s measured threshold.
export const DWELL_KEEPALIVE_MS = 20000;

export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

export function parseTrackJSON(raw) {
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) throw new Error("bukan array");
  return data.map((w) => ({
    h: clamp(+w.h || 0, 0, ANGLE_H_MAX),
    v: clamp(+w.v || 0, 0, ANGLE_V_MAX),
    laser: !!w.laser,
  }));
}
