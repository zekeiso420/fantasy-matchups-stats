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
    if (el.textContent !== next) { el.textContent = next; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  }
  for (const el of app.querySelectorAll('[data-total]')) {
    const next = fmt(teamPts(Number(el.dataset.total)));
    if (el.textContent !== next) { el.textContent = next; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
  }
  for (const el of app.querySelectorAll('[data-exp]')) el.textContent = expText(Number(el.dataset.exp));
  for (const el of app.querySelectorAll('[data-diff]')) {
    const [a, b] = el.dataset.diff.split('|').map((x) => x.split(':'));
    el.textContent = diffText(playerPts(a[1], Number(a[0])) - playerPts(b[1], Number(b[0])));
  }
  for (const el of app.querySelectorAll('.stat-sheet[open]')) {
    const [rid, pid] = el.dataset.sheet.split(':');
    $('.sheet-body', el).innerHTML = sheetBodyHtml(pid, Number(rid));
  }
  for (const el of app.querySelectorAll('[data-game-status]')) {
    const g = S.data.games?.[el.dataset.gameStatus];
    if (g) el.innerHTML = gameStatusHtml(g);
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
    <div class="layout">
      <div class="scoreboard"><div class="team"><div class="skel" style="height:18px;width:40%"></div><div class="skel" style="height:52px;width:30%;margin-top:8px"></div></div><div class="mid"></div><div class="team away"><div class="skel" style="height:18px;width:40%;margin-left:auto"></div><div class="skel" style="height:52px;width:30%;margin:8px 0 0 auto"></div></div></div>
      <aside class="rail"></aside>
      <section class="panel"><div class="card">${'<div class="skel-row"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>'.repeat(8)}</div></section>
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
    <div class="layout">
      ${scoreboardHtml(cur)}
      <aside class="rail"><h2>All matchups</h2><div class="rail-list" id="rail"></div></aside>
      <section class="panel">
        <div class="panel-head">
          <div class="seg" role="tablist">
            <button type="button" role="tab" data-view="slot" aria-pressed="${S.view === 'slot'}">By position</button>
            <button type="button" role="tab" data-view="game" aria-pressed="${S.view === 'game'}">By NFL game</button>
          </div>
          <span class="updated" id="updated"></span>
        </div>
        <div id="content"></div>
      </section>
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
      <div class="team home">
        <div class="team-name" title="${escape(a.name)}">${escape(a.name)}</div>
        <div class="team-sub">${escape(a.owner)}</div>
        <div class="score" data-total="${a.m.roster_id}">${fmt(teamPts(a.m.roster_id))}</div>
        <div class="proj" data-exp="${a.m.roster_id}">${expText(a.m.roster_id)}</div>
      </div>
      <div class="mid">VS</div>
      <div class="team away">
        <div class="team-name" title="${escape(b?.name || 'Bye')}">${escape(b?.name || 'Bye')}</div>
        <div class="team-sub">${escape(b?.owner || '')}</div>
        <div class="score" ${b ? `data-total="${b.m.roster_id}"` : ''}>${b ? fmt(teamPts(b.m.roster_id)) : '—'}</div>
        <div class="proj" ${b ? `data-exp="${b.m.roster_id}"` : ''}>${b ? expText(b.m.roster_id) : ''}</div>
      </div>
      <div class="share"><i id="share-bar"></i></div>
      <div class="meta"><span id="meta-a"></span><span id="meta-b"></span></div>
    </section>`;
}

// Parts of the scoreboard that change with live data.
function renderScoreboardDynamic() {
  const p = current();
  if (!p) return;
  const ap = teamPts(p.a.m.roster_id), bp = p.b ? teamPts(p.b.m.roster_id) : 0;
  const bar = $('#share-bar');
  if (bar) bar.style.width = `${ap + bp > 0 ? Math.round((ap / (ap + bp)) * 100) : 50}%`;
  app.querySelectorAll('.scoreboard .score').forEach((el) => el.classList.remove('leading'));
  if (p.b && ap !== bp) $(`.scoreboard [data-total="${ap > bp ? p.a.m.roster_id : p.b.m.roster_id}"]`)?.classList.add('leading');
  const ma = $('#meta-a'), mb = $('#meta-b');
  if (ma) ma.innerHTML = summaryHtml(sideSummary(p.a));
  if (mb) mb.innerHTML = p.b ? summaryHtml(sideSummary(p.b)) : '';
}
function summaryHtml(s) {
  const parts = [];
  if (s.live) parts.push(`<span class="live-dot">${s.live} playing</span>`);
  parts.push(s.left ? `${s.left} to play` : s.live ? '' : 'all done');
  return parts.filter(Boolean).join(', ');
}

function renderRail() {
  const rail = $('#rail');
  if (!rail) return;
  rail.innerHTML = pairs().map((p) => {
    const ap = teamPts(p.a.m.roster_id), bp = p.b ? teamPts(p.b.m.roster_id) : 0;
    return `
      <button type="button" class="rail-item ${p.id === S.viewMatchupId ? 'active' : ''}" data-mid="${p.id}">
        <span class="n ${p.a.roster?.roster_id === myRoster()?.roster_id ? 'you' : ''}">${escape(p.a.name)}</span><span class="s ${ap > bp ? 'lead' : ''}">${fmt(ap)}</span>
        <span class="n ${p.b?.roster?.roster_id === myRoster()?.roster_id ? 'you' : ''}">${escape(p.b?.name || 'Bye')}</span><span class="s ${bp > ap ? 'lead' : ''}">${p.b ? fmt(bp) : ''}</span>
      </button>`;
  }).join('');
  rail.querySelectorAll('[data-mid]').forEach((b) => b.addEventListener('click', () => { S.viewMatchupId = Number(b.dataset.mid); render(); }));
}

function renderContent(p) {
  const content = $('#content');
  content.innerHTML = S.view === 'slot' ? slotViewHtml(p) : gameViewHtml(p);
  renderScoreboardDynamic();
}

function renderUpdated() {
  const el = $('#updated');
  if (!el) return;
  el.className = `updated ${S.online === true ? 'online' : ''}`;
  el.textContent = S.online === true
    ? `Live${S.liveAt ? `, updated ${new Date(S.liveAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}`
    : S.online === 'connecting' ? 'Connecting…' : 'Reconnecting…';
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
        ${a ? playerHtml(a, p.a.m.roster_id, 'ltr') : emptyHtml()}
        <div class="slot">${SLOT_LABEL[slot] || slot}<small ${a && b ? `data-diff="${p.a.m.roster_id}:${a.id}|${p.b.m.roster_id}:${b.id}"` : ''}>${slotDiff(a, b)}</small></div>
        ${b ? playerHtml(b, p.b.m.roster_id, 'rtl') : emptyHtml()}
        ${sheetHtml(p.a.m.roster_id, a)}${b ? sheetHtml(p.b.m.roster_id, b) : ''}
      </div>`;
  }).join('');

  const benchA = benchIds(p.a), benchB = p.b ? benchIds(p.b) : [];
  const n = Math.max(benchA.length, benchB.length);
  const benchRows = Array.from({ length: n }, (_, i) => `
      <div class="slot-row">
        ${benchA[i] ? playerHtml(player(benchA[i], p.a.m), p.a.m.roster_id, 'ltr') : emptyHtml()}
        <div class="slot"><small>BN</small></div>
        ${benchB[i] ? playerHtml(player(benchB[i], p.b.m), p.b.m.roster_id, 'rtl') : emptyHtml()}
        ${benchA[i] ? sheetHtml(p.a.m.roster_id, player(benchA[i], p.a.m)) : ''}${benchB[i] ? sheetHtml(p.b.m.roster_id, player(benchB[i], p.b.m)) : ''}
      </div>`).join('');

  return `<div class="card">${rows}</div>
    ${n ? `<details class="bench"><summary>Bench (${benchA.length} vs ${benchB.length})</summary><div class="card">${benchRows}</div></details>` : ''}`;
}

function slotDiff(a, b) {
  if (!a || !b) return '';
  return diffText((a.pts || 0) - (b.pts || 0));
}
function diffText(d) {
  if (Math.abs(d) < 0.005) return 'even';
  return `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}`;
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
  const buckets = new Map(); // gameKey → { game, a: [], b: [] }
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

  const col = (players, name) => `
    <div class="col">
      <div class="col-head"><span>${escape(name)}</span><b>${fmt(players.filter((x) => !x.bench).reduce((t, x) => t + (x.pts || 0), 0))}</b></div>
      ${players.length
        ? players.sort((x, y) => x.bench - y.bench || posRank(x.pos) - posRank(y.pos)).map((x) => playerHtml(x, x.rosterId, 'ltr', x.bench) + sheetHtml(x.rosterId, x)).join('')
        : '<div class="empty-col">No one in this game</div>'}
    </div>`;

  return `<div class="games">${list.map((b) => `
    <div class="card game-card ${b.game?.state || 'bye'}">
      ${gameHeadHtml(b)}
      <div class="game-body">${col(b.a, p.a.name)}${col(b.b, p.b?.name || 'Bye')}</div>
    </div>`).join('')}</div>`;
}

function gameHeadHtml(b) {
  const g = b.game;
  if (!g) return `<div class="game-head"><div class="status">${b.team ? `${b.team} has a bye` : 'Free agents'}</div></div>`;
  return `
    <div class="game-head">
      <div class="t away"><span class="sc ${g.state === 'pre' ? 'pre' : ''}" data-game-score="${g.away}:away">${g.state === 'pre' ? '' : g.awayScore}</span>${g.away}<img src="${logo(g.away)}" alt="" onerror="this.remove()"></div>
      <div class="status" data-game-status="${g.home}">${gameStatusHtml(g)}</div>
      <div class="t home"><img src="${logo(g.home)}" alt="" onerror="this.remove()">${g.home}<span class="sc ${g.state === 'pre' ? 'pre' : ''}" data-game-score="${g.home}:home">${g.state === 'pre' ? '' : g.homeScore}</span></div>
    </div>`;
}

function gameStatusHtml(g) {
  if (g.state === 'live') return `<span class="l">${escape(g.detail || 'Live')}</span>`;
  if (g.state === 'final') return `<span class="f">${escape(g.detail || 'Final')}</span>`;
  return kickoff(g.kickoff);
}

// --- Player row ------------------------------------------------------------
function playerHtml(pl, rosterId, dir = 'ltr', bench = false) {
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
  const projLine = pre && pl.proj ? ` (proj ${fmt(pl.proj)})` : '';
  return `
    <div class="player ${dir} ${bench ? 'bench' : ''}" data-sheet-for="${rosterId}:${pl.id}" tabindex="0" role="button" aria-expanded="false">
      <div class="avatar">${avatarHtml(pl)}${pl.team ? `<img class="logo" src="${logo(pl.team)}" alt="" onerror="this.remove()">` : ''}</div>
      <div class="who">
        <div class="name"><span class="full">${escape(pl.name)}</span><span class="short">${escape(shortName(pl))}</span><span class="pos">${pl.pos}${pl.team ? ` ${pl.team}` : ''}</span>${pl.injury ? `<span class="inj">${escape(injAbbr(pl.injury))}</span>` : ''}${bench ? '<span class="bench-tag">bench</span>' : ''}</div>
        <div class="game ${cls}">${escape(line)}${escape(projLine)}</div>
      </div>
      <div class="pts ${pre && !pl.pts ? 'pre' : ''}" data-pts="${rosterId}:${pl.id}">${fmt(pl.pts)}</div>
    </div>`;
}

function avatarHtml(pl) {
  const src = pl.pos === 'DEF' && pl.team ? logo(pl.team) : pl.espn ? `https://a.espncdn.com/i/headshots/nfl/players/full/${pl.espn}.png` : null;
  const init = `<div class="init">${initials(pl.name)}</div>`;
  return src ? `<img class="head" src="${src}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'init',textContent:'${initials(pl.name)}'}))">` : init;
}

const emptyHtml = () => '<div class="player empty">—</div>';
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
  const sheet = row.closest('.slot-row, .col')?.querySelector(`[data-sheet="${row.dataset.sheetFor}"]`);
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

function banner(text, { retry } = {}) {
  const el = $('#banner');
  el.hidden = false;
  el.className = 'banner';
  el.innerHTML = `<p>${escape(text)}</p>${retry ? '<button type="button" id="banner-retry">Try again</button>' : ''}<button type="button" id="banner-close" aria-label="Dismiss">✕</button>`;
  $('#banner-close').addEventListener('click', () => { el.hidden = true; });
  if (retry) $('#banner-retry').addEventListener('click', () => { el.hidden = true; retry(); });
}
