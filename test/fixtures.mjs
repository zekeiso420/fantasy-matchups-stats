// Shared fixtures for both the mock Node server and the static-mode
// Playwright route-interception test, so the two stay consistent.
export const players = Object.fromEntries([
  p('4984', 'Josh Allen', 'QB', 'BUF', 3918298), p('4046', 'Patrick Mahomes', 'QB', 'KC', 3139477),
  p('9509', 'Bijan Robinson', 'RB', 'ATL', 4430807), p('8138', 'Breece Hall', 'RB', 'NYJ', 4427366),
  p('9226', 'Jahmyr Gibbs', 'RB', 'DET', 4429795), p('6794', 'Justin Jefferson', 'WR', 'MIN', 4262921, 'Questionable'),
  p('7564', "Ja'Marr Chase", 'WR', 'CIN', 4362628), p('6801', 'CeeDee Lamb', 'WR', 'DAL', 4241389),
  p('8146', 'Garrett Wilson', 'WR', 'NYJ', 4569618), p('4034', 'Christian McCaffrey', 'RB', 'SF', 3117251),
  p('9758', 'Puka Nacua', 'WR', 'LAR', 4426515), p('5849', 'Kyle Pitts', 'TE', 'ATL', 4360248),
  p('1466', 'Travis Kelce', 'TE', 'KC', 15847), p('4199', 'Harrison Butker', 'K', 'KC', 3055899),
  p('7839', 'Cameron Dicker', 'K', 'LAC', 4362081),
  ['BAL', { first_name: 'Baltimore', last_name: 'Ravens', position: 'DEF', team: 'BAL' }],
  ['SF', { first_name: 'San Francisco', last_name: '49ers', position: 'DEF', team: 'SF' }],
]);
function p(id, n, pos, t, e, inj) {
  const parts = n.split(' ');
  return [id, { first_name: parts[0], last_name: parts.slice(1).join(' '), full_name: n, position: pos, team: t, espn_id: e, injury_status: inj || null }];
}

export const state = { week: 3, display_week: 3, season: '2026', league_season: '2026', season_type: 'regular' };

export const users = [
  { user_id: 'u1', username: 'caleb', display_name: 'Caleb', avatar: null, metadata: { team_name: 'Odenton Overtime' } },
  { user_id: 'u2', username: 'mike_r', display_name: 'Mike R', avatar: null, metadata: { team_name: 'The Replacements' } },
];

export const rosterA = { roster_id: 1, owner_id: 'u1', players: ['4984', '9509', '8138', '6794', '7564', '5849', '9226', '4199', 'BAL'] };
export const rosterB = { roster_id: 2, owner_id: 'u2', players: ['4046', '4034', '6801', '8146', '1466', '9758', '7839', 'SF'] };

export const league = {
  league_id: 'L1', name: 'Columbia Sunday Ball 2026', season: '2026', total_rosters: 2, status: 'in_season',
  settings: { playoff_week_start: 15, playoff_teams: 6 },
  roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN', 'BN'],
  scoring_settings: { pass_yd: 0.04, pass_td: 4, pass_int: -1, rush_yd: 0.1, rush_td: 6, rec: 0.5, rec_yd: 0.1, rec_td: 6, bonus_rec_te: 0.5, fgm_30_39: 3, fgm_40_49: 4, xpm: 1, sack: 1, int: 2, pts_allow_7_13: 3, fum_lost: -2 },
};

export const matchups = [
  { roster_id: 1, matchup_id: 1, starters: ['4984', '9509', '8138', '6794', '7564', '5849', '9226', '4199', 'BAL'], players_points: { 4984: 24.48, 9509: 14.4, 8138: 7.1, 6794: 0, 7564: 21.7, 5849: 3.5, 9226: 18.9, 4199: 9, BAL: 6 }, points: 105.08 },
  { roster_id: 2, matchup_id: 1, starters: ['4046', '4034', '6801', '8146', '1466', '9758', '7839', 'SF'], players_points: { 4046: 19.2, 4034: 22.4, 6801: 0, 8146: 6.3, 1466: 8.8, 9758: 15.5, 7839: 7, SF: 4 }, points: 90.68 },
];

const statRow = (id, st) => ({ player_id: id, stats: st });
export const weekStats = [
  statRow('4984', { pass_yd: 295, pass_td: 2, pass_int: 1, rush_yd: 22, rush_td: 1 }),
  statRow('9509', { rush_yd: 64, rush_td: 1, rec: 3, rec_yd: 20 }),
  statRow('1466', { rec: 4, rec_yd: 48, bonus_rec_te: 4 }),
];
export const projections = [statRow('6794', { rec: 6.2, rec_yd: 88, rec_td: 0.6 })];

function game(id, date, away, home, as, hs, s, detail, clock, period) {
  return { id, date, competitions: [{ status: { displayClock: clock, period, type: { state: s, completed: s === 'post', shortDetail: detail } }, competitors: [
    { homeAway: 'home', team: { abbreviation: home }, score: String(hs) }, { homeAway: 'away', team: { abbreviation: away }, score: String(as) },
  ] }] };
}
export const scoreboard = { events: [
  game('1', '2026-09-17T00:15Z', 'BUF', 'MIA', 31, 10, 'post', 'Final'),
  game('2', '2026-09-20T17:00Z', 'ATL', 'KC', 14, 17, 'in', '3rd 8:41', '8:41', 3),
  game('3', '2026-09-20T17:00Z', 'CIN', 'BAL', 27, 24, 'in', '4th 2:00', '2:00', 4),
  game('4', '2026-09-20T20:25Z', 'DAL', 'SF', 0, 0, 'pre', 'Sun 4:25 PM'),
  game('5', '2026-09-20T17:00Z', 'NYJ', 'NE', 3, 6, 'in', '2nd 0:52', '0:52', 2),
] };
