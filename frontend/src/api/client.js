const API_KEY = import.meta.env.VITE_API_KEY || "change-me";

async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": API_KEY,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  listTracks: () => request("/tracks"),
  getTrack: (id) => request(`/tracks/${id}`),
  createTrack: (data) => request("/tracks", { method: "POST", body: JSON.stringify(data) }),
  updateTrack: (id, data) => request(`/tracks/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteTrack: (id) => request(`/tracks/${id}`, { method: "DELETE" }),

  listSchedules: () => request("/schedules"),
  createSchedule: (data) => request("/schedules", { method: "POST", body: JSON.stringify(data) }),
  updateSchedule: (id, data) => request(`/schedules/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteSchedule: (id) => request(`/schedules/${id}`, { method: "DELETE" }),

  listActivityLog: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/activity-log${qs ? `?${qs}` : ""}`);
  },
};
