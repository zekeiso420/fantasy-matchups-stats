// Runs server.js with fetch() stubbed to return realistic Sleeper/ESPN fixtures.
// Usage: node test/mock-server.mjs   (then open http://localhost:3000/?u=caleb)
const P = (id, n, p, t, e) => [id, { first_name: n.split(' ')[0], last_name: n.split(' ').slice(1).join(' '), full_name: n, position: p, team: t, espn_id: e, injury_status: id === '6794' ? 'Questionable' : null }];
const players = Object.fromEntries([
  P('4984', 'Josh Allen', 'QB', 'BUF', 3918298), P('4046', 'Patrick Mahomes', 'QB', 'KC', 3139477),
  P('9509', 'Bijan Robinson', 'RB', 'ATL', 4430807), P('8138', 'Breece Hall', 'RB', 'NYJ', 4427366),
  P('9226', 'Jahmyr Gibbs', 'RB', 'DET', 4429795), P('6794', 'Justin Jefferson', 'WR', 'MIN', 4262921),
  P('7564', 'Ja\'Marr Chase', 'WR', 'CIN', 4362628), P('6801', 'CeeDee Lamb', 'WR', 'DAL', 4241389),
  P('8146', 'Garrett Wilson', 'WR', 'NYJ', 4569618), P('4034', 'Christian McCaffrey', 'RB', 'SF', 3117251),
  P('9758', 'Puka Nacua', 'WR', 'LAR', 4426515), P('5849', 'Kyle Pitts', 'TE', 'ATL', 4360248),
  P('1466', 'Travis Kelce', 'TE', 'KC', 15847), P('4199', 'Harrison Butker', 'K', 'KC', 3055899),
  P('7839', 'Cameron Dicker', 'K', 'LAC', 4362081),
  ['BAL', { first_name: 'Baltimore', last_name: 'Ravens', position: 'DEF', team: 'BAL' }],
  ['SF', { first_name: 'San Francisco', last_name: '49ers', position: 'DEF', team: 'SF' }],
  P('11566', 'Rome Odunze', 'WR', 'CHI', 4431299), P('7526', 'Trey Lance', 'QB', null, 4383351),
  P('8150', 'Kenneth Walker', 'RB', 'SEA', 4567048), P('6813', 'Jonathan Taylor', 'RB', 'IND', 4242335),
]);

const rosterA = { roster_id: 1, owner_id: 'u1', players: ['4984', '9509', '8138', '6794', '7564', '5849', '9226', '4199', 'BAL', '11566', '7526', '8150'] };
const rosterB = { roster_id: 2, owner_id: 'u2', players: ['4046', '4034', '6813', '6801', '8146', '1466', '9758', '7839', 'SF'] };
const others = [3, 4, 5, 6, 7, 8].map((i) => ({ roster_id: i, owner_id: `u${i}`, players: [] }));

const state = { week: 3, display_week: 3, season: '2026', league_season: '2026', season_type: 'regular' };
const users = [
  { user_id: 'u1', username: 'caleb', display_name: 'Caleb', avatar: null, metadata: { team_name: 'Odenton Overtime' } },
  { user_id: 'u2', username: 'mike_r', display_name: 'Mike R', avatar: null, metadata: { team_name: 'The Replacements' } },
  ...[3, 4, 5, 6, 7, 8].map((i) => ({ user_id: `u${i}`, username: `owner${i}`, display_name: `Owner ${i}`, avatar: null, metadata: {} })),
];
const league = { league_id: 'L1', name: 'Columbia Sunday Ball 2026', season: '2026', total_rosters: 8, status: 'in_season', settings: { playoff_week_start: 15, playoff_teams: 6 }, roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN', 'BN', 'BN'] };
const league2 = { ...league, league_id: 'L2', name: 'Work League (Dynasty)' };

let t = 0;
function matchups() {
  t += 1;
  const ppA = { 4984: 24.18 + t * 0.3, 9509: 14.4, 8138: 7.1, 6794: 0, 7564: 21.7, 5849: 3.5, 9226: 18.9, 4199: 9, BAL: 6, 11566: 4.2, 8150: 11.1 };
  const ppB = { 4046: 19.2, 4034: 22.4, 6813: 12.9, 6801: 0, 8146: 6.3, 1466: 8.8, 9758: 15.5, 7839: 7, SF: 4 };
  const sum = (pp, st) => st.reduce((a, id) => a + (pp[id] || 0), 0);
  const stA = ['4984', '9509', '8138', '6794', '7564', '5849', '9226', '4199', 'BAL'];
  const stB = ['4046', '4034', '6813', '6801', '8146', '1466', '9758', '7839', 'SF'];
  return [
    { roster_id: 1, matchup_id: 1, starters: stA, players_points: ppA, points: sum(ppA, stA) },
    { roster_id: 2, matchup_id: 1, starters: stB, players_points: ppB, points: sum(ppB, stB) },
    { roster_id: 3, matchup_id: 2, starters: [], players_points: {}, points: 88.4 },
    { roster_id: 4, matchup_id: 2, starters: [], players_points: {}, points: 91.02 },
    { roster_id: 5, matchup_id: 3, starters: [], players_points: {}, points: 54.1 },
    { roster_id: 6, matchup_id: 3, starters: [], players_points: {}, points: 60.75 },
    { roster_id: 7, matchup_id: 4, starters: [], players_points: {}, points: 0 },
    { roster_id: 8, matchup_id: 4, starters: [], players_points: {}, points: 0 },
  ];
}

const game = (id, date, away, home, as, hs, state, detail, clock, period) => ({
  id, date, competitions: [{ status: { displayClock: clock, period, type: { state, completed: state === 'post', shortDetail: detail } }, competitors: [
    { homeAway: 'home', team: { abbreviation: home }, score: String(hs) }, { homeAway: 'away', team: { abbreviation: away }, score: String(as) },
  ] }],
});
const scoreboard = { events: [
  game('1', '2026-09-17T00:15Z', 'BUF', 'MIA', 31, 10, 'post', 'Final'),
  game('2', '2026-09-20T17:00Z', 'ATL', 'KC', 14, 17, 'in', '3rd 8:41', '8:41', 3),
  game('3', '2026-09-20T17:00Z', 'NYJ', 'NE', 3, 6, 'in', '2nd 0:52', '0:52', 2),
  game('4', '2026-09-20T17:00Z', 'CIN', 'BAL', 27, 24, 'in', '4th 2:00', '2:00', 4),
  game('5', '2026-09-20T20:25Z', 'DET', 'SEA', 0, 0, 'pre', 'Sun 4:25 PM'),
  game('6', '2026-09-20T20:25Z', 'MIN', 'WSH', 0, 0, 'pre', 'Sun 4:25 PM'),
  game('7', '2026-09-21T00:20Z', 'DAL', 'SF', 0, 0, 'pre', 'Sun 8:20 PM'),
  game('8', '2026-09-22T00:15Z', 'LAR', 'LAC', 0, 0, 'pre', 'Mon 8:15 PM'),
  game('9', '2026-09-20T17:00Z', 'IND', 'CHI', 20, 20, 'post', 'Final/OT'),
] };

const statRow = (id, st) => ({ player_id: id, stats: st });
function weekStats() {
  return [
    statRow('4984', { pass_yd: 287 + t * 8, pass_td: 2, pass_int: 1, rush_yd: 22, rush_td: 1, pass_cmp: 21, pass_att: 30, bonus_pass_yd_300: t > 2 ? 1 : 0 }),
    statRow('9509', { rush_yd: 64, rush_td: 1, rec: 3, rec_yd: 20 }), statRow('8138', { rush_yd: 31, rec: 2, rec_yd: 20 }),
    statRow('7564', { rec: 7, rec_yd: 97, rec_td: 1 }), statRow('5849', { rec: 2, rec_yd: 15, bonus_rec_te: 2 }),
    statRow('4199', { fgm_40_49: 1, xpm: 3, fgm: 1 }), statRow('BAL', { sack: 2, int: 1, pts_allow_21_27: 1, pts_allow: 24 }),
    statRow('4046', { pass_yd: 212, pass_td: 2, pass_int: 0, rush_yd: 8 }), statRow('4034', { rush_yd: 84, rush_td: 1, rec: 4, rec_yd: 40 }),
    statRow('6813', { rush_yd: 69, rec: 3, rec_yd: 30 }), statRow('8146', { rec: 3, rec_yd: 33 }), statRow('1466', { rec: 4, rec_yd: 48, bonus_rec_te: 4 }),
    statRow('8150', { rush_yd: 61, rec: 2, rec_yd: 30 }), statRow('11566', { rec: 2, rec_yd: 22 }), statRow('7839', { xpm: 4, fgm_30_39: 1, fgm: 1 }),
    statRow('SF', { sack: 1, pts_allow_7_13: 1, pts_allow: 10 }),
  ];
}
const projections = [
  statRow('6794', { rec: 6.2, rec_yd: 88, rec_td: 0.6 }), statRow('6801', { rec: 7.1, rec_yd: 94, rec_td: 0.5 }), statRow('9226', { rush_yd: 78, rush_td: 0.7, rec: 4, rec_yd: 32 }),
  statRow('9758', { rec: 6.5, rec_yd: 81, rec_td: 0.4 }), statRow('4984', { pass_yd: 260, pass_td: 2.1, rush_yd: 30, rush_td: 0.5 }), statRow('4046', { pass_yd: 275, pass_td: 2.2 }),
  statRow('7564', { rec: 6, rec_yd: 85, rec_td: 0.6 }), statRow('4034', { rush_yd: 80, rush_td: 0.8, rec: 4.5, rec_yd: 38 }),
];
league.scoring_settings = { pass_yd: 0.04, pass_td: 4, pass_int: -1, rush_yd: 0.1, rush_td: 6, rec: 0.5, rec_yd: 0.1, rec_td: 6, bonus_rec_te: 0.5, bonus_pass_yd_300: 2, fgm_30_39: 3, fgm_40_49: 4, xpm: 1, sack: 1, int: 2, pts_allow_7_13: 3, pts_allow_21_27: 0, fum_lost: -2 };

const routes = [
  [/api\.sleeper\.com\/stats\/nfl\/\d+\/\d+/, () => weekStats()],
  [/api\.sleeper\.com\/projections\/nfl\/\d+\/\d+/, () => projections],
  [/\/state\/nfl$/, () => state],
  [/\/user\/caleb$/i, () => users[0]],
  [/\/user\/[^/]+$/, () => null],
  [/\/user\/u1\/leagues\/nfl\/\d+$/, () => [league, league2]],
  [/\/league\/L\d$/, (u) => (u.endsWith('L2') ? league2 : league)],
  [/\/league\/L\d\/rosters$/, () => [rosterA, rosterB, ...others]],
  [/\/league\/L\d\/users$/, () => users],
  [/\/league\/L\d\/matchups\/\d+$/, () => matchups()],
  [/\/players\/nfl$/, () => players],
  [/\/scoreboard\?/, () => scoreboard],
];

globalThis.fetch = async (url) => {
  const hit = routes.find(([re]) => re.test(url));
  if (!hit) return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => hit[1](url) };
};

await import('../server.js');
