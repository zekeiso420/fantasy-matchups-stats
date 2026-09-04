// Backend: fetches Sleeper and ESPN directly from the browser, with no
// server in between. Used automatically when /api isn't reachable (e.g. on
// GitHub Pages). See backend.js. Sleeper's endpoints allow browser origins,
// and so does ESPN's site.web.api host; its site.api host does not, which is
// why nfl.js points at the former.
//
// Requests here deliberately carry no custom headers: a cross-origin GET
// with extra headers triggers a preflight OPTIONS request, and there's no
// guarantee either API answers one. A plain fetch() stays a "simple
// request" and skips preflight entirely.

import { SLEEPER, ESPN, slimPlayers, scoreboardUrl, feedUrls, summarizeGames, normalizeStatFeed, scoreLeagueWeek } from './nfl.js';
import { memo, memoPersist } from './memo.js';

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) { const e = new Error(`${res.status} from ${new URL(url).hostname}`); e.status = res.status; throw e; }
  return res.json();
}

const TTL = { state: 60_000, league: 300_000, roster: 60_000, users: 300_000, matchups: 8_000, players: 6 * 3_600_000, scoreboard: 20_000, stats: 10_000, proj: 30 * 60_000 };

export const getState = () => memo('state', TTL.state, () => getJSON(`${SLEEPER}/state/nfl`));

export async function getUser(username) {
  const data = await getJSON(`${SLEEPER}/user/${encodeURIComponent(username)}`);
  if (!data) { const e = new Error('No Sleeper user with that name'); e.status = 404; throw e; }
  return data;
}

export async function getUserLeagues(userId) {
  const state = await getState();
  const season = state.league_season || state.season;
  const leagues = await memo(`leagues:${userId}:${season}`, TTL.league, () => getJSON(`${SLEEPER}/user/${userId}/leagues/nfl/${season}`));
  return (leagues || []).map((l) => ({ league_id: l.league_id, name: l.name, avatar: l.avatar, season: l.season, total_rosters: l.total_rosters, status: l.status }));
}

export const getPlayers = () => memoPersist('fms:players:v1', TTL.players, async () => slimPlayers(await getJSON(`${SLEEPER}/players/nfl`)));

const getLeague = (id) => memo(`league:${id}`, TTL.league, () => getJSON(`${SLEEPER}/league/${id}`));
const getRosters = (id) => memo(`rosters:${id}`, TTL.roster, () => getJSON(`${SLEEPER}/league/${id}/rosters`));
const getUsers = (id) => memo(`users:${id}`, TTL.users, () => getJSON(`${SLEEPER}/league/${id}/users`));
const getMatchups = (id, week) => memo(`matchups:${id}:${week}`, TTL.matchups, () => getJSON(`${SLEEPER}/league/${id}/matchups/${week}`));

async function getScoreboard(week) {
  const url = scoreboardUrl(await getState(), week);
  return memo(`scoreboard:${url}`, TTL.scoreboard, async () => summarizeGames(await getJSON(url)));
}

// Sleeper's stats endpoint is unofficial and undocumented. If it, or its
// CORS headers, ever disappear, everything degrades to Sleeper's own
// players_points instead of breaking (see scoreLeagueWeek's fallback).
async function fetchFeed(kind, week) {
  const [primary, fallback] = feedUrls(kind, await getState(), week);
  try { return normalizeStatFeed(await getJSON(primary)); }
  catch (err) {
    console.warn(`[${kind}] primary feed failed (${err.message}); trying v1`);
    return normalizeStatFeed(await getJSON(fallback));
  }
}
async function getStats(week) {
  const games = await getScoreboard(week).catch(() => ({}));
  const anyLive = Object.values(games).some((g) => g.state === 'live');
  return memo(`stats:${week}`, anyLive ? TTL.stats : 120_000, () => fetchFeed('stats', week));
}
const getProjections = (week) => memo(`proj:${week}`, TTL.proj, () => fetchFeed('projections', week));

function trimToRostered(feed, rosteredIds) {
  if (!feed) return null;
  return Object.fromEntries([...rosteredIds].filter((id) => feed[id]).map((id) => [id, feed[id]]));
}

export async function getWeekData(leagueId, week) {
  const [league, rosters, users, matchups, games, stats, proj, players] = await Promise.all([
    getLeague(leagueId), getRosters(leagueId), getUsers(leagueId), getMatchups(leagueId, week),
    getScoreboard(week).catch(() => ({})),
    getStats(week).catch((e) => { console.warn('[stats]', e.message); return null; }),
    getProjections(week).catch(() => null),
    getPlayers().catch(() => null),
  ]);
  const scored = scoreLeagueWeek({ league, matchups, rosters, stats, proj, games, players });
  const rostered = new Set(Object.keys(scored.players));
  return { league, rosters, users, matchups, games, week: Number(week), scored, stats: trimToRostered(stats, rostered), proj: trimToRostered(proj, rostered), statsAvailable: !!stats };
}

// No server to push updates, so poll. Faster while any game is live.
export function subscribeLive(leagueId, week, onMessage, onStatus) {
  let stopped = false, timer = null, lastKey = null;
  onStatus('connecting');

  async function tick() {
    if (stopped) return;
    try {
      const [league, rosters, matchups, games, stats, proj, players] = await Promise.all([
        getLeague(leagueId), getRosters(leagueId), getMatchups(leagueId, week),
        getScoreboard(week).catch(() => ({})), getStats(week).catch(() => null), getProjections(week).catch(() => null), getPlayers().catch(() => null),
      ]);
      const scored = scoreLeagueWeek({ league, matchups, rosters, stats, proj, games, players });
      const rostered = new Set(Object.keys(scored.players));
      const msg = {
        at: new Date().toISOString(),
        teams: matchups.map((m) => ({ roster_id: m.roster_id, matchup_id: m.matchup_id, points: m.points ?? 0, players_points: m.players_points || {}, starters: m.starters || [] })),
        games, scored, stats: trimToRostered(stats, rostered),
      };
      const key = JSON.stringify(msg).replace(/"at":"[^"]+"/, '');
      if (key !== lastKey) { lastKey = key; onMessage(msg); }
      onStatus(true);
      const anyLive = Object.values(games).some((g) => g.state === 'live');
      timer = setTimeout(tick, anyLive ? 10_000 : 20_000);
    } catch (err) {
      onStatus(false);
      timer = setTimeout(tick, 15_000); // back off and retry rather than give up
    }
  }
  tick();
  return () => { stopped = true; clearTimeout(timer); };
}

// No server to cache for us here, so memo() keeps the provider's request rate
// down. A plain fetch stays a "simple request" and avoids preflight; if the
// provider sends no CORS headers this rejects and the caller falls back to the
// constructed embed URL.
const STREAMFREE = 'https://streamfree.top';
export const getStream = (key) => memo(`sources:${key}`, 60_000, async () => {
  try {
    const data = await getJSON(`${STREAMFREE}/api/v1/sources/${encodeURIComponent(key)}`);
    return { key, live: (data.sources || []).length > 0, sources: data.sources || [] };
  } catch (e) {
    if (e.status === 404) return { key, live: false, sources: [] };
    throw e;
  }
});
