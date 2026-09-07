// Matchup: a Sleeper fantasy matchup tracker
// Data flows one way: fetch → state → render(). Live updates patch state and
// either re-render or touch only the numbers, depending on what changed.

import { breakdown, scorePlayer } from './scoring.js';
import * as backend from './backend.js';
import { VIDEO_BASE, PROVIDER, streamKey, sourceLabel } from './video.js';

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
  theater: !!prefs.theater,
  laterOpen: false,
  bgLaterOpen: false,
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
// t = theater, r = reload a stalled source. Fullscreen belongs to the
// provider's own player now.
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable) return;
  const k = e.key.toLowerCase();
  if (k !== 't' && k !== 'r') return;
  if (!document.querySelector('#video-frame')) return;
  e.preventDefault();
  videoAction(k === 't' ? 'theater' : 'reload');
});

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
  if (structureKey() !== before) render({ keepVideo: true }); // a game changed state → ordering/labels change
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
  for (const el of app.querySelectorAll('.ss-tot[data-total]')) {
    const next = fmt(teamPts(Number(el.dataset.total)));
    if (el.textContent !== next) { el.textContent = next; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
  }
  for (const el of app.querySelectorAll('.gb-tot[data-tot-a]')) {
    const sum = (s) => (s ? s.split(',').reduce((t, x) => { const [r, pid] = x.split(':'); return t + playerPts(pid, Number(r)); }, 0) : 0);
    const a = sum(el.dataset.totA), b = sum(el.dataset.totB);
    const ta = $('.ta', el), tb = $('.tb', el);
    if (ta) ta.textContent = fmt(a);
    if (tb) tb.textContent = fmt(b);
    const sw = $('.gb-swing[data-gswing]', el.parentElement);
    if (sw) sw.innerHTML = gameSwingHtml(a - b);
  }
  for (const el of app.querySelectorAll('[data-swing]')) {
    const [a, b] = el.dataset.swing.split('|').map((x) => x.split(':'));
    const d = playerPts(a[1], Number(a[0])) - playerPts(b[1], Number(b[0]));
    const span = $('.diff', el);
    if (span) span.outerHTML = diffHtml(d);
    const bar = $('.swing', el);
    if (bar) bar.outerHTML = swingBar(d);
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

// Use the selected fantasy teams consistently, including when spectating.
function matchupLabels(p = current()) {
  return { a: p.a.name, b: p.b?.name || 'Bye' };
}

function startersNote(watched, p = current()) {
  if (!watched) return '';
  const a = watched.a.filter((x) => !x.bench).length;
  const b = watched.b.filter((x) => !x.bench).length;
  const labels = matchupLabels(p);
  return (a || b) ? `${labels.a}: ${a} starters · ${labels.b}: ${b} starters` : 'no starters in this game';
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
      <p>Sleeper's league data is public, so you only need your username. No password.</p>
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

function render({ keepVideo = false } = {}) {
  if (!S.data) return;
  renderControls();
  const cur = current();
  // The player sits in the frame, outside #content, so repainting rows or
  // switching tabs never touches the <iframe>. Only a full rebuild does, so
  // skip one whenever the frame is already mounted.
  if (keepVideo && cur && $('aside.watch')) {
    $('#score-strip').outerHTML = scoreStripHtml(cur);
    renderContent(cur);
    updateWatchAside(cur);
    renderRail();
    renderScoreboardDynamic();
    renderUpdated();
    return;
  }
  if (!cur) {
    app.innerHTML = `<div class="empty-state"><h3>No matchups for week ${S.week}</h3><p>Sleeper hasn't published a schedule for this week yet.</p></div>`;
    return;
  }
  // The tab strip, the all-matchups rail and the player are all part of the
  // frame. Only #content swaps between views, so the columns are identical in
  // both and the tabs cannot shift when you switch.
  app.innerHTML = `
    <div class="matchup">
      ${scoreStripHtml(cur)}
      <div class="tabs-row">
        <div class="tabs" role="tablist">
          <button type="button" role="tab" data-view="slot" class="${S.view === 'slot' ? 'active' : ''}" aria-pressed="${S.view === 'slot'}">By position</button>
          <button type="button" role="tab" data-view="game" class="${S.view === 'game' ? 'active' : ''}" aria-pressed="${S.view === 'game'}">By NFL game</button>
        </div>
        <span class="tabs-hint ${S.theater ? 'on' : ''}" id="tabs-hint">${S.theater ? 'Theater on' : ''}</span>
      </div>
      <div class="matchup-body">
        <aside class="rail"><div class="rail-head">All matchups</div><div id="rail"></div></aside>
        <section class="panel"><div id="content"></div></section>
        ${videoAsideHtml(gameBuckets(cur))}
      </div>
    </div>`;
  app.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.view)));
  document.body.classList.toggle('theater', S.theater);
  bindVideoControls(app);
  bindWatchTargets(cur, $('aside.watch'));
  renderRail();
  renderContent(cur);
  syncStream(watchedGame);
  renderUpdated();
}

// Switching tabs repaints the rows and nothing else.
function switchView(view) {
  if (!view || view === S.view) return;
  S.view = view;
  save({ view });
  app.querySelectorAll('[data-view]').forEach((x) => {
    const on = x.dataset.view === view;
    x.classList.toggle('active', on);
    x.setAttribute('aria-pressed', String(on));
  });
  renderContent(current());
}

// One score readout for the screen. The hero block, the win-probability row
// and the week strip all restated the same numbers in about 260px, and the
// hero and the strip could disagree by a point. This is one line plus a 3px
// rule, about 46px.
function scoreStripHtml(p) {
  const a = p.a, b = p.b;
  return `
    <div class="score-strip" id="score-strip">
      <div class="ss-line">
        <span class="ss-name" title="${escape(a.name)}">${escape(a.name)}</span>
        <span class="ss-tot" data-total="${a.m.roster_id}">${fmt(teamPts(a.m.roster_id))}</span>
        <span class="ss-gap" id="ss-gap"></span>
        <span class="ss-tot opp" ${b ? `data-total="${b.m.roster_id}"` : ''}>${b ? fmt(teamPts(b.m.roster_id)) : '\u2013'}</span>
        <span class="ss-name opp" title="${escape(b?.name || 'Bye')}">${escape(b?.name || 'Bye')}</span>
        <span class="ss-meta" id="ss-meta"></span>
      </div>
      <div class="ss-projection" id="ss-projection" hidden></div>
      <div class="ss-wp"><i id="ss-wp-fill"></i></div>
    </div>`;
}

// Parts of the scoreboard that change with live data.
function renderScoreboardDynamic() {
  const p = current();
  if (!p) return;
  const ap = teamPts(p.a.m.roster_id), bp = p.b ? teamPts(p.b.m.roster_id) : 0;
  app.querySelectorAll('.ss-tot[data-total]').forEach((el) => el.classList.remove('trail'));
  if (p.b && ap !== bp) $(`.ss-tot[data-total="${ap > bp ? p.b.m.roster_id : p.a.m.roster_id}"]`)?.classList.add('trail');
  const gap = $('#ss-gap');
  if (gap) {
    const d = ap - bp;
    gap.textContent = p.b ? `${d >= 0 ? '+' : '\u2212'}${Math.abs(d).toFixed(2)}` : '';
    gap.style.color = swingColor(d);
  }
  const wp = winProbFor(p);
  const meta = $('#ss-meta');
  if (meta) {
    const sa = sideSummary(p.a), sb = p.b ? sideSummary(p.b) : { left: 0, total: 0 };
    const bits = [];
    bits.push(`${sa.left + sb.left} of ${sa.total + sb.total} starters left`);
    meta.textContent = bits.join(' \u00b7 ');
  }
  const projection = $('#ss-projection');
  if (projection) {
    projection.hidden = wp == null;
    projection.textContent = '';
    if (wp != null) {
      // These are the same expected final totals used by winProbFor().
      const ea = teamExp(p.a.m.roster_id), eb = teamExp(p.b.m.roster_id);
      const margin = Math.abs(ea - eb);
      const tied = fmt(ea) === fmt(eb);
      const favorite = ea >= eb ? p.a : p.b;
      const chance = ea >= eb ? wp : 1 - wp;
      const outcome = tied ? 'Even projection · 50% each'
        : `${favorite.name} favored by ${fmt(margin)} · Estimated win chance ${Math.round(chance * 100)}%`;
      projection.textContent = `Projected final: ${p.a.name} ${fmt(ea)} vs ${p.b.name} ${fmt(eb)} · ${outcome}`;
    }
  }
  const fill = $('#ss-wp-fill');
  if (fill) {
    fill.style.width = wp == null ? '0%' : `${Math.round(wp * 100)}%`;
    fill.style.background = swingColor(ap - bp);
  }
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

function renderRail() {
  const rail = $('#rail');
  if (!rail) return;
  const mine = myRoster()?.roster_id;
  rail.innerHTML = pairs().map((p) => {
    const ap = teamPts(p.a.m.roster_id), bp = p.b ? teamPts(p.b.m.roster_id) : 0;
    // A zero is a real score; a side with nobody yet played is not zero, it is
    // unknown, so it says so rather than printing 0.00.
    const played = (sd) => { if (!sd) return false; const s = sideSummary(sd); return s.left < s.total || s.live > 0; };
    const score = (sd, v, lead) => (played(sd)
      ? `<span class="ri-score ${lead ? 'lead' : ''}">${fmt(v)}</span>`
      : '<span class="ri-none">no games yet</span>');
    const isMine = p.a.roster?.roster_id === mine || p.b?.roster?.roster_id === mine;
    const rule = isMine ? ` style="border-left-color:${swingColor(ap - bp)}"` : '';
    return `
      <button type="button" class="rail-item ${p.id === S.viewMatchupId ? 'active' : ''} ${isMine ? 'mine' : ''}" data-mid="${p.id}"${rule}>
        <div class="ri-row"><span class="ri-name ${p.a.roster?.roster_id === mine ? 'you' : ''}">${escape(p.a.name)}</span>${score(p.a, ap, ap > bp)}</div>
        <div class="ri-row"><span class="ri-name ${p.b?.roster?.roster_id === mine ? 'you' : ''}">${escape(p.b?.name || 'Bye')}</span>${p.b ? score(p.b, bp, bp > ap) : '<span class="ri-score"></span>'}</div>
      </button>`;
  }).join('');
  rail.querySelectorAll('[data-mid]').forEach((b) => b.addEventListener('click', () => { S.viewMatchupId = Number(b.dataset.mid); render({ keepVideo: true }); }));
}

function renderContent(p) {
  const content = $('#content');
  if (!content) return;
  // In theater the game list moves above the compressed roster in the right
  // column. CSS cannot reparent, so the block renders here and the copy inside
  // the video column is hidden; both are patched together.
  // In theater the third column's content is what the tab switches; the video
  // sits in its own column and is never touched by this.
  content.innerHTML = (S.view === 'slot' ? slotViewHtml(p) : gameViewHtml(p))
    + (S.theater && S.view === 'slot' ? gameListHtml(p) : '')
    + (S.view === 'slot' ? compressedStartersHtml(p) : byGameColumnHtml(p));
  bindWatchTargets(p, content);
  bindLaterToggle(p);
  renderScoreboardDynamic();
}

// Anything that can change the watched game: a switch-game cell in the aside,
// or a collapsed game line in the rows.
function bindWatchTargets(p, root) {
  if (!root) return;
  root.querySelectorAll('[data-watch]').forEach((b) => b.addEventListener('click', () => {
    if (S.watchGameId === b.dataset.watch) return;
    S.watchGameId = b.dataset.watch;
    updateWatchAside(p);
    if (S.theater && S.view === 'game') renderContent(p);
    renderScoreboardDynamic();
  }));
}

// Patches the player aside without replacing the <iframe>. The one case that
// forces a rebuild is going from no game to a game, or back, since the two
// states are different markup.
function updateWatchAside(p) {
  const list = gameBuckets(p);
  const { withGame, watched, live, game } = watchedOf(list);
  const aside = $('aside.watch');
  if (!aside) return;
  if (!!(game && VIDEO_BASE) !== !!$('#video-frame')) {
    aside.outerHTML = videoAsideHtml(list);
    bindVideoControls(app);
    bindWatchTargets(p, $('aside.watch'));
    syncStream(watchedGame);
    return;
  }
  const hd = $('.watch-hd .wh-game');
  if (hd) { hd.textContent = gameTitle(game); hd.href = espnGameUrl(game) || '#'; }
  const note = $('.watch-hd .wh-note');
  if (note) {
    note.textContent = startersNote(watched, p);
  }
  const count = $('.sh-count');
  if (count) count.textContent = `${withGame.length} game${withGame.length !== 1 ? 's' : ''} · ${live.length} live`;
  for (const sw of app.querySelectorAll('.switch-list')) {
    sw.innerHTML = switchListHtml(withGame, watched);
    bindWatchTargets(p, sw);
  }
  for (const el of app.querySelectorAll('.sh-count')) {
    el.textContent = el.closest('.games-side') ? `${live.length} live` : `${withGame.length} game${withGame.length !== 1 ? 's' : ''} \u00b7 ${live.length} live`;
  }
  bindLaterToggle(p);
  const clock = $('#pb-clock'), score = $('#pb-score');
  if (clock && game) clock.innerHTML = bandClock(game);
  if (score && game) score.innerHTML = scoreLineHtml(game);
  syncStream(game);
  syncRailHint();
}

// What the top-right chip reports is whether football is being played, not
// whether our data socket happens to be open. With nothing on the field it
// names the next kickoff instead. Games are keyed per team, so dedupe by id.
function nflStatus() {
  const byId = new Map();
  for (const g of Object.values(S.data?.games || {})) if (g && g.id) byId.set(g.id, g);
  const all = [...byId.values()];
  // No scoreboard yet is not the same as every game being over, so say nothing
  // rather than asserting a state we cannot know.
  if (!all.length) return { none: true, live: false, next: null };
  if (all.some((g) => g.state === 'live')) return { live: true, next: null };
  const pre = all.filter((g) => g.state === 'pre')
    .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
  return { live: false, next: pre[0] || null };
}

function renderUpdated() {
  const el = $('#topbar-live');
  if (!el) return;
  const feedDown = S.data && S.data.statsAvailable === false;
  if (!S.online) { el.classList.remove('on', 'quiet'); el.innerHTML = ''; return; }
  el.classList.add('on');
  if (S.online !== true) {
    el.classList.remove('quiet');
    el.innerHTML = `<span class="dot"></span>${S.online === 'connecting' ? 'CONNECTING…' : 'RECONNECTING…'}`;
    return;
  }
  const st = nflStatus();
  if (st.none) { el.classList.remove('on', 'quiet'); el.innerHTML = ''; return; }
  el.classList.toggle('quiet', !st.live);
  const body = st.live
    ? `<span class="dot"></span>LIVE${S.liveAt ? ` ${time(S.liveAt)}` : ''}`
    : st.next
      ? `NEXT ${escape(st.next.away)} @ ${escape(st.next.home)} · ${escape(kickoff(st.next.kickoff))}`
      : 'ALL GAMES FINAL';
  el.innerHTML = `${body}${feedDown ? '<span class="feed-down">· SLEEPER POINTS, FEED DOWN</span>' : ''}`;
}

// --- Swing gutter (shared by both views) -----------------------------------
function gutterHtml(slot, a, b, ridA, ridB) {
  const has = !!(a && b);
  const d = has ? (a.pts || 0) - (b.pts || 0) : 0;
  return `<div class="gutter" ${has ? `data-swing="${ridA}:${a.id}|${ridB}:${b.id}"` : ''}>
      <div class="gutter-top">${slot}${has ? diffHtml(d) : '<span class="diff"></span>'}</div>
      ${swingBar(has ? d : 0)}
    </div>`;
}
// The swing reads as a temperature: yellow when close either way, climbing to
// green as you pull ahead and falling through orange to red as you drop back.
// Interpolated in OKLCH so the middle of the range does not muddy the way a
// straight hex lerp would.
//
// The brief specified oklch(0.82 0.19 <hue>) with hue swept from the centre,
// but that lightness and chroma leave the sRGB gamut at the ends: rasterised,
// -20 came out a washed #ff8d77 rather than red, 120 away from the brief's own
// reference colour. Interpolating between those reference endpoints instead
// keeps the OKLCH path and lands the ends exactly.
const SWING_CLAMP = 20;       // one position row
const GAME_CLAMP = 30;        // a whole NFL game swings further
function swingColor(d, clamp = SWING_CLAMP) {
  const t = Math.min(Math.abs(d) / clamp, 1);
  const end = d >= 0 ? 'var(--swing-ahead)' : 'var(--swing-behind)';
  return `color-mix(in oklch, ${end} ${(t * 100).toFixed(1)}%, var(--swing-even))`;
}

// Length grows out from a centre tick, leaning toward whoever is winning: your
// players sit in the left column, so being ahead tips the bar left and being
// behind tips it right. The colour is solid at the outer tip and fades back to
// the tick, so the brightest part is the end that shows the distance.
function swingBar(d, clamp = SWING_CLAMP) {
  const t = Math.min(Math.abs(d) / clamp, 1);
  const w = (t * 50).toFixed(2);
  const c = swingColor(d, clamp);
  const fill = Math.abs(d) < 0.005 ? ''
    : d > 0
      ? `<i style="right:50%;width:${w}%;background:linear-gradient(270deg,transparent,${c})"></i>`
      : `<i style="left:50%;width:${w}%;background:linear-gradient(90deg,transparent,${c})"></i>`;
  return `<div class="swing"><span class="tick"></span>${fill}</div>`;
}

// The number carries the same colour as its bar, so the column scans as a strip.
function diffHtml(d, clamp = SWING_CLAMP) {
  if (Math.abs(d) < 0.005) return '<span class="diff even">even</span>';
  return `<span class="diff" style="color:${swingColor(d, clamp)}">${diffText(d)}</span>`;
}
function diffClass(d, has) { if (!has || Math.abs(d) < 0.005) return 'even'; return d > 0 ? 'you' : 'opp'; }
function diffText(d) {
  if (Math.abs(d) < 0.005) return 'even';
  return `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}`;
}

// --- By position -----------------------------------------------------------
// Theater's compressed roster. Lineup-slot order always, never sorted by
// swing: re-sorting would move a player between refreshes, and the slot order
// is how a lineup is read. The opponent's score is absent because the swing
// already encodes it, and the full rows are one click away.
// The switch-game block, rendered either in the video column or, in theater,
// at the top of the right column.
function gameListHtml(pair) {
  const { withGame, watched, live } = watchedOf(gameBuckets(pair));
  return `<div class="games-side">`
    + `<div class="switch-hd"><span class="sh-lbl">Switch game</span><span class="sh-count">${live.length} live</span></div>`
    + `<div class="switch-rail"><div class="switch-list">${switchListHtml(withGame, watched)}</div></div>`
    + `</div>`;
}

// Theater's By NFL game column: your players grouped under their game, live
// first and biggest mover at the top. Only your side appears; the header's
// swing already encodes the difference, and a 400px column has no room for two
// bar columns, so the player rows carry no bar.
function byGameColumnHtml(pair) {
  const list = gameBuckets(pair);
  const slotOf = new Map();
  starterSlots().forEach((slot, i) => {
    const id = (pair.a.m.starters || [])[i];
    if (id && id !== '0') slotOf.set(id, SLOT_LABEL[slot] || slot);
  });
  const watchedId = watchedOf(list).game?.id;
  const mineIn = (bk) => bk.a.filter((x) => !x.bench);
  const swingOf = (bk) => bk.a.filter((x) => !x.bench).reduce((t, x) => t + (x.pts || 0), 0)
    - bk.b.filter((x) => !x.bench).reduce((t, x) => t + (x.pts || 0), 0);

  const withMine = list.filter((bk) => bk.game && mineIn(bk).length);
  const live = withMine.filter((bk) => bk.game.state === 'live')
    .sort((x, y) => Math.abs(swingOf(y)) - Math.abs(swingOf(x)));
  const started = withMine.filter((bk) => bk.game.state === 'final');
  const pending = withMine.filter((bk) => bk.game.state === 'pre');

  const group = (bk) => {
    const g = bk.game, d = swingOf(bk);
    const watched = g.id === watchedId;
    const state = g.state === 'live' ? `<span class="bg-state live">${escape(g.detail || 'Live')}</span>`
      : g.state === 'final' ? '<span class="bg-state">FINAL</span>'
      : `<span class="bg-state">${escape(shortKick(g.kickoff))}</span>`;
    const rows = mineIn(bk).map((x) => `<div class="bg-row">`
      + `<span class="bg-slot">${escape(slotOf.get(x.id) || '')}</span>`
      + `<span class="bg-name">${escape(x.pos === 'DEF' ? x.name : initialSurname(x.name))}</span>`
      + `<span class="bg-pts" data-pts="${x.rosterId}:${x.id}">${fmt(x.pts)}</span>`
      + `</div>`).join('');
    return `<div class="bg-group">`
      + `<button type="button" class="bg-head ${g.state === 'live' ? 'live' : ''} ${watched ? 'watched' : ''}" data-watch="${g.id}" aria-pressed="${watched}">`
      + `<span class="bg-line"><span class="bg-score">${g.away} ${g.awayScore} @ ${g.home} ${g.homeScore}</span>${state}</span>`
      + `<span class="bg-swing">${mineIn(bk).length ? diffHtml(d, GAME_CLAMP) : ''}</span>`
      + `<span class="bg-bar">${mineIn(bk).length ? swingBar(d, GAME_CLAMP) : ''}</span>`
      + `</button>${rows}</div>`;
  };

  const shown = [...live, ...started];
  const body = shown.map(group).join('');
  const empty = live.length ? '' : `<div class="bg-empty">None of ${escape(pair.a.name)}’s starters are playing right now</div>`;
  const seen = new Set(shown.map((bk) => bk.game.id));
  const rest = list.filter((bk) => bk.game && !seen.has(bk.game.id));
  const later = rest.length
    ? `<button type="button" class="later-toggle" data-bg-later>Other games (${rest.length}) ⌄</button>`
    : '';
  const laterRows = S.bgLaterOpen ? rest.map(group).join('') : '';
  return `<div class="bygame"><div class="mini-hd"><span class="mini-lbl">By game</span><span class="mini-sub">${escape(pair.a.name)} starters</span></div>`
    + empty + body + later + laterRows + `</div>`;
}

function compressedStartersHtml(p) {
  const slots = starterSlots();
  const A = p.a.m.starters || [], B = p.b?.m.starters || [];
  const rows = slots.map((slot, i) => {
    const a = A[i] && A[i] !== '0' ? player(A[i], p.a.m) : null;
    const b = p.b && B[i] && B[i] !== '0' ? player(B[i], p.b.m) : null;
    const has = !!(a && b);
    const d = has ? (a.pts || 0) - (b.pts || 0) : 0;
    const name = a ? (a.pos === 'DEF' ? a.name : initialSurname(a.name)) : '\u2013';
    return `<div class="mini-row"${has ? ` data-swing="${p.a.m.roster_id}:${a.id}|${p.b.m.roster_id}:${b.id}"` : ''}>`
      + `<span class="mini-slot">${escape(SLOT_LABEL[slot] || slot)}</span>`
      + `<span class="mini-name ${a && !a.pts ? 'zero' : ''}">${escape(name)}</span>`
      + `<span class="mini-swing">${has ? diffHtml(d) : ''}</span>`
      + `<span class="mini-bar">${swingBar(has ? d : 0)}</span>`
      + `</div>`;
  }).join('');
  return `<div class="mini">`
    + `<div class="mini-hd"><span class="mini-lbl">Starters</span><span class="mini-sub">${escape(p.a.name)} vs ${escape(p.b?.name || 'Bye')}</span></div>`
    + rows
    + `</div>`;
}

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
  const foot = `<div class="starter-foot"><span class="secondary">What's left to play (${leftA} vs ${leftB})</span></div>`;
  const benchRows = Array.from({ length: n }, (_, i) => `
      <div class="slot-row">
        ${benchA[i] ? sideHtml(player(benchA[i], p.a.m), p.a.m.roster_id, 'a', { bench: true }) : emptySide('a')}
        ${gutterHtml('BN', null, null)}
        ${benchB[i] ? sideHtml(player(benchB[i], p.b.m), p.b.m.roster_id, 'b', { bench: true }) : emptySide('b')}
        ${benchA[i] ? sheetHtml(p.a.m.roster_id, player(benchA[i], p.a.m)) : ''}${benchB[i] ? sheetHtml(p.b.m.roster_id, player(benchB[i], p.b.m)) : ''}
      </div>`).join('');

  const benchBlock = n
    ? `<div class="bench-hd">Bench (${benchA.length} vs ${benchB.length})</div><div class="bench-block">${benchRows}</div>`
    : '';
  return `<div class="starters">
    <div class="slot-row roster-heading">
      <h2 class="roster-team a">${escape(p.a.name)}</h2>
      <span aria-hidden="true"></span>
      <h2 class="roster-team b">${escape(p.b?.name || 'Bye')}</h2>
    </div>
    ${rows}</div>${benchBlock}${foot}`;
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
function gameBuckets(p) {
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
  return list;
}

// The left column, built on its own so a re-render can replace it without
// touching the <iframe> in the aside.
function gamesColumnHtml(list) {
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
          ${gameGutterHtml()}
          ${b ? sideHtml(b, b.rosterId, 'b', { bench: b.bench, compact: true }) : emptyGameSide('b')}
          ${a ? sheetHtml(a.rosterId, a) : ''}${b ? sheetHtml(b.rosterId, b) : ''}
        </div>`;
    }).join('');
    return `<div class="game-grp">${gameBarHtml(bk, startersA, startersB, totA, totB)}${rows}</div>`;
  }).join('');

  const laterHtml = later.length
    ? `<div class="later-hd">Not playing yet · ${later.length} game${later.length !== 1 ? 's' : ''}</div>${later.map(laterLineHtml).join('')}`
    : '';

  return `${liveHtml}${laterHtml}`;
}

function gameViewHtml(p) {
  return `<div class="games">${gamesColumnHtml(gameBuckets(p))}</div>`;
}

// Single-line game bar: teams + score, the game's swing, and inline totals.
function gameBarHtml(bk, startersA, startersB, totA, totB) {
  const g = bk.game;
  const totKey = (arr) => arr.map((x) => `${x.rosterId}:${x.id}`).join(',');
  return `
    <div class="game-bar ${g.state === 'live' ? 'live' : ''}">
      <div class="gb-line">
        <a class="gb-fix espn-link" href="${espnGameUrl(g)}" target="_blank" rel="noopener noreferrer" title="Box score on ESPN">
          <img class="gb-logo" src="${logo(g.away)}" alt="" onerror="this.remove()"><span class="gb-abbr">${g.away}</span> <span class="gb-score" data-game-score="${g.away}:away">${g.awayScore}</span>
          <span class="gb-at">@</span>
          <img class="gb-logo" src="${logo(g.home)}" alt="" onerror="this.remove()"><span class="gb-abbr">${g.home}</span> <span class="gb-score" data-game-score="${g.home}:home">${g.homeScore}</span>
        </a>
        <span class="gb-clock ${g.state === 'live' ? '' : 'pre'}" data-game-status="${g.home}">${gameStatusText(g)}</span>
      </div>
      <div class="gb-swing" data-gswing="${totKey(startersA)}|${totKey(startersB)}">${gameSwingHtml(totA - totB)}</div>
      <div class="gb-tot" data-tot-a="${totKey(startersA)}" data-tot-b="${totKey(startersB)}"><b class="ta">${fmt(totA)}</b> ${escape(matchupLabels().a)} · <b class="tb">${fmt(totB)}</b> ${escape(matchupLabels().b)}</div>
    </div>`;
}

// Swing gutter for the game view: no side rules, thinner bar, nothing at all
// when only one side has a player in the game.
// No per-row swing here. Rows in this view pair whatever sorts into the same
// index, so a QB could sit opposite a kicker and the difference between them
// would mean nothing. The swing that matters is the game's, in the bar above.
function gameGutterHtml() {
  return '<div class="gutter game"></div>';
}

const gameSwingHtml = (d) => `${diffHtml(d, GAME_CLAMP)}${swingBar(d, GAME_CLAMP)}`;

// One collapsed line per non-live game (upcoming, final, bye, free agents).
function laterLineHtml(bk) {
  const g = bk.game;
  const name = g ? `${g.away} @ ${g.home}` : (bk.team ? `${escape(bk.team)} bye` : 'Free agents');
  const isFinal = g && g.state === 'final';
  const time = g ? (isFinal ? 'FINAL' : shortKick(g.kickoff)) : '';
  const who = [...bk.a, ...bk.b].map((x) => `${escape(shortName(x))}${x.pts ? ` ${fmt(x.pts)}` : ''}`).join(' · ');
  const labels = matchupLabels();
  const count = `${escape(labels.a)}: ${bk.a.length} · ${escape(labels.b)}: ${bk.b.length}`;
  return `<button type="button" class="later-line" ${g ? `data-watch="${g.id}"` : ''}><span class="ll-name">${name}${time ? `<span class="ll-time ${isFinal ? 'final' : ''}">${time}</span>` : ''}</span><span class="ll-players">${who}</span><span class="ll-count">${count}</span></button>`;
}

const emptyGameSide = (sideKey) => `<div class="side ${sideKey} compact empty"></div>`;

function gameStatusText(g) {
  if (g.state === 'live') return escape(g.detail || 'Live');
  if (g.state === 'final') return escape(g.detail || 'Final');
  return escape(kickoff(g.kickoff));
}

// --- Video slot ------------------------------------------------------------
let watchedGame = null;   // the game the video box is currently pointed at
let srcState = { key: null, options: [], idx: 0, live: null, open: false, auto: null };

function watchedOf(list) {
  const withGame = list.filter((bk) => bk.game && (bk.a.length + bk.b.length) > 0);
  const live = withGame.filter((bk) => bk.game.state === 'live');
  const watched = withGame.find((bk) => bk.game.id === S.watchGameId) || live[0] || null;
  return { withGame, watched, live, game: watched?.game || null };
}
const gameTitle = (g) => (g ? `${g.away} @ ${g.home}` : '–');

// "3rd 11:02" reads as "3RD · 11:02" in the scoreboard band.
function bandClock(g) {
  if (!g) return '';
  if (g.state === 'final') return escape((g.detail || 'Final').toUpperCase());
  if (g.state !== 'live') return escape(kickoff(g.kickoff).toUpperCase());
  const d = (g.detail || 'Live').trim();
  const m = d.match(/^(\S+)\s+(.+)$/);
  return escape((m ? `${m[1]} · ${m[2]}` : d).toUpperCase());
}

// The game ids come from ESPN's scoreboard, so they address its box score
// directly. Only the places that present a game as a label get the link;
// the switch-game cells and the by-game headers are buttons that pick a
// stream, and a link inside a button would be invalid and steal the click.
const ESPN_GAME = 'https://www.espn.com/nfl/game/_/gameId/';
const espnGameUrl = (g) => (g && g.id ? ESPN_GAME + encodeURIComponent(g.id) : null);

const ICON = {
  chevron: (up) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="${up ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'}"/></svg>`,
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  reload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
};

function videoAsideHtml(list) {
  const { withGame, watched, live, game } = watchedOf(list);
  watchedGame = game;
  const note = startersNote(watched);
  const hint = `${withGame.length} game${withGame.length !== 1 ? 's' : ''} · ${live.length} live`;
  return `
    <aside class="watch">
      <div class="watch-hd"><span class="wh-lbl">Watching</span><a class="wh-game espn-link" href="${espnGameUrl(game) || '#'}" target="_blank" rel="noopener noreferrer" title="Box score on ESPN">${escape(gameTitle(game))}</a><span class="wh-note">${escape(note)}</span></div>
      ${playerHtml(game)}
      <div class="video-bar">
        <button type="button" class="vb-btn" data-vid="theater" aria-pressed="${S.theater}" title="Theater mode (t)">${S.theater ? 'Exit theater' : 'Theater'}</button>
        <span class="vb-lbl">Source</span>
        <div class="src" id="src-menu"></div>
      </div>
      <div class="switch-hd"><span class="sh-lbl">Switch game</span><span class="sh-count">${escape(hint)}</span><span class="sh-more" hidden>Scroll for more →</span></div>
      <div class="switch-rail"><div class="switch-list">${switchListHtml(withGame, watched)}</div><span class="sr-fade" hidden></span></div>
    </aside>`;
}

// The player is one bordered block: scoreboard band, frame, chrome bar.
function playerHtml(g) {
  const src = g && VIDEO_BASE ? PROVIDER.embedUrl(g) : null;
  if (!src) {
    return `<div class="player"><div class="video-box" id="video-box"><div class="pl-state on err">${ICON.alert}<span class="pl-state-lbl">No live game to watch</span></div></div></div>`;
  }
  return `
    <div class="player">
      <div class="pl-band">
        <span class="pb-clock" id="pb-clock">${bandClock(g)}</span>
        <span class="pb-score" id="pb-score">${scoreLineHtml(g)}</span>
      </div>
      <div class="video-box" id="video-box">
        <iframe id="video-frame" src="${escape(src)}" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen frameborder="0" title="${escape(gameTitle(g))}"></iframe>
        <div class="pl-state on" id="pl-state"><span class="pl-ring"></span><span class="pl-state-lbl">Buffering</span></div>
      </div>
      <div class="pl-chrome">
        ${g.state === 'live' ? '<span class="pl-live"><span class="pl-dot"></span>Live</span>' : `<span class="pl-off">${escape(g.state === 'final' ? 'Final' : 'Not started')}</span>`}
        <div class="pl-right">
          <button type="button" class="pl-btn" data-vid="reload" title="Reload this source (r)" aria-label="Reload this source">${ICON.reload}</button>
        </div>
      </div>
    </div>`;
}

const scoreLineHtml = (g) => `<span class="ps-t">${g.away}</span><span class="ps-n">${g.awayScore}</span><span class="ps-x">·</span><span class="ps-t">${g.home}</span><span class="ps-n">${g.homeScore}</span>`;

function switchListHtml(withGame, watched) {
  const cell = (bk) => {
    const gg = bk.game, count = bk.a.length + bk.b.length;
    const active = watched && gg.id === watched.game.id;
    const state = gg.state === 'live' ? '<span class="si-state live">LIVE</span>'
      : gg.state === 'final' ? '<span class="si-state">FINAL</span>'
      : `<span class="si-state">${escape(shortKick(gg.kickoff))}</span>`;
    const sub = `${active ? 'Watching · ' : ''}${count} player${count !== 1 ? 's' : ''}`;
    return `<button type="button" class="switch-item ${active ? 'active' : ''} ${gg.state === 'live' ? 'is-live' : ''}" data-watch="${gg.id}"><span class="si-top"><span class="si-name">${gg.away} @ ${gg.home}</span>${state}</span><span class="si-sub">${escape(sub)}</span></button>`;
  };
  const empty = '<div class="empty-col">No games with players in this matchup</div>';
  // Live games first; the rest sit behind a count, since a dock column has no
  // room for ten cells. The watched game always shows, wherever it sits.
  // Theater lists the grouped roster below, so the control only needs the game
  // being watched plus a way to reach the others.
  if (S.theater) {
    const rest = withGame.filter((bk) => !watched || bk.game.id !== watched.game.id);
    const head = watched ? cell(watched) : '';
    if (!S.laterOpen) {
      return (head + (rest.length ? `<button type="button" class="later-toggle">${rest.length} other game${rest.length !== 1 ? 's' : ''} ⌄</button>` : '')) || empty;
    }
    return (head + rest.map(cell).join('')) || empty;
  }
  const live = withGame.filter((bk) => bk.game.state === 'live');
  const later = withGame.filter((bk) => bk.game.state !== 'live');
  const watchedIsLater = later.some((bk) => watched && bk.game.id === watched.game.id);
  const tail = !later.length ? ''
    : (S.laterOpen || watchedIsLater) ? later.map(cell).join('')
    : `<button type="button" class="later-toggle">${later.length} later game${later.length !== 1 ? 's' : ''} \u2304</button>`;
  return (live.map(cell).join('') + tail) || empty;
}

// --- Video controls ---------------------------------------------------------
function setTheater(on) {
  S.theater = !!on;
  save({ theater: S.theater });
  document.body.classList.toggle('theater', S.theater);
  const btn = $('[data-vid="theater"]');
  if (btn) { btn.textContent = S.theater ? 'Exit theater' : 'Theater'; btn.setAttribute('aria-pressed', String(S.theater)); }
  const hint = $('#tabs-hint');
  if (hint) { hint.textContent = S.theater ? 'Theater on' : ''; hint.classList.toggle('on', S.theater); }
  const cur = current();
  if (cur) { renderContent(cur); updateWatchAside(cur); }
  renderRail();
  syncRailHint();
}
window.addEventListener('resize', syncRailHint);

function videoAction(kind) {
  if (kind === 'theater') return setTheater(!S.theater);
  if (kind === 'reload') return reloadSource();
}

// A hung stream needs the frame torn down, not just re-pointed: assigning the
// same src is a no-op in some browsers, and the provider's player would resume
// the same stalled session anyway. Committing about:blank first forces a cold
// start. Re-picking the current row selects nothing new, so this is the only
// way back from a stall on the same source.
function reloadSource() {
  const frame = $('#video-frame');
  if (!frame) return;
  const src = srcState.options[srcState.idx]?.url || frame.src;
  if (!src || src === 'about:blank') return;
  setPlayerState('buffering');
  frame.src = 'about:blank';
  setTimeout(() => { frame.src = src; }, 60);
}

// We cannot see inside a cross-origin frame, so this covers only what we can
// know: the frame has not finished loading, or there is no stream to load. A
// mid-stream stall is invisible from here, which is what Reload is for.
function setPlayerState(kind, label, reason) {
  const el = $('#pl-state');
  if (!el) return;
  el.dataset.kind = kind || '';
  if (!kind) { el.classList.remove('on', 'err'); el.innerHTML = ''; return; }
  el.classList.add('on');
  el.classList.toggle('err', kind === 'error');
  if (kind !== 'error') {
    el.innerHTML = `<span class="pl-ring"></span><span class="pl-state-lbl">${escape(label || 'Buffering')}</span>`;
    return;
  }
  el.innerHTML = ICON.alert
    + `<span class="pl-state-lbl">${escape(label || 'Stream not available')}</span>`
    + `<span class="pl-state-why">${escape(reason || 'This game has no feed right now.')}</span>`
    + `<button type="button" class="pl-retry" data-vid="retry">Try again</button>`;
  $('.pl-retry')?.addEventListener('click', retryStream);
}

// A stream we know does not exist must not be framed: the provider answers the
// embed URL with JSON, and the browser renders its own JSON viewer inside our
// 16:9 box. Blank the frame and show the designed block instead.
function noStream(reason) {
  const frame = $('#video-frame');
  if (frame && frame.src !== 'about:blank') frame.src = 'about:blank';
  setPlayerState('error', 'Stream not available', reason);
}

function retryStream() {
  const key = srcState.key;
  srcState.key = null;              // force the next sync to refetch
  setPlayerState('buffering');
  if (watchedGame) syncStream(watchedGame);
  else srcState.key = key;
}

// --- Source menu ------------------------------------------------------------
// The provider's sources API lists the live variants for a stream key. "Auto"
// is the bare embed URL, which is what the player resolves on its own.
async function syncStream(g) {
  const key = g ? streamKey(g) : null;
  if (!key) { srcState = { key: null, options: [], idx: 0, live: null, open: false }; return renderSource(); }
  if (srcState.key === key) return renderSource();
  srcState = { key, options: [], idx: 0, live: null, open: false, auto: g ? PROVIDER.embedUrl(g) : null };
  let data = null;
  try { data = await backend.getStream(key); } catch { /* keep the constructed URL */ }
  if (srcState.key !== key) return;               // switched games while in flight
  if (data) {
    srcState.options = buildOptions(data.sources || [], srcState.auto);
    srcState.live = data.live;
    srcState.idx = bestOptionIdx(srcState.options);
    if (!data.live && !(data.sources || []).length) noStream('This game has no feed right now.');
    else applySource();
  }
  renderSource();
}

// Lowest rung first, Auto last, matching the handoff's order.
function buildOptions(list, auto) {
  const res = (label) => Number(label.match(/^(\d{3,4})p/)?.[1] || 0);
  const variants = list
    .map((u, i) => ({ label: sourceLabel(u, i), url: u }))
    .sort((a, b) => res(a.label) - res(b.label));
  if (variants.length && res(variants[0].label)) variants[0].tag = 'Data saver';
  return auto ? [...variants, { label: 'Auto', url: auto }] : variants;
}

// Highest explicit resolution, never Auto: Auto is the origin that stalls.
function bestOptionIdx(options) {
  let best = 0, bestRes = -1;
  options.forEach((o, i) => {
    const r = Number(o.label.match(/^(\d{3,4})p/)?.[1] || 0);
    if (r > bestRes) { bestRes = r; best = i; }
  });
  return best;
}

function applySource() {
  const frame = $('#video-frame'), src = srcState.options[srcState.idx]?.url;
  if (frame && src && frame.src !== src) { setPlayerState('buffering'); frame.src = src; }
}

function renderSource() {
  const host = $('#src-menu');
  if (!host) return;
  if (!srcState.options.length) { host.innerHTML = ''; host.hidden = true; return; }
  host.hidden = false;
  const cur = srcState.options[srcState.idx];
  const rows = srcState.options.map((o, i) => {
    const on = i === srcState.idx;
    return `<div class="src-row ${on ? 'on' : ''}" role="option" aria-selected="${on}" data-src="${i}" tabindex="-1">${escape(o.label)}${o.tag ? `<span class="src-tag">${escape(o.tag)}</span>` : ''}${on ? `<span class="src-check">${ICON.check}</span>` : ''}</div>`;
  }).join('');
  host.innerHTML = `
    <button type="button" class="src-trigger" aria-haspopup="listbox" aria-expanded="${srcState.open}">${escape(cur.label)}<span class="src-chev">${ICON.chevron(srcState.open)}</span></button>
    <div class="src-panel" role="listbox" ${srcState.open ? '' : 'hidden'}>${rows}</div>`;
  host.querySelector('.src-trigger').addEventListener('click', (e) => { e.stopPropagation(); toggleSource(!srcState.open); });
  host.querySelectorAll('[data-src]').forEach((r) => {
    r.addEventListener('click', () => pickSource(Number(r.dataset.src)));
    r.addEventListener('mouseenter', () => r.focus({ preventScroll: true }));
  });
  // Near the bottom of the viewport the panel would open off-screen, so flip it
  // above the trigger when there is not room below.
  const panel = host.querySelector('.src-panel');
  if (srcState.open && panel) {
    const t = host.getBoundingClientRect();
    panel.classList.toggle('up', t.bottom + 4 + panel.offsetHeight > window.innerHeight);
    host.querySelector('.src-row.on')?.focus({ preventScroll: true });
  }
}

function pickSource(i) {
  srcState.idx = i;
  srcState.open = false;
  applySource();
  renderSource();
  $('.src-trigger')?.focus();
}

function toggleSource(open) {
  srcState.open = open;
  renderSource();
}

// Arrow keys move, Enter selects, Escape closes, outside click closes.
function onSourceKey(e) {
  if (!srcState.open) return;
  const rows = [...document.querySelectorAll('.src-row')];
  const at = rows.indexOf(document.activeElement);
  if (e.key === 'Escape') { e.preventDefault(); toggleSource(false); $('.src-trigger')?.focus(); return; }
  if (e.key === 'Enter' || e.key === ' ') { if (at >= 0) { e.preventDefault(); pickSource(at); } return; }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  const next = e.key === 'ArrowDown' ? Math.min(rows.length - 1, at + 1) : Math.max(0, at - 1);
  rows[next < 0 ? 0 : next]?.focus({ preventScroll: true });
}
document.addEventListener('keydown', onSourceKey);
document.addEventListener('click', () => { if (srcState.open) toggleSource(false); });

// The scroll hint and the right-edge fade only earn their place when the rail
// actually overflows.
function syncRailHint() {
  const track = $('.switch-rail .switch-list'), more = $('.sh-more'), fade = $('.sr-fade');
  if (!track || !more || !fade) return;
  const over = S.theater && track.scrollWidth > track.clientWidth + 2;
  more.hidden = !over;
  fade.hidden = !over;
}

function bindLaterToggle(p) {
  app.querySelectorAll('.later-toggle').forEach((b) => b.addEventListener('click', () => {
    if (b.hasAttribute('data-bg-later')) { S.bgLaterOpen = true; renderContent(p); return; }
    S.laterOpen = true;
    updateWatchAside(p);
  }));
}

function bindVideoControls(root) {
  root.querySelectorAll('[data-vid]').forEach((b) => b.addEventListener('click', () => videoAction(b.dataset.vid)));
  const frame = root.querySelector('#video-frame');
  // about:blank commits during a reload; only a real source means "loaded".
  if (frame) frame.addEventListener('load', () => {
    const st = $('#pl-state');
    if (st?.dataset.kind === 'error') return;   // an error state outlives a load
    if (frame.src !== 'about:blank') setPlayerState(null);
  });
  root.querySelector('.switch-rail .switch-list')?.addEventListener('scroll', syncRailHint);
  requestAnimationFrame(syncRailHint);
}

// --- Player side cell -------------------------------------------------------
// compact: the By-NFL-game rows use a 20px team logo instead of the 40px
// headshot, which leaves room for the name in the narrower column.
// "Josh Allen" -> "J. Allen". The surname stays whole, because that is the part
// that identifies the player; a four-character truncation identifies nobody.
// Particles belong to the surname ("A. St. Brown", not "A. Brown"), and a
// suffix rides along after it.
const NAME_PARTICLE = /^(st\.?|van|von|de|del|della|di|da|dos|la|le|mac|o')$/i;
const NAME_SUFFIX = /^(Jr\.?|Sr\.?|I{2,3}|IV|V)$/i;
function initialSurname(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] || '';
  let end = parts.length - 1;
  let suffix = '';
  if (NAME_SUFFIX.test(parts[end]) && end > 1) { suffix = ` ${parts[end]}`; end -= 1; }
  let start = end;
  while (start > 1 && NAME_PARTICLE.test(parts[start - 1])) start -= 1;
  return `${parts[0][0]}. ${parts.slice(start, end + 1).join(' ')}${suffix}`;
}

function sideHtml(pl, rosterId, sideKey, { bench = false, compact = false } = {}) {
  const g = pl.game;
  let line = '', cls = '';
  if (!pl.team) line = 'Free agent';
  else if (!g) line = 'Bye';
  else {
    // Two tokens at most. The opponent is dropped: the position label already
    // carries the team, the game bar carries the fixture, and keeping it here
    // was what pushed the line into an ellipsis.
    if (g.state === 'live') { line = g.detail || 'Live'; cls = 'live'; }
    else if (g.state === 'final') {
      const mine = g.home === pl.team ? g.homeScore : g.awayScore, theirs = g.home === pl.team ? g.awayScore : g.homeScore;
      line = `${mine > theirs ? 'W' : mine < theirs ? 'L' : 'T'} ${mine}–${theirs}`; cls = 'final';
    } else line = kickoff(g.kickoff);
  }
  const pre = !g || g.state === 'pre';
  const isLive = !!(g && g.state === 'live');
  // Compact rows carry the game identity in the bar above, so they use a plain
  // 24px headshot with no team-logo badge.
  const av = compact
    ? `<div class="p-av compact">${avatarHtml(pl)}</div>`
    : `<div class="p-av">${avatarHtml(pl)}${pl.team && pl.pos !== 'DEF' ? `<img class="logo" src="${logo(pl.team)}" alt="" onerror="this.remove()">` : ''}</div>`;
  // Both spellings ship and a container query picks one, so a narrow column
  // shows "J. Allen" rather than "Josh...". No width has to be guessed in JS.
  const shortLabel = pl.pos === 'DEF' ? pl.name : initialSurname(pl.name);
  const nameCell = `<span class="p-full">${escape(pl.name)}</span><span class="p-abbr">${escape(shortLabel)}</span>`;
  const posLabel = `${pl.pos}${pl.team ? ` ${pl.team}` : ''}${bench ? ' · BENCH' : ''}`;
  const who = `<div class="p-who">`
    + `<div class="p-name">${nameCell}${pl.injury ? `<span class="inj">${escape(injAbbr(pl.injury))}</span>` : ''}</div>`
    + `<div class="p-line"><span class="p-pos">${escape(posLabel)}</span>${line ? ` · <span class="p-state ${cls}">${escape(line)}</span>` : ''}</div>`
    + `</div>`;
  const pts = `<div class="p-pts ${pre && !pl.pts ? 'pre' : ''}" data-pts="${rosterId}:${pl.id}">${fmt(pl.pts)}</div>`;
  const cells = sideKey === 'a' ? [av, who, pts] : [pts, who, av];
  return `<div class="side ${sideKey} ${compact ? 'compact' : ''} ${isLive && !compact ? 'live' : ''} ${bench ? 'bench' : ''}" data-sheet-for="${rosterId}:${pl.id}" tabindex="0" role="button" aria-expanded="false">${cells.join('')}</div>`;
}

function avatarHtml(pl) {
  if (pl.pos === 'DEF' && pl.team) return `<img class="head def" src="${logo(pl.team)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'init',textContent:'${initials(pl.name)}'}))">`;
  // Sleeper IDs are always available; ESPN IDs are missing for many players.
  const src = pl.id ? `https://sleepercdn.com/content/nfl/players/${encodeURIComponent(pl.id)}.jpg` : null;
  const fallback = pl.espn ? `https://a.espncdn.com/i/headshots/nfl/players/full/${encodeURIComponent(pl.espn)}.png` : '';
  const init = escape(initials(pl.name));
  if (!src && !fallback) return `<div class="init">${init}</div>`;
  return `<img class="head" src="${src || fallback}" data-fallback="${src ? fallback : ''}" data-initials="${init}" alt="" loading="lazy" onerror="if(this.dataset.fallback){const next=this.dataset.fallback;delete this.dataset.fallback;this.src=next;}else{this.onerror=null;this.replaceWith(Object.assign(document.createElement('div'),{className:'init',textContent:this.dataset.initials}));}">`;
}

const emptySide = (sideKey) => `<div class="side ${sideKey} empty">–</div>`;
const sheetHtml = (rosterId, pl) => (pl ? `<details class="stat-sheet" data-sheet="${rosterId}:${pl.id}"><summary hidden></summary><div class="sheet-body" data-name="${escape(pl.name)}"></div></details>` : '');

function sheetBodyHtml(pid, rosterId) {
  const scoring = S.data.league.scoring_settings || {};
  const st = S.data.stats?.[pid];
  const sc = S.data.scored?.players?.[pid];
  const proj = S.data.proj?.[pid];
  if (!st && !proj) return `<div class="sheet-empty">${S.data.statsAvailable === false ? 'Live stat feed unavailable; showing Sleeper\'s points.' : 'No stats yet.'}</div>`;
  const rows = st ? breakdown(st, scoring) : [];
  const projRows = proj ? breakdown(proj, scoring) : [];
  return `
    ${rows.length ? `<table class="sheet"><tbody>${rows.map((r) => `<tr><td>${escape(r.label)}</td><td class="v">${fmtStat(r.value)}</td><td class="w">× ${fmtW(r.weight)}</td><td class="p">${r.points > 0 ? '+' : ''}${fmt(r.points)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="3">${sc?.src === 'official' ? 'Official' : 'Live, league scoring'}</td><td class="p">${fmt(playerPts(pid, rosterId))}</td></tr></tfoot></table>` : ''}
    ${proj ? `<section class="sheet-proj" aria-label="Projected performance">
      <div class="projection-summary">
        <div><div class="projection-label">Projected points</div><div class="projection-context">League scoring</div></div>
        <div class="projection-total">${fmt(sc?.proj ?? scorePlayer(proj, scoring))}<span>pts</span></div>
      </div>
      ${projRows.length ? `<dl class="projection-stats">${projRows.map((r) => `<div class="projection-stat">
        <dt>${escape(r.key === 'rec' ? 'Receptions' : r.label)}</dt>
        <dd>${fmtStat(r.value)}<span>${r.points > 0 ? '+' : ''}${fmt(r.points)} pts</span></dd>
      </div>`).join('')}</dl>` : '<div class="projection-context">No projected scoring stats</div>'}
    </section>` : ''}`;
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
  const opening = !sheet.open;
  // One breakdown at a time. Opening a player closes whichever was open,
  // including the opponent sharing the row.
  for (const other of app.querySelectorAll('.stat-sheet[open]')) {
    if (other === sheet) continue;
    other.open = false;
    app.querySelector(`[data-sheet-for="${other.dataset.sheet}"]`)?.setAttribute('aria-expanded', 'false');
  }
  sheet.open = opening;
  row.setAttribute('aria-expanded', String(opening));
  if (opening) { const [rid, pid] = row.dataset.sheetFor.split(':'); $('.sheet-body', sheet).innerHTML = sheetBodyHtml(pid, Number(rid)); }
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
