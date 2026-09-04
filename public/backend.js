// Picks the data backend at boot: the Node server if /api answers,
// otherwise direct browser calls to Sleeper/ESPN (GitHub Pages, or any
// other static host). Everything else in app.js is backend-agnostic.
import * as server from './backend-server.js';
import * as staticBackend from './backend-static.js';

let impl = null;
export let mode = null; // 'server' | 'static'

export async function detect() {
  try {
    const res = await fetch('/api/state');
    if (res.ok) { impl = server; mode = 'server'; return mode; }
  } catch { /* no server at this origin — fall through to static */ }
  impl = staticBackend;
  mode = 'static';
  return mode;
}

// Thin pass-throughs. detect() must resolve before any of these are called
// (app.js's init() awaits it first).
export const getState = (...a) => impl.getState(...a);
export const getUser = (...a) => impl.getUser(...a);
export const getUserLeagues = (...a) => impl.getUserLeagues(...a);
export const getPlayers = (...a) => impl.getPlayers(...a);
export const getWeekData = (...a) => impl.getWeekData(...a);
export const subscribeLive = (...a) => impl.subscribeLive(...a);
export const getStream = (...a) => impl.getStream(...a);
