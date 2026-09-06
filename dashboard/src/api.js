/** Centralized API client — all calls go to /api (proxied to :3001) */

const BASE = '/api';

async function request(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

export const api = {
  // Profile
  getProfile:   ()       => request('GET',   '/profile'),
  saveProfile:  (data)   => request('POST',  '/profile', data),
  patchSection: (s, d)   => request('PATCH', `/profile/${s}`, d),

  // Applications
  getApplications: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request('GET', `/applications${qs ? '?' + qs : ''}`);
  },
  updateStatus: (id, status, notes) =>
    request('POST', `/applications/${id}/status`, { status, notes }),
  clearDatabase: () => request('DELETE', '/applications/all'),

  // Stats
  getStats: () => request('GET', '/stats'),

  // Bot
  startBot:   ()       => request('POST', '/bot/start'),
  stopBot:    ()       => request('POST', '/bot/stop'),
  botAction:  (action) => request('POST', '/bot/action', { action }),

  // Sessions
  getSessionsStatus: () => request('GET', '/sessions/status'),
  harvestSessions:   () => request('POST', '/sessions/harvest'),
};

export default api;
