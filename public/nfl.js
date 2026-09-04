// Data-shaping logic shared by server.js and the static (GitHub Pages) client.
import { scorePlayer, expectedPoints, round2 } from './scoring.js';

export const SLEEPER = 'https://api.sleeper.app/v1';
export const SLEEPER_STATS = 'https://api.sleeper.com'; // undocumented stats/projections host
export const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';

// Sleeper's full player dump is ~5 MB. Keep only what the UI needs.
export function slimPlayers(raw) {
  const slim = {};
  for (const [id, p] of Object.entries(raw)) {
    if (!p.position) continue;
    slim[id] = {
      n: p.position === 'DEF' ? `${p.first_name} ${p.last_name}`.trim() : p.full_name || `${p.first_name} ${p.last_name}`.trim(),
      p: p.position,
      t: p.team || null,
      e: p.espn_id || null,
      s: p.injury_status || null,
    };
  }
  return slim;
}

// Sleeper weeks 19+ are ESPN postseason / Sleeper "post".
export function seasonInfo(state, week) {
  const w = Number(week);
  return { season: state.league_season || state.season, type: w > 18 ? 'post' : 'regular', week: w > 18 ? w - 18 : w };
}
export function scoreboardUrl(state, week) {
  const { season, type, week: w } = seasonInfo(state, week);
  return `${ESPN}/scoreboard?dates=${season}&seasontype=${type === 'post' ? 3 : 2}&week=${w}`;
}
export function feedUrls(kind, state, week) {
  const { season, type, week: w } = seasonInfo(state, week);
  return [`${SLEEPER_STATS}/${kind}/nfl/${season}/${w}?season_type=${type}`, `${SLEEPER}/${kind}/nfl/${type}/${season}/${w}`];
}

// ESPN → Sleeper team abbreviation differences.
export const TEAM_ALIAS = { WSH: 'WAS' };
const norm = (abbr) => TEAM_ALIAS[abbr] || abbr;
// Sleeper has used both JAX and JAC over the years; index the game under both.
const EXTRA_KEYS = { JAX: ['JAC'], JAC: ['JAX'] };

export function summarizeGames(scoreboard) {
  const games = {};
  for (const ev of scoreboard.events || []) {
    const comp = ev.competitions?.[0];
    if (!comp) continue;
    const home = comp.competitors?.find((c) => c.homeAway === 'home');
    const away = comp.competitors?.find((c) => c.homeAway === 'away');
    if (!home || !away) continue;
    const st = comp.status?.type || {};
    const game = {
      id: ev.id,
      kickoff: ev.date,
      home: norm(home.team?.abbreviation),
      away: norm(away.team?.abbreviation),
      homeName: home.team?.displayName || '',
      awayName: away.team?.displayName || '',
      homeScore: Number(home.score ?? 0),
      awayScore: Number(away.score ?? 0),
      state: st.state === 'in' ? 'live' : st.completed ? 'final' : 'pre', // pre | live | final
      detail: st.shortDetail || '',
      clock: comp.status?.displayClock || '',
      period: comp.status?.period || 0,
    };
    for (const t of [game.home, game.away]) {
      games[t] = game;
      for (const k of EXTRA_KEYS[t] || []) games[k] = game;
    }
  }
  return games;
}

export function normalizeStatFeed(data) {
  const out = {};
  if (Array.isArray(data)) {
    for (const row of data) if (row?.player_id && row.stats) out[row.player_id] = row.stats;
  } else if (data && typeof data === 'object') {
    for (const [id, st] of Object.entries(data)) if (st && typeof st === 'object') out[id] = st.stats || st;
  }
  return out;
}

// Score every rostered player under this league's rules. Returns
// { players: { [pid]: { pts, proj, exp, src } }, teams: { [roster_id]: { pts, exp } } }
export function scoreLeagueWeek({ league, matchups, rosters, stats, proj, games, players }) {
  const scoring = league.scoring_settings || {};
  const out = { players: {}, teams: {} };
  for (const m of matchups) {
    const roster = rosters.find((r) => r.roster_id === m.roster_id);
    const ids = new Set([...(roster?.players || []), ...(m.starters || [])].filter((id) => id && id !== '0'));
    let teamPts = 0, teamExp = 0;
    for (const pid of ids) {
      const team = players?.[pid]?.t;
      const game = team ? games?.[team] : null;
      const official = m.players_points?.[pid];
      const computed = stats?.[pid] ? scorePlayer(stats[pid], scoring) : null;
      // Final games: Sleeper's number is authoritative (stat corrections land there).
      // Live/pre: our computed number, which refreshes faster than the matchups feed.
      let pts, src;
      if (game?.state === 'final' && official != null) { pts = official; src = 'official'; }
      else if (computed != null) { pts = computed; src = 'live'; }
      else { pts = official ?? 0; src = 'official'; }
      const projected = proj?.[pid] ? scorePlayer(proj[pid], scoring) : 0;
      const exp = expectedPoints(pts, projected, game);
      out.players[pid] = { pts: round2(pts), proj: round2(projected), exp: round2(exp), src };
      if ((m.starters || []).includes(pid)) { teamPts += pts; teamExp += exp; }
    }
    out.teams[m.roster_id] = { pts: round2(teamPts), exp: round2(teamExp) };
  }
  return out;
}

