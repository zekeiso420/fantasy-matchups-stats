// Matchup — Sleeper fantasy matchup tracker
// Data flows one way: fetch → state → render(). Live updates patch state and
// either re-render or touch only the numbers, depending on what changed.

import { breakdown } from './scoring.js';
import * as backend from './backend.js';

const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');
const STORE_KEY = 'fms:v2';

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
const prefs = load();
function load() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; } }
function save(patch) { Object.assign(prefs, patch); localStorage.setItem(STORE_KEY, JSON.stringify(prefs)); }

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const S = {
  nfl: null,          // /api/state
  user: null,         // Sleeper user
  leagues: [],
  leagueId: null,
  week: null,
  data: null,         // { league, rosters, users, matchups, games }
  players: null,      // slim player index
  view: prefs.view || 'slot',
  viewMatchupId: null,
  liveAt: null,
  online: false,
};

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
const url = new URLSearchParams(location.search);
const sharedLink = !!url.get('u') && !!prefs.username && url.get('u').toLowerCase() !== prefs.username.toLowerCase();
const boot = {
  username: url.get('u') || (prefs.remember !== false ? prefs.username : null),
  leagueId: url.get('l') || prefs.leagueId || null,
  week: url.get('w') ? Number(url.get('w')) : null,
};

$('#theme-btn').addEventListener('click', () => {
  const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  save({ theme: next });
});
$('#user-chip').addEventListener('click', () => signOut());
$('#league-select').addEventListener('change', (e) => selectLeague(e.target.value));
$('#week-select').addEventListener('change', (e) => selectWeek(Number(e.target.value)));
$('#week-prev').addEventListener('click', () => selectWeek(S.week - 1));
$('#week-next').addEventListener('click', () => selectWeek(S.week + 1));
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.leagueId && S.week) connectLive(); });

let playersReady = Promise.resolve();
init();

async function init() {
  await backend.detect();
  playersReady = backend.getPlayers().then((p) => (S.players = p)).catch((e) => { banner(`Player names unavailable: ${e.message}`); S.players = {}; });
  try { S.nfl = await backend.getState(); } catch (e) { banner(`Couldn't reach Sleeper: ${e.message}`, { retry: init }); return; }
  if (boot.username) {
    await signIn(boot.username, { silent: true });
  } else {
    renderSetup();
  }
}

// ---------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------
async function signIn(username, { remember = prefs.remember !== false, silent = false } = {}) {
  username = username.trim();
  if (!username) return;
  if (!silent) renderSetup({ busy: true, username });
  try {
    S.user = await backend.getUser(username);
    S.leagues = await backend.getUserLeagues(S.user.user_id);
  } catch (e) {
    S.user = null;
    renderSetup({ username, error: e.message.includes('404') || /no sleeper user/i.test(e.message) ? `No Sleeper account named “${username}”.` : e.message });
    return;
  }
  S.persist = remember && !sharedLink;
  if (!sharedLink) save({ remember, username: remember ? S.user.username : null });
  renderChrome();
  if (!S.leagues.length) {
    app.innerHTML = `<div class="empty-state"><h3>No leagues for the ${S.nfl.league_season || S.nfl.season} season</h3><p>Sleeper lists ${escape(S.user.display_name || S.user.username)} in no NFL leagues this year.</p></div>`;
    return;
  }
  const wanted = boot.leagueId && S.leagues.some((l) => l.league_id === boot.leagueId) ? boot.leagueId : S.leagues[0].league_id;
  boot.leagueId = null;
  await selectLeague(wanted, boot.week);
  boot.week = null;
}

function signOut() {
  disconnectLive();
  Object.assign(S, { user: null, leagues: [], leagueId: null, week: null, data: null, viewMatchupId: null });
  save({ username: null, leagueId: null });
  history.replaceState(null, '', location.pathname);
  $('#controls').hidden = true;
  $('#user-chip').hidden = true;
  renderSetup();
}

async function selectLeague(leagueId, week = null) {
  if (!leagueId) return;
  S.leagueId = leagueId;
  S.viewMatchupId = null;
  if (S.persist) save({ leagueId });
  $('#league-select').value = leagueId;
  const defaultWeek = S.nfl.season_type === 'regular' || S.nfl.season_type === 'post' ? (S.nfl.display_week || S.nfl.week || 1) : 1;
  await selectWeek(week || defaultWeek);
}

async function selectWeek(week) {
  week = clampWeek(week);
  if (!week) return;
  S.week = week;
  syncUrl();
  disconnectLive();
  renderControls();
  renderLoading();
  try {
    const [data] = await Promise.all([backend.getWeekData(S.leagueId, week), playersReady]);
    S.data = data;
    if (!S.viewMatchupId) S.viewMatchupId = myMatchupId() ?? data.matchups[0]?.matchup_id ?? null;
    render();
    connectLive();
  } catch (e) {
    app.innerHTML = '';
    banner(`Couldn't load week ${week}: ${e.message}`, { retry: () => selectWeek(week) });
  }
}

function clampWeek(w) {
  const max = maxWeek();
  return Math.min(Math.max(1, Number(w) || 1), max);
}
function maxWeek() {
  const l = S.data?.league;
  const playoffStart = l?.settings?.playoff_week_start || 15;
  const playoffRounds = l ? Math.ceil(Math.log2(l.settings?.playoff_teams || 6)) : 3;
  return Math.max(18, playoffStart - 1 + playoffRounds);
}

function syncUrl() {
  const p = new URLSearchParams();
  if (S.user) p.set('u', S.user.username);
  if (S.leagueId) p.set('l', S.leagueId);
  if (S.week) p.set('w', S.week);
  history.replaceState(null, '', `${location.pathname}?${p}`);
}

// ---------------------------------------------------------------------------
// Live updates
// ---------------------------------------------------------------------------
let stopLive = null;
function connectLive() {
  disconnectLive();
  if (!S.leagueId || !S.week) return;
  stopLive = backend.subscribeLive(S.leagueId, S.week, applyUpdate, (status) => { S.online = status; renderUpdated(); });
}
function disconnectLive() { if (stopLive) { stopLive(); stopLive = null; } S.online = false; }

function applyUpdate(msg) {
  if (!S.data) return;
  const before = structureKey();
  const byRoster = new Map(msg.teams.map((t) => [t.roster_id, t]));
  for (const m of S.data.matchups) {
    const t = byRoster.get(m.roster_id);
    if (!t) continue;
    m.points = t.points;
    m.players_points = t.players_points;
    m.starters = t.starters;
  }
  S.data.games = msg.games || S.data.games;
  if (msg.scored) S.data.scored = msg.scored;
  if (msg.stats) S.data.stats = msg.stats;
  S.liveAt = msg.at;
  if (structureKey() !== before) render();   // a game changed state → ordering/labels change
  else patchNumbers();
}

// Anything that affects layout rather than numbers.
function structureKey() {
  const g = Object.values(S.data.games || {}).map((x) => `${x.id}:${x.state}`).sort().join(',');
  const s = S.data.matchups.map((m) => `${m.roster_id}:${(m.starters || []).join('.')}`).join('|');
  return g + '#' + s;
}

function patchNumbers() {
  for (const el of app.querySelectorAll('[data-pts]')) {
    const [rid, pid] = el.dataset.pts.split(':');
    const next = fmt(playerPts(pid, Number(rid)));
    if (el.textContent !== next) { el.textContent = next; el.classList.remove('flash', 'pre'); void el.offsetWidth; el.classList.add('flash'); }
  }
  for (const el of app.querySelectorAll('.sb-score[data-total]')) {
    const next = fmt(teamPts(Number(el.dataset.total)));
    if (el.textContent !== next) { el.textContent = next; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
  }
  for (const el of app.querySelectorAll('.gb-tot[data-tot-a]')) {
    const sum = (s) => (s ? s.split(',').reduce((t, x) => { const [r, pid] = x.split(':'); return t + playerPts(pid, Number(r)); }, 0) : 0);
    const ta = $('.ta', el), tb = $('.tb', el);
    if (ta) ta.textContent = fmt(sum(el.dataset.totA));
    if (tb) tb.textContent = fmt(sum(el.dataset.totB));
  }
  for (const el of app.querySelectorAll('.gutter[data-swing]')) {
    const [a, b] = el.dataset.swing.split('|').map((x) => x.split(':'));
    const d = playerPts(a[1], Number(a[0])) - playerPts(b[1], Number(b[0]));
    const span = $('.diff', el);
    if (span) { span.textContent = diffText(d); span.className = `diff ${diffClass(d, true)}`; }
    const w = Math.min(Math.abs(d) / 20, 1) * 100;
    const li = $('.h.l i', el), ri = $('.h.r i', el);
    if (li) li.style.width = `${d > 0 ? w : 0}%`;
    if (ri) ri.style.width = `${d < 0 ? w : 0}%`;
  }
  for (const el of app.querySelectorAll('.stat-sheet[open]')) {
    const [rid, pid] = el.dataset.sheet.split(':');
    $('.sheet-body', el).innerHTML = sheetBodyHtml(pid, Number(rid));
  }
  for (const el of app.querySelectorAll('[data-game-status]')) {
    const g = S.data.games?.[el.dataset.gameStatus];
    if (g) el.textContent = gameStatusText(g);
  }
  for (const el of app.querySelectorAll('[data-game-score]')) {
    const [team, side] = el.dataset.gameScore.split(':');
    const g = S.data.games?.[team];
    if (g) el.textContent = side === 'home' ? g.homeScore : g.awayScore;
  }
  renderScoreboardDynamic();
  renderRail();
  renderUpdated();
}

// ---------------------------------------------------------------------------
// Derived data
// ---------------------------------------------------------------------------
const BENCH = new Set(['BN', 'IR', 'TAXI']);
const SLOT_LABEL = { SUPER_FLEX: 'SFLX', REC_FLEX: 'RFLX', WRRB_FLEX: 'W/R', IDP_FLEX: 'IDP', DEF: 'DEF', DST: 'DEF', OP: 'SFLX' };

function myRoster() { return S.data?.rosters.find((r) => r.owner_id === S.user?.user_id || (r.co_owners || []).includes(S.user?.user_id)); }
function myMatchupId() {
  const r = myRoster();
  return r ? S.data.matchups.find((m) => m.roster_id === r.roster_id)?.matchup_id ?? null : null;
}

function pairs() {
  const groups = new Map();
  for (const m of S.data.matchups) {
    if (m.matchup_id == null) continue;
    if (!groups.has(m.matchup_id)) groups.set(m.matchup_id, []);
    groups.get(m.matchup_id).push(m);
  }
  const mine = myRoster()?.roster_id;
  const out = [];
  for (const [id, group] of groups) {
    let [a, b] = group;
    if (b && b.roster_id === mine) [a, b] = [b, a];
    out.push({ id, a: side(a), b: b ? side(b) : null, mine: a.roster_id === mine || b?.roster_id === mine });
  }
  return out.sort((x, y) => (y.mine - x.mine) || (x.id - y.id));
}

function side(m) {
  const roster = S.data.rosters.find((r) => r.roster_id === m.roster_id);
  const user = S.data.users.find((u) => u.user_id === roster?.owner_id);
  return {
    m, roster, user,
    name: user?.metadata?.team_name || user?.display_name || user?.username || `Team ${m.roster_id}`,
    owner: user?.display_name || user?.username || '',
    avatar: user?.avatar ? `https://sleepercdn.com/avatars/thumbs/${user.avatar}` : null,
  };
}

function current() { return pairs().find((p) => p.id === S.viewMatchupId) || pairs()[0]; }

function starterSlots() {
  return (S.data.league.roster_positions || []).filter((s) => !BENCH.has(s));
}

// Points under this league's scoring, computed server-side from live stats
// (or Sleeper's official number once the game is final). Falls back to the
// matchups feed if the stats feed is unavailable.
function playerPts(pid, rosterId) {
  const sc = S.data.scored?.players?.[pid];
  if (sc) return sc.pts;
  const m = S.data.matchups.find((x) => x.roster_id === rosterId);
  return m?.players_points?.[pid] ?? 0;
}
function teamPts(rosterId) {
  const t = S.data.scored?.teams?.[rosterId];
  if (t) return t.pts;
  return S.data.matchups.find((x) => x.roster_id === rosterId)?.points ?? 0;
}
function teamExp(rosterId) { return S.data.scored?.teams?.[rosterId]?.exp ?? null; }
function expText(rosterId) {
  const e = teamExp(rosterId);
  return e == null || !S.data.proj ? '' : `Projected ${fmt(e)}`;
}

function player(pid, m) {
  const p = S.players?.[pid];
  const team = p?.t || null;
  const sc = S.data.scored?.players?.[pid];
  return {
    id: pid,
    name: p?.n || `Player ${pid}`,
    pos: p?.p || '',
    team,
    espn: p?.e,
    injury: p?.s,
    pts: sc ? sc.pts : m.players_points?.[pid],
    proj: sc?.proj ?? 0,
    exp: sc?.exp,
    game: team ? S.data.games?.[team] || null : null,
  };
}

function sideSummary(s) {
  const starters = (s.m.starters || []).filter((id) => id && id !== '0');
  let live = 0, left = 0;
  for (const id of starters) {
    const g = player(id, s.m).game;
    if (!g) continue;
    if (g.state === 'live') live++;
    else if (g.state === 'pre') left++;
  }
  return { live, left, total: starters.length };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function renderSetup({ busy = false, username = prefs.username || '', error = null } = {}) {
  app.innerHTML = `
    <section class="setup">
      <h1>Who are you on Sleeper?</h1>
      <p>Sleeper's league data is public, so you only need your username — no password.</p>
      <form id="setup-form">
        <input type="text" name="username" placeholder="Sleeper username" autocomplete="username" autocapitalize="off" spellcheck="false" value="${escape(username)}" ${busy ? 'disabled' : ''} required>
        <label class="check"><input type="checkbox" name="remember" ${prefs.remember === false ? '' : 'checked'}> Remember me on this device</label>
        <button class="btn-primary" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Looking you up…' : 'Show my matchup'}</button>
        ${error ? `<p class="fine" style="color:var(--live)">${escape(error)}</p>` : `<p class="fine">Your username is only stored in this browser.</p>`}
      </form>
    </section>`;
  const form = $('#setup-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    signIn(form.username.value, { remember: form.remember.checked });
  });
  if (!busy) form.username.focus();
}

function renderChrome() {
  const chip = $('#user-chip');
  const u = S.user;
  chip.innerHTML = `${u.avatar ? `<img src="https://sleepercdn.com/avatars/thumbs/${u.avatar}" alt="">` : `<span class="avatar-fallback">${initials(u.display_name || u.username)}</span>`}<span>${escape(u.display_name || u.username)}</span>`;
  chip.hidden = false;
  const ls = $('#league-select');
  ls.innerHTML = S.leagues.map((l) => `<option value="${l.league_id}">${escape(l.name)}</option>`).join('');
  $('#controls').hidden = false;
}

function renderControls() {
  const ws = $('#week-select');
  const max = maxWeek();
  const playoffStart = S.data?.league?.settings?.playoff_week_start || 99;
  ws.innerHTML = Array.from({ length: max }, (_, i) => i + 1)
    .map((w) => `<option value="${w}">${w >= playoffStart ? `Week ${w} (playoffs)` : `Week ${w}`}</option>`).join('');
  ws.value = S.week;
  $('#week-prev').disabled = S.week <= 1;
  $('#week-next').disabled = S.week >= max;
}

function renderLoading() {
  app.innerHTML = `
    <div class="matchup">
      <div class="scoreboard">
        <div class="sb-team"><div class="skel" style="height:18px;width:60%"></div><div class="skel" style="height:56px;width:45%;margin-top:8px"></div></div>
        <div class="sb-gap"></div>
        <div class="sb-team away" style="justify-items:end"><div class="skel" style="height:18px;width:60%;margin-left:auto"></div><div class="skel" style="height:56px;width:45%;margin:8px 0 0 auto"></div></div>
      </div>
      <div class="matchup-body">
        <aside></aside>
        <section>${'<div class="skel-row"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>'.repeat(9)}</section>
      </div>
    </div>`;
}

function render() {
  if (!S.data) return;
  renderControls();
  const cur = current();
  if (!cur) {
    app.innerHTML = `<div class="empty-state"><h3>No matchups for week ${S.week}</h3><p>Sleeper hasn't published a schedule for this week yet.</p></div>`;
    return;
  }
  app.innerHTML = `
    <div class="matchup">
      <div class="winprob" id="winprob" hidden></div>
      ${scoreboardHtml(cur)}
      <div class="weekstrip" id="weekstrip">${weekStripHtml()}</div>
      <div class="matchup-body ${S.view === 'game' ? 'wide' : ''}">
        ${S.view === 'game' ? '' : '<aside class="rail"><div class="rail-head">All matchups</div><div id="rail"></div></aside>'}
        <section class="panel">
          <div class="tabs-row">
            <div class="tabs" role="tablist">
              <button type="button" role="tab" data-view="slot" class="${S.view === 'slot' ? 'active' : ''}" aria-pressed="${S.view === 'slot'}">By position</button>
              <button type="button" role="tab" data-view="game" class="${S.view === 'game' ? 'active' : ''}" aria-pressed="${S.view === 'game'}">By NFL game</button>
            </div>
            <span class="tabs-hint">Tap a row for the breakdown</span>
          </div>
          <div id="content"></div>
        </section>
      </div>
    </div>`;
  app.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => { S.view = b.dataset.view; save({ view: S.view }); render(); }));
  renderRail();
  renderContent(cur);
  renderUpdated();
}

function scoreboardHtml(p) {
  const a = p.a, b = p.b;
  return `
    <section class="scoreboard" aria-label="Scoreboard">
      <div class="sb-team home">
        <div class="sb-namerow"><span class="sb-name" title="${escape(a.name)}">${escape(a.name)}</span>${a.owner ? `<span class="sb-owner">${escape(a.owner)}</span>` : ''}</div>
        <div class="sb-score" data-total="${a.m.roster_id}">${fmt(teamPts(a.m.roster_id))}</div>
        <div class="sb-meta" id="meta-a">${metaHtml(a)}</div>
      </div>
      <div class="sb-gap"><div class="gap-num" id="gap-num"></div><div class="gap-sub" id="gap-sub"></div></div>
      <div class="sb-team away">
        <div class="sb-namerow">${b?.owner ? `<span class="sb-owner">${escape(b.owner)}</span>` : ''}<span class="sb-name" title="${escape(b?.name || 'Bye')}">${escape(b?.name || 'Bye')}</span></div>
        <div class="sb-score" ${b ? `data-total="${b.m.roster_id}"` : ''}>${b ? fmt(teamPts(b.m.roster_id)) : '—'}</div>
        <div class="sb-meta" id="meta-b">${b ? metaHtml(b) : ''}</div>
      </div>
    </section>`;
}

// `proj 122.88 · 6 live · 2 to play`
function metaHtml(sd) {
  const s = sideSummary(sd);
  const e = teamExp(sd.m.roster_id);
  const parts = [];
  if (e != null && S.data.proj) parts.push(`proj ${fmt(e)}`);
  if (s.live) parts.push(`<span class="live">${s.live} live</span>`);
  parts.push(s.left ? `${s.left} to play` : (s.live ? '' : 'all done'));
  return parts.filter(Boolean).join(' · ');
}

// Parts of the scoreboard that change with live data.
function renderScoreboardDynamic() {
  const p = current();
  if (!p) return;
  const ap = teamPts(p.a.m.roster_id), bp = p.b ? teamPts(p.b.m.roster_id) : 0;
  app.querySelectorAll('.scoreboard .sb-score').forEach((el) => el.classList.remove('trail'));
  if (p.b && ap !== bp) $(`.scoreboard [data-total="${ap > bp ? p.b.m.roster_id : p.a.m.roster_id}"]`)?.classList.add('trail');
  const gn = $('#gap-num'), gs = $('#gap-sub');
  if (gn) { const d = ap - bp; gn.textContent = `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(2)}`; }
  if (gs) {
    const sa = sideSummary(p.a), sb = p.b ? sideSummary(p.b) : { left: 0, total: 0 };
    gs.textContent = `${sa.left + sb.left} of ${sa.total + sb.total} starters left`;
  }
  const ma = $('#meta-a'), mb = $('#meta-b');
  if (ma) ma.innerHTML = metaHtml(p.a);
  if (mb) mb.innerHTML = p.b ? metaHtml(p.b) : '';
  renderWinProb(p);
}

// Win probability from projected finals; hidden when projections are absent.
function renderWinProb(p) {
  const el = $('#winprob');
  if (!el) return;
  const wp = winProbFor(p);
  if (wp == null) { el.hidden = true; el.innerHTML = ''; return; }
  const you = Math.round(wp * 100);
  el.hidden = false;
  el.innerHTML = `<span class="wp-label">Win probability</span><span class="wp-you">${you}%</span><div class="wp-bar"><i style="width:${you}%"></i></div><span class="wp-opp">${100 - you}%</span>`;
}
function winProbFor(p) {
  if (!p.b || !S.data.proj) return null;
  const ea = teamExp(p.a.m.roster_id), eb = teamExp(p.b.m.roster_id);
  if (ea == null || eb == null) return null;
  const sa = sideSummary(p.a), sb = sideSummary(p.b);
  const remaining = sa.live + sa.left + sb.live + sb.left;
  const sd = 8 + 3.2 * Math.sqrt(remaining + 1);   // spread widens with games left
  return normCdf((ea - eb) / sd);
}
// Standard normal CDF (Abramowitz & Stegun 26.2.17).
function normCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

// Single current-week chip; a full history strip is a later round (renders
// gracefully with just this week per the handoff).
function weekStripHtml() {
  const p = current();
  const ap = teamPts(p.a.m.roster_id), bp = p.b ? teamPts(p.b.m.roster_id) : 0;
  const games = Object.values(S.data.games || {});
  const anyLive = games.some((g) => g.state === 'live');
  const started = games.some((g) => g.state !== 'pre');
  let res = '—', cls = '';
  if (anyLive) { res = 'LIVE'; cls = 'live'; }
  else if (started && p.b) { res = ap > bp ? 'W' : ap < bp ? 'L' : 'T'; cls = ap > bp ? 'w' : 'l'; }
  return `<div class="wk"><span class="w">WK ${S.week}</span><span class="res ${cls}">${res}</span>${p.b ? `<span class="sc">${fmt(ap)}–${fmt(bp)}</span>` : ''}</div>`;
}

function renderRail() {
  const rail = $('#rail');
  if (!rail) return;
  const mine = myRoster()?.roster_id;
  rail.innerHTML = pairs().map((p) => {
    const ap = teamPts(p.a.m.roster_id), bp = p.b ? teamPts(p.b.m.roster_id) : 0;
    return `
      <button type="button" class="rail-item ${p.id === S.viewMatchupId ? 'active' : ''}" data-mid="${p.id}">
        <div class="ri-row"><span class="ri-name ${p.a.roster?.roster_id === mine ? 'you' : ''}">${escape(p.a.name)}</span><span class="ri-score ${ap > bp ? 'lead' : ''}">${fmt(ap)}</span></div>
        <div class="ri-row"><span class="ri-name ${p.b?.roster?.roster_id === mine ? 'you' : ''}">${escape(p.b?.name || 'Bye')}</span><span class="ri-score ${bp > ap ? 'lead' : ''}">${p.b ? fmt(bp) : ''}</span></div>
      </button>`;
  }).join('');
  rail.querySelectorAll('[data-mid]').forEach((b) => b.addEventListener('click', () => { S.viewMatchupId = Number(b.dataset.mid); render(); }));
}

function renderContent(p) {
  const content = $('#content');
  content.innerHTML = S.view === 'slot' ? slotViewHtml(p) : gameViewHtml(p);
  const bench = $('#bench-toggle');
  if (bench) bench.addEventListener('click', () => { const blk = $('#bench-block'); if (blk) { blk.hidden = !blk.hidden; bench.textContent = `${blk.hidden ? '›' : '⌄'} Bench (${bench.dataset.a} vs ${bench.dataset.b})`; } });
  content.querySelectorAll('[data-watch]').forEach((b) => b.addEventListener('click', () => { S.watchGameId = b.dataset.watch; renderContent(p); renderScoreboardDynamic(); }));
  renderScoreboardDynamic();
}

function renderUpdated() {
  const el = $('#topbar-live');
  if (!el) return;
  const feedDown = S.data && S.data.statsAvailable === false;
  if (!S.online) { el.classList.remove('on'); el.innerHTML = ''; return; }
  el.classList.add('on');
  const label = S.online === true
    ? `LIVE${S.liveAt ? ` ${time(S.liveAt)}` : ''}`
    : S.online === 'connecting' ? 'CONNECTING…' : 'RECONNECTING…';
  el.innerHTML = `<span class="dot"></span>${label}${S.online === true && feedDown ? '<span class="feed-down">· SLEEPER POINTS, FEED DOWN</span>' : ''}`;
}

// --- Swing gutter (shared by both views) -----------------------------------
function gutterHtml(slot, a, b, ridA, ridB) {
  const has = !!(a && b);
  const d = has ? (a.pts || 0) - (b.pts || 0) : 0;
  return `<div class="gutter" ${has ? `data-swing="${ridA}:${a.id}|${ridB}:${b.id}"` : ''}>
      <div class="gutter-top">${slot}<span class="diff ${diffClass(d, has)}">${has ? diffText(d) : ''}</span></div>
      ${swingBar(has ? d : 0)}
    </div>`;
}
function swingBar(d) {
  const w = Math.min(Math.abs(d) / 20, 1) * 100;
  return `<div class="swing"><div class="h l"><i style="width:${d > 0 ? w : 0}%"></i></div><div class="h r"><i style="width:${d < 0 ? w : 0}%"></i></div></div>`;
}
function diffClass(d, has) { if (!has || Math.abs(d) < 0.005) return 'even'; return d > 0 ? 'you' : 'opp'; }
function diffText(d) {
  if (Math.abs(d) < 0.005) return 'even';
  return `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}`;
}

// --- By position -----------------------------------------------------------
function slotViewHtml(p) {
  const slots = starterSlots();
  const A = p.a.m.starters || [], B = p.b?.m.starters || [];
  const rows = slots.map((slot, i) => {
    const a = A[i] && A[i] !== '0' ? player(A[i], p.a.m) : null;
    const b = p.b && B[i] && B[i] !== '0' ? player(B[i], p.b.m) : null;
    return `
      <div class="slot-row">
        ${a ? sideHtml(a, p.a.m.roster_id, 'a') : emptySide('a')}
        ${gutterHtml(SLOT_LABEL[slot] || slot, a, b, p.a.m.roster_id, p.b?.m.roster_id)}
        ${b ? sideHtml(b, p.b.m.roster_id, 'b') : emptySide('b')}
        ${a ? sheetHtml(p.a.m.roster_id, a) : ''}${b ? sheetHtml(p.b.m.roster_id, b) : ''}
      </div>`;
  }).join('');

  const benchA = benchIds(p.a), benchB = p.b ? benchIds(p.b) : [];
  const n = Math.max(benchA.length, benchB.length);
  const leftA = sideSummary(p.a).left, leftB = p.b ? sideSummary(p.b).left : 0;
  const foot = `
    <div class="starter-foot">
      ${n ? `<button type="button" id="bench-toggle" data-a="${benchA.length}" data-b="${benchB.length}">› Bench (${benchA.length} vs ${benchB.length})</button>` : ''}
      <span class="secondary">› What's left to play (${leftA} vs ${leftB})</span>
    </div>`;
  const benchRows = Array.from({ length: n }, (_, i) => `
      <div class="slot-row">
        ${benchA[i] ? sideHtml(player(benchA[i], p.a.m), p.a.m.roster_id, 'a', { bench: true }) : emptySide('a')}
        ${gutterHtml('BN', null, null)}
        ${benchB[i] ? sideHtml(player(benchB[i], p.b.m), p.b.m.roster_id, 'b', { bench: true }) : emptySide('b')}
        ${benchA[i] ? sheetHtml(p.a.m.roster_id, player(benchA[i], p.a.m)) : ''}${benchB[i] ? sheetHtml(p.b.m.roster_id, player(benchB[i], p.b.m)) : ''}
      </div>`).join('');

  return `<div class="starters">${rows}</div>${foot}${n ? `<div class="bench-block" id="bench-block" hidden>${benchRows}</div>` : ''}`;
}

function benchIds(s) {
  const starters = new Set(s.m.starters || []);
  return (s.roster?.players || []).filter((id) => !starters.has(id))
    .map((id) => player(id, s.m))
    .sort((x, y) => posRank(x.pos) - posRank(y.pos) || (y.pts || 0) - (x.pts || 0))
    .map((x) => x.id);
}
const POS_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const posRank = (p) => { const i = POS_ORDER.indexOf(p); return i < 0 ? 99 : i; };

// --- By NFL game -----------------------------------------------------------
function gameViewHtml(p) {
  const buckets = new Map(); // gameKey → { game, team, a: [], b: [] }
  const add = (s, key) => {
    const starters = new Set((s.m.starters || []).filter((id) => id && id !== '0'));
    for (const id of s.roster?.players || []) {
      const pl = player(id, s.m);
      const gk = pl.game ? pl.game.id : pl.team ? `bye:${pl.team}` : 'fa';
      if (!buckets.has(gk)) buckets.set(gk, { game: pl.game, team: pl.team, a: [], b: [] });
      buckets.get(gk)[key].push({ ...pl, bench: !starters.has(id), rosterId: s.m.roster_id });
    }
  };
  add(p.a, 'a');
  if (p.b) add(p.b, 'b');

  const order = { live: 0, pre: 1, final: 2 };
  const list = [...buckets.values()].sort((x, y) => {
    const sx = x.game ? order[x.game.state] : 3, sy = y.game ? order[y.game.state] : 3;
    if (sx !== sy) return sx - sy;
    if (!x.game || !y.game) return 0;
    const dx = new Date(x.game.kickoff) - new Date(y.game.kickoff);
    return x.game.state === 'final' ? -dx : dx;
  });
  const bySlot = (arr) => arr.sort((x, y) => x.bench - y.bench || posRank(x.pos) - posRank(y.pos) || (y.pts || 0) - (x.pts || 0));

  const live = list.filter((bk) => bk.game && bk.game.state === 'live');
  const later = list.filter((bk) => !(bk.game && bk.game.state === 'live'));

  const liveHtml = live.map((bk) => {
    const A = bySlot(bk.a), B = bySlot(bk.b);
    const startersA = A.filter((x) => !x.bench), startersB = B.filter((x) => !x.bench);
    const totA = startersA.reduce((t, x) => t + (x.pts || 0), 0);
    const totB = startersB.reduce((t, x) => t + (x.pts || 0), 0);
    const n = Math.max(A.length, B.length);
    const rows = Array.from({ length: n }, (_, i) => {
      const a = A[i] || null, b = B[i] || null;
      return `
        <div class="slot-row game-row">
          ${a ? sideHtml(a, a.rosterId, 'a', { bench: a.bench, compact: true }) : emptyGameSide('a')}
          ${gameGutterHtml(a, b)}
          ${b ? sideHtml(b, b.rosterId, 'b', { bench: b.bench, compact: true }) : emptyGameSide('b')}
          ${a ? sheetHtml(a.rosterId, a) : ''}${b ? sheetHtml(b.rosterId, b) : ''}
        </div>`;
    }).join('');
    return `<div class="game-grp">${gameBarHtml(bk, startersA, startersB, totA, totB)}${rows}</div>`;
  }).join('');

  const laterHtml = later.length
    ? `<div class="later-hd">Not playing yet · ${later.length} game${later.length !== 1 ? 's' : ''}</div>${later.map(laterLineHtml).join('')}`
    : '';

  return `<div class="game-layout"><div class="games">${liveHtml}${laterHtml}</div>${videoAsideHtml(list)}</div>`;
}

// Single-line game bar: teams + score, "SWING" label, and inline fantasy totals.
function gameBarHtml(bk, startersA, startersB, totA, totB) {
  const g = bk.game;
  const totKey = (arr) => arr.map((x) => `${x.rosterId}:${x.id}`).join(',');
  return `
    <div class="game-bar ${g.state === 'live' ? 'live' : ''}">
      <div class="gb-line">
        <img class="gb-logo" src="${logo(g.away)}" alt="" onerror="this.remove()"><span class="gb-abbr">${g.away}</span> <span class="gb-score" data-game-score="${g.away}:away">${g.awayScore}</span>
        <span class="gb-at">at</span>
        <img class="gb-logo" src="${logo(g.home)}" alt="" onerror="this.remove()"><span class="gb-abbr">${g.home}</span> <span class="gb-score" data-game-score="${g.home}:home">${g.homeScore}</span>
        <span class="gb-clock ${g.state === 'live' ? '' : 'pre'}" data-game-status="${g.home}">${gameStatusText(g)}</span>
      </div>
      <div class="gb-swing">Swing</div>
      <div class="gb-tot" data-tot-a="${totKey(startersA)}" data-tot-b="${totKey(startersB)}"><b class="ta">${fmt(totA)}</b> you · <b class="tb">${fmt(totB)}</b> them</div>
    </div>`;
}

// Swing gutter for the game view: no side rules, thinner bar, nothing at all
// when only one side has a player in the game.
function gameGutterHtml(a, b) {
  const has = !!(a && b);
  const d = has ? (a.pts || 0) - (b.pts || 0) : 0;
  const w = Math.min(Math.abs(d) / 20, 1) * 100;
  return `<div class="gutter game" ${has ? `data-swing="${a.rosterId}:${a.id}|${b.rosterId}:${b.id}"` : ''}>
      <div class="gutter-top"><span class="diff ${has ? diffClass(d, true) : ''}">${has ? diffText(d) : ''}</span></div>
      <div class="swing ${has ? '' : 'empty'}"><div class="h l"><i style="width:${has && d > 0 ? w : 0}%"></i></div><div class="h r"><i style="width:${has && d < 0 ? w : 0}%"></i></div></div>
    </div>`;
}

// One collapsed line per non-live game (upcoming, final, bye, free agents).
function laterLineHtml(bk) {
  const g = bk.game;
  const name = g ? `${g.away} @ ${g.home}` : (bk.team ? `${escape(bk.team)} bye` : 'Free agents');
  const isFinal = g && g.state === 'final';
  const time = g ? (isFinal ? 'FINAL' : shortKick(g.kickoff)) : '';
  const who = [...bk.a, ...bk.b].map((x) => `${escape(shortName(x))}${x.pts ? ` ${fmt(x.pts)}` : ''}`).join(' · ');
  const count = `${bk.a.length} you, ${bk.b.length} them`;
  return `<button type="button" class="later-line" ${g ? `data-watch="${g.id}"` : ''}><span class="ll-name">${name}${time ? `<span class="ll-time ${isFinal ? 'final' : ''}">${time}</span>` : ''}</span><span class="ll-players">${who}</span><span class="ll-count">${count}</span></button>`;
}

const emptyGameSide = (sideKey) => `<div class="side ${sideKey} compact empty"></div>`;

function gameStatusText(g) {
  if (g.state === 'live') return escape(g.detail || 'Live');
  if (g.state === 'final') return escape(g.detail || 'Final');
  return escape(kickoff(g.kickoff));
}

// --- Video slot (provider-agnostic) -----------------------------------------
// The embed URL is built from the two team abbreviations, matching the
// provider's `/embed/{sport}/{away}-vs-{home}` path. Point VIDEO_BASE at a
// service you have the right to embed; teamSlug() adjusts the team format.
const VIDEO_BASE = 'https://streamfree.top';
const VIDEO_SPORT = 'football';
const teamSlug = (abbr) => (abbr || '').toLowerCase();
const PROVIDER = { name: 'streamfree', embedUrl: (g) => `${VIDEO_BASE}/embed/${VIDEO_SPORT}/${teamSlug(g.away)}-vs-${teamSlug(g.home)}` };

function videoAsideHtml(list) {
  const withGame = list.filter((bk) => bk.game && (bk.a.length + bk.b.length) > 0);
  const live = withGame.filter((bk) => bk.game.state === 'live');
  const watched = withGame.find((bk) => bk.game.id === S.watchGameId) || live[0] || null;
  const g = watched?.game || null;
  const src = g && VIDEO_BASE ? PROVIDER.embedUrl(g) : null;
  const title = g ? `${g.away} @ ${g.home}` : '—';
  const box = src
    ? `<div class="video-box live"><iframe src="${src}" allow="fullscreen; picture-in-picture" allowfullscreen frameborder="0" title="${escape(title)}"></iframe>${videoOverlay(g)}</div>`
    : `<div class="video-box"><div class="video-empty"><div class="ve-h">Video slot</div><div class="ve-p">No live game to watch right now.</div></div></div>`;

  const items = withGame.map((bk) => {
    const gg = bk.game, count = bk.a.length + bk.b.length;
    const active = watched && gg.id === watched.game.id;
    const tag = gg.state === 'live' ? '<span class="si-live">LIVE</span>'
      : gg.state === 'final' ? '<span class="si-time">FINAL</span>'
      : `<span class="si-time">${escape(shortKick(gg.kickoff))}</span>`;
    return `<button type="button" class="switch-item ${active ? 'active' : ''} ${gg.state !== 'live' ? 'upcoming' : ''}" data-watch="${gg.id}"><span class="si-name">${gg.away} @ ${gg.home}</span>${tag}<span class="si-count">${count} player${count !== 1 ? 's' : ''}</span></button>`;
  }).join('');

  return `
    <aside class="watch">
      <div class="watch-hd">Watching · ${escape(title)}</div>
      ${box}
      <div class="switch-hd">Switch game</div>
      <div class="switch-list">${items || '<div class="empty-col">No games with your players</div>'}</div>
    </aside>`;
}
function videoOverlay(g) {
  return `<div class="video-over"><span class="vo-clock">${escape(g.detail || 'Live')}</span><span class="vo-score">${g.away} ${g.awayScore} · ${g.home} ${g.homeScore}</span><span class="vo-muted">Muted</span></div>`;
}

// --- Player side cell -------------------------------------------------------
// compact: the By-NFL-game rows use a 20px team logo instead of the 40px
// headshot, which leaves room for the name in the narrower column.
function sideHtml(pl, rosterId, sideKey, { bench = false, compact = false } = {}) {
  const g = pl.game;
  let line = '', cls = '';
  if (!pl.team) line = 'Free agent';
  else if (!g) line = 'Bye';
  else {
    const opp = g.home === pl.team ? `vs ${g.away}` : `@ ${g.home}`;
    if (g.state === 'live') { line = `${g.detail} ${opp}`; cls = 'live'; }
    else if (g.state === 'final') {
      const mine = g.home === pl.team ? g.homeScore : g.awayScore, theirs = g.home === pl.team ? g.awayScore : g.homeScore;
      line = `${mine > theirs ? 'W' : mine < theirs ? 'L' : 'T'} ${mine}–${theirs} ${opp}`; cls = 'final';
    } else line = `${kickoff(g.kickoff)} ${opp}`;
  }
  const pre = !g || g.state === 'pre';
  const isLive = !!(g && g.state === 'live');
  // Compact rows carry the game identity in the bar above, so they use a plain
  // 24px headshot with no team-logo badge.
  const av = compact
    ? `<div class="p-av compact">${avatarHtml(pl)}</div>`
    : `<div class="p-av">${avatarHtml(pl)}${pl.team && pl.pos !== 'DEF' ? `<img class="logo" src="${logo(pl.team)}" alt="" onerror="this.remove()">` : ''}</div>`;
  const who = `<div class="p-who"><div class="p-name">${escape(pl.name)}<span class="pos">${pl.pos}${pl.team ? ` ${pl.team}` : ''}${bench ? ' · BENCH' : ''}</span>${pl.injury ? `<span class="inj">${escape(injAbbr(pl.injury))}</span>` : ''}</div><div class="p-line ${cls}">${escape(line)}</div></div>`;
  const pts = `<div class="p-pts ${pre && !pl.pts ? 'pre' : ''}" data-pts="${rosterId}:${pl.id}">${fmt(pl.pts)}</div>`;
  const cells = sideKey === 'a' ? [av, who, pts] : [pts, who, av];
  return `<div class="side ${sideKey} ${compact ? 'compact' : ''} ${isLive && !compact ? 'live' : ''} ${bench ? 'bench' : ''}" data-sheet-for="${rosterId}:${pl.id}" tabindex="0" role="button" aria-expanded="false">${cells.join('')}</div>`;
}

function avatarHtml(pl) {
  if (pl.pos === 'DEF' && pl.team) return `<img class="head def" src="${logo(pl.team)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'init',textContent:'${initials(pl.name)}'}))">`;
  const src = pl.espn ? `https://a.espncdn.com/i/headshots/nfl/players/full/${pl.espn}.png` : null;
  const init = `<div class="init">${initials(pl.name)}</div>`;
  return src ? `<img class="head" src="${src}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'init',textContent:'${initials(pl.name)}'}))">` : init;
}

const emptySide = (sideKey) => `<div class="side ${sideKey} empty">—</div>`;
const sheetHtml = (rosterId, pl) => (pl ? `<details class="stat-sheet" data-sheet="${rosterId}:${pl.id}"><summary hidden></summary><div class="sheet-body" data-name="${escape(pl.name)}"></div></details>` : '');

function sheetBodyHtml(pid, rosterId) {
  const scoring = S.data.league.scoring_settings || {};
  const st = S.data.stats?.[pid];
  const sc = S.data.scored?.players?.[pid];
  const proj = S.data.proj?.[pid];
  if (!st && !proj) return `<div class="sheet-empty">${S.data.statsAvailable === false ? 'Live stat feed unavailable; showing Sleeper\'s points.' : 'No stats yet.'}</div>`;
  const rows = st ? breakdown(st, scoring) : [];
  const projRows = proj ? breakdown(proj, scoring).slice(0, 4) : [];
  return `
    ${rows.length ? `<table class="sheet"><tbody>${rows.map((r) => `<tr><td>${escape(r.label)}</td><td class="v">${fmtStat(r.value)}</td><td class="w">× ${fmtW(r.weight)}</td><td class="p">${r.points > 0 ? '+' : ''}${fmt(r.points)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="3">${sc?.src === 'official' ? 'Official' : 'Live, league scoring'}</td><td class="p">${fmt(playerPts(pid, rosterId))}</td></tr></tfoot></table>` : ''}
    ${projRows.length ? `<div class="sheet-proj">Projected ${fmt(sc?.proj)}: ${projRows.map((r) => `${fmtStat(r.value)} ${r.label.toLowerCase()}`).join(', ')}</div>` : ''}`;
}
const fmtStat = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const fmtW = (w) => (Math.abs(w) >= 1 ? String(w) : w.toFixed(2).replace(/0+$/, ''));

app.addEventListener('click', onRowToggle);
app.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { const r = e.target.closest('[data-sheet-for]'); if (r) { e.preventDefault(); onRowToggle(e); } } });
function onRowToggle(e) {
  const row = e.target.closest('[data-sheet-for]');
  if (!row) return;
  const sheet = row.closest('.slot-row')?.querySelector(`[data-sheet="${row.dataset.sheetFor}"]`);
  if (!sheet) return;
  sheet.open = !sheet.open;
  row.setAttribute('aria-expanded', sheet.open);
  if (sheet.open) { const [rid, pid] = row.dataset.sheetFor.split(':'); $('.sheet-body', sheet).innerHTML = sheetBodyHtml(pid, Number(rid)); }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const LOGO_ALIAS = { WAS: 'wsh', JAC: 'jax' };
const logo = (team) => `https://a.espncdn.com/i/teamlogos/nfl/500/${LOGO_ALIAS[team] || team.toLowerCase()}.png`;

function fmt(n) { return (Number(n) || 0).toFixed(2); }
function shortName(pl) {
  if (pl.pos === 'DEF') return pl.team || pl.name;
  const parts = pl.name.split(/\s+/).filter(Boolean);
  return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(' ')}` : pl.name;
}
function initials(name = '') { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join(''); }
function escape(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function injAbbr(s) { return ({ Questionable: 'Q', Doubtful: 'D', Out: 'O', IR: 'IR', PUP: 'PUP', Sus: 'SUS', COV: 'COV', NA: 'NA', DNR: 'DNR' })[s] || s; }
function kickoff(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'TBD';
  return d.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}
function shortKick(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'TBD' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function banner(text, { retry } = {}) {
  const el = $('#banner');
  el.hidden = false;
  el.className = 'banner';
  el.innerHTML = `<p>${escape(text)}</p>${retry ? '<button type="button" id="banner-retry">Try again</button>' : ''}<button type="button" id="banner-close" aria-label="Dismiss">✕</button>`;
  $('#banner-close').addEventListener('click', () => { el.hidden = true; });
  if (retry) $('#banner-retry').addEventListener('click', () => { el.hidden = true; retry(); });
}
