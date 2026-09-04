import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SLEEPER, ESPN, slimPlayers, scoreboardUrl, feedUrls, summarizeGames, normalizeStatFeed, scoreLeagueWeek } from './public/nfl.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;


const app = express();
app.disable('x-powered-by');
// A 1h max-age means the browser won't even revalidate, so local edits stay
// invisible until the cache expires. Keep etags (cheap 304s) but let dev
// revalidate every time; production still gets the long cache.
const PROD = process.env.NODE_ENV === 'production';
app.use(express.static(path.join(__dirname, 'public'), { maxAge: PROD ? '1h' : 0, etag: true }));

// ---------------------------------------------------------------------------
// Cache: single in-flight promise per key, stale-on-error fallback.
// ---------------------------------------------------------------------------
const cache = new Map();

async function cached(key, ttlMs, loader) {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && hit.expires > now) return hit.value;
  if (hit?.pending) return hit.pending;

  const pending = loader()
    .then((value) => {
      cache.set(key, { value, expires: now + ttlMs });
      return value;
    })
    .catch((err) => {
      if (hit?.value !== undefined) {
        console.warn(`[cache] ${key}: ${err.message}, serving stale`);
        cache.set(key, { value: hit.value, expires: now + 5000 });
        return hit.value;
      }
      cache.delete(key);
      throw err;
    });

  cache.set(key, { ...(hit || {}), pending });
  return pending;
}

async function getJSON(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'fantasy-matchups-stats/2.0' } });
  if (!res.ok) {
    const err = new Error(`${res.status} from ${new URL(url).hostname}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Sleeper helpers
// ---------------------------------------------------------------------------
// The provider asks us not to poll per page load, so sources are cached; a
// stream appears shortly before kickoff and disappears after the event, so
// the window is short enough that a minute is the right order of magnitude.
const STREAMFREE = 'https://streamfree.top';
const TTL = { state: 60_000, user: 300_000, league: 300_000, roster: 60_000, matchups: 8_000, players: 6 * 3_600_000, scoreboard: 20_000, stats: 10_000, statsIdle: 120_000, proj: 30 * 60_000, streams: 60_000 };

const getState = () => cached('state', TTL.state, () => getJSON(`${SLEEPER}/state/nfl`));
const getLeague = (id) => cached(`league:${id}`, TTL.league, () => getJSON(`${SLEEPER}/league/${id}`));
const getRosters = (id) => cached(`rosters:${id}`, TTL.roster, () => getJSON(`${SLEEPER}/league/${id}/rosters`));
const getUsers = (id) => cached(`users:${id}`, TTL.league, () => getJSON(`${SLEEPER}/league/${id}/users`));
const getMatchups = (id, week) => cached(`matchups:${id}:${week}`, TTL.matchups, () => getJSON(`${SLEEPER}/league/${id}/matchups/${week}`));
const getPlayers = () => cached('players', TTL.players, async () => slimPlayers(await getJSON(`${SLEEPER}/players/nfl`)));

// ESPN scoreboard for a given season week. Sleeper weeks 19+ are ESPN postseason.
async function getScoreboard(week) {
  const state = await getState();
  const url = scoreboardUrl(state, week);
  return cached(`scoreboard:${url}`, TTL.scoreboard, async () => summarizeGames(await getJSON(url)));
}

// ---------------------------------------------------------------------------
// Sleeper stats & projections (unofficial endpoints). Normalized to
// { [player_id]: { stat: number } }. Falls back to the older v1 shape.
// ---------------------------------------------------------------------------
async function fetchFeed(kind, week) {
  const [primary, fallback] = feedUrls(kind, await getState(), week);
  try {
    return normalizeStatFeed(await getJSON(primary));
  } catch (err) {
    console.warn(`[${kind}] primary feed failed (${err.message}); trying v1`);
    return normalizeStatFeed(await getJSON(fallback));
  }
}

// Stats refresh fast while any game is live, slowly otherwise.
async function getStats(week) {
  const games = await getScoreboard(week).catch(() => ({}));
  const anyLive = Object.values(games).some((g) => g.state === 'live');
  return cached(`stats:${week}`, anyLive ? TTL.stats : TTL.statsIdle, () => fetchFeed('stats', week));
}
const getProjections = (week) => cached(`proj:${week}`, TTL.proj, () => fetchFeed('projections', week));

// ---------------------------------------------------------------------------
// REST API
// ---------------------------------------------------------------------------
const route = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    res.status(err.status === 404 ? 404 : 502).json({ error: err.message });
  }
};

app.get('/api/state', route(getState));

app.get('/api/user/:username', route(async (req) => {
  const data = await cached(`user:${req.params.username.toLowerCase()}`, TTL.user, () => getJSON(`${SLEEPER}/user/${encodeURIComponent(req.params.username)}`));
  if (!data) { const e = new Error('No Sleeper user with that name'); e.status = 404; throw e; }
  return data;
}));

app.get('/api/user/:userId/leagues', route(async (req) => {
  const state = await getState();
  const season = req.query.season || state.league_season || state.season;
  const leagues = await cached(`leagues:${req.params.userId}:${season}`, TTL.user, () => getJSON(`${SLEEPER}/user/${req.params.userId}/leagues/nfl/${season}`));
  return (leagues || []).map((l) => ({
    league_id: l.league_id,
    name: l.name,
    avatar: l.avatar,
    season: l.season,
    total_rosters: l.total_rosters,
    status: l.status,
  }));
}));

// One call returns everything the matchup screen needs.
app.get('/api/league/:leagueId/week/:week', route(async (req) => {
  const { leagueId, week } = req.params;
  const [league, rosters, users, matchups, games, stats, proj, players] = await Promise.all([
    getLeague(leagueId), getRosters(leagueId), getUsers(leagueId), getMatchups(leagueId, week),
    getScoreboard(week).catch(() => ({})),
    getStats(week).catch((e) => { console.warn('[stats]', e.message); return null; }),
    getProjections(week).catch(() => null),
    getPlayers().catch(() => null),
  ]);
  const scored = scoreLeagueWeek({ league, matchups, rosters, stats, proj, games, players });
  const rostered = new Set(Object.keys(scored.players));
  const pick = (feed) => (feed ? Object.fromEntries([...rostered].filter((id) => feed[id]).map((id) => [id, feed[id]])) : null);
  return { league, rosters, users, matchups, games, week: Number(week), scored, stats: pick(stats), proj: pick(proj), statsAvailable: !!stats };
}));

app.get('/api/players', route(getPlayers));

// Live variants for one stream key. An empty list means nothing is up yet; the
// provider 404s an unknown key, which is not an error worth surfacing as 502.
app.get('/api/stream/:key', route(async (req) => {
  const key = req.params.key;
  try {
    const data = await cached(`sources:${key}`, TTL.streams, () => getJSON(`${STREAMFREE}/api/v1/sources/${encodeURIComponent(key)}`));
    return { key, live: (data.sources || []).length > 0, sources: data.sources || [] };
  } catch (err) {
    if (err.status === 404) return { key, live: false, sources: [] };
    throw err;
  }
}));

app.get('/health', (_req, res) => res.json({ ok: true, clients: clients.size, cacheKeys: cache.size }));

// ---------------------------------------------------------------------------
// Server-sent events: one stream per league+week, pushed only on change.
// ---------------------------------------------------------------------------
const clients = new Set();
const lastSent = new Map();

app.get('/stream/:leagueId/:week', (req, res) => {
  const { leagueId, week } = req.params;
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write('retry: 5000\n\n');

  const client = { res, key: `${leagueId}:${week}`, leagueId, week };
  clients.add(client);
  const snapshot = lastSent.get(client.key);
  if (snapshot) res.write(`data: ${snapshot}\n\n`);
  else tick(); // first subscriber for this league/week: don't wait for the next poll

  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => { clearInterval(heartbeat); clients.delete(client); });
});

async function buildUpdate(leagueId, week) {
  const [league, rosters, matchups, games, stats, proj, players] = await Promise.all([
    getLeague(leagueId), getRosters(leagueId), getMatchups(leagueId, week),
    getScoreboard(week).catch(() => ({})), getStats(week).catch(() => null), getProjections(week).catch(() => null), getPlayers().catch(() => null),
  ]);
  const scored = scoreLeagueWeek({ league, matchups, rosters, stats, proj, games, players });
  const rostered = new Set(Object.keys(scored.players));
  return {
    at: new Date().toISOString(),
    teams: matchups.map((m) => ({ roster_id: m.roster_id, matchup_id: m.matchup_id, points: m.points ?? 0, players_points: m.players_points || {}, starters: m.starters || [] })),
    games,
    scored,
    stats: stats ? Object.fromEntries([...rostered].filter((id) => stats[id]).map((id) => [id, stats[id]])) : null,
  };
}

let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try { await pollAll(); } finally { ticking = false; }
}

async function pollAll() {
  const keys = new Set([...clients].map((c) => c.key));
  for (const key of keys) {
    const [leagueId, week] = key.split(':');
    try {
      const update = await buildUpdate(leagueId, week);
      const payload = JSON.stringify(update);
      const prev = lastSent.get(key);
      // Ignore the timestamp when deciding whether anything changed.
      if (prev && prev.replace(/"at":"[^"]+"/, '') === payload.replace(/"at":"[^"]+"/, '')) continue;
      lastSent.set(key, payload);
      for (const c of clients) if (c.key === key) c.res.write(`data: ${payload}\n\n`);
    } catch (err) {
      console.warn(`[stream] ${key}: ${err.message}`);
    }
  }
  // Drop snapshots nobody is listening to.
  for (const key of lastSent.keys()) if (!keys.has(key)) lastSent.delete(key);
}

function pollInterval() {
  const anyLive = [...lastSent.values()].some((p) => p.includes('"state":"live"'));
  return anyLive ? 10_000 : 20_000;
}

(async function loop() {
  await tick();
  setTimeout(loop, pollInterval());
})();

app.listen(PORT, () => console.log(`fantasy-matchups-stats → http://localhost:${PORT}`));

process.on('SIGINT', () => {
  for (const c of clients) c.res.end();
  process.exit(0);
});
