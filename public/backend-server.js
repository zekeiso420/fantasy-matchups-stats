// Backend: talks to server.js over same-origin /api and /stream routes.
// Used automatically whenever those routes actually answer — see backend.js.

async function api(path) {
  const res = await fetch(path);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

export const getState = () => api('/api/state');
export const getUser = (username) => api(`/api/user/${encodeURIComponent(username)}`);
export const getUserLeagues = (userId) => api(`/api/user/${userId}/leagues`);
export const getPlayers = () => api('/api/players');
export const getWeekData = (leagueId, week) => api(`/api/league/${leagueId}/week/${week}`);

// onStatus receives true (connected), false (dropped), or 'connecting'.
export function subscribeLive(leagueId, week, onMessage, onStatus) {
  onStatus('connecting');
  const es = new EventSource(`/stream/${leagueId}/${week}`);
  es.onopen = () => onStatus(true);
  es.onerror = () => onStatus(false);
  es.onmessage = (ev) => { try { onMessage(JSON.parse(ev.data)); } catch { /* ignore malformed frame */ } };
  return () => es.close();
}

// Live variants for a stream key; the server caches these on our behalf.
export const getStream = (key) => api(`/api/stream/${encodeURIComponent(key)}`);
