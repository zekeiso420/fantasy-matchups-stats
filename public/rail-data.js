// Shared by the Node API and the static-host data adapter, never the renderer.
// Cells are grouped the way a box score reads - PASSING then RUSHING, RUSHING
// then RECEIVING - and each carries a third line under its value: the fantasy
// points it produced, or a piece of context when it produces none. Per
// STAT_STRIP_SPEC.md, sections 3 and 4.
//
// cell: [label, key, line, 'cond']
//   key    a stat key, a function that formats a paired value, or a pattern
//          matching the tiered keys that make up one cell
//   line   'P' for points from the league's own scoring settings, or a
//          function returning a context string (null when it is not knowable)
//   flags  'cond' - the cell only appears once its stat reaches 1, then stays
//          'loss' - the stat is a loss for the player who owns it, so it reads
//                   red whatever the league pays for it
const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : null);
const per = (a, b) => (b ? `${(a / b).toFixed(1)} avg` : null);
const num = (s, k) => (typeof s?.[k] === 'number' ? s[k] : 0);
// A denominator the feed does not carry is not a zero: projections have no
// target count, and some live feeds drop attempts. Show the numerator alone
// rather than "4/0", which reads as four catches on no targets.
// Counts are whole things - you cannot complete 18.4 passes - so a paired cell
// rounds to the nearest one. Every other stat carries a decimal, which only
// shows on a projection: live numbers are already whole and print as whole.
const whole = (v) => String(Math.round(v));
const dec = (v) => { const r = Math.round(v * 10) / 10; return Number.isInteger(r) ? String(r) : r.toFixed(1); };
const pair = (s, a, b) => (num(s, b) ? `${whole(num(s, a))}/${whole(num(s, b))}` : whole(num(s, a)));
const none = () => null;

const groups = {
  QB: [
    ['PASSING', [
      ['C/ATT', (s) => pair(s, 'pass_cmp', 'pass_att'), (s) => pct(num(s, 'pass_cmp'), num(s, 'pass_att'))],
      ['YDS', 'pass_yd', 'P'],
      ['TD', 'pass_td', 'P'],
      ['INT', 'pass_int', 'P', 'loss'],
    ]],
    ['RUSHING', [
      ['CAR', 'rush_att', (s) => per(num(s, 'rush_yd'), num(s, 'rush_att'))],
      ['YDS', 'rush_yd', 'P'],
      ['TD', 'rush_td', 'P'],
      ['LONG', 'rush_lng', none],
      ['FUM LOST', 'fum_lost', 'P', 'cond loss'],
    ]],
  ],
  RB: [
    ['RUSHING', [
      ['CAR', 'rush_att', (s) => per(num(s, 'rush_yd'), num(s, 'rush_att'))],
      ['YDS', 'rush_yd', 'P'],
      ['TD', 'rush_td', 'P'],
      ['LONG', 'rush_lng', none],
      ['FUM LOST', 'fum_lost', 'P', 'cond loss'],
    ]],
    ['RECEIVING', [
      ['REC/TGT', { value: (s) => pair(s, 'rec', 'rec_tgt'), points: 'rec' }, 'P'],
      ['YDS', 'rec_yd', 'P'],
      ['TD', 'rec_td', 'P'],
      ['LONG', 'rec_lng', none],
    ]],
  ],
  WR: [
    ['RECEIVING', [
      ['REC/TGT', { value: (s) => pair(s, 'rec', 'rec_tgt'), points: 'rec' }, 'P'],
      ['YDS', 'rec_yd', 'P'],
      ['TD', 'rec_td', 'P'],
      ['LONG', 'rec_lng', none],
    ]],
    ['RUSHING', [
      ['CAR', 'rush_att', (s) => per(num(s, 'rush_yd'), num(s, 'rush_att'))],
      ['YDS', 'rush_yd', 'P'],
      ['TD', 'rush_td', 'P'],
    ], 'cond'],
  ],
  K: [
    ['KICKING', [
      ['FG', { value: (s) => pair(s, 'fgm', 'fga'), points: /^fgm/ }, 'P'],
      ['XP', { value: (s) => pair(s, 'xpm', 'xpa'), points: /^xpm/ }, 'P'],
      ['TD', 'st_td', 'P'],
      ['LONG', 'fgm_lng', none],
      ['MISS', /^(fgmiss|xpmiss)/, 'P', 'cond loss'],
    ]],
  ],
  DEF: [
    ['DEFENSE', [
      ['SACK', 'sack', 'P'],
      ['INT', 'int', 'P'],
      ['FUM REC', 'fum_rec', 'P'],
      ['TD', 'def_td', 'P', 'cond'],
      ['SAFETY', 'safe', 'P', 'cond'],
    ]],
    ['ALLOWED', [
      // The number is the points a defence gave up; what it is worth is the
      // tier that number falls into, which is a different set of keys.
      ['PTS', { value: 'pts_allow', points: /^pts_allow/ }, 'P'],
      ['YDS', 'yds_allow', none],
    ]],
  ],
  IDP: [
    ['DEFENSE', [
      ['TACKLES', 'idp_tkl', 'P'],
      ['SACK', 'idp_sack', 'P'],
      ['INT', 'idp_int', 'P'],
      ['FUM REC', 'idp_fum_rec', 'P'],
      ['TD', 'idp_def_td', 'P', 'cond'],
    ]],
  ],
};

// A pattern cell - points allowed, a kicker's made kicks - has no single number
// to print, so it prints what it is worth instead and leaves the value to its
// points line.
function cellValue(stats, key) {
  if (key && key.value) return typeof key.value === 'function' ? key.value(stats || {}) : dec(num(stats, key.value));
  if (typeof key === 'function') return key(stats || {});
  if (key instanceof RegExp) return null;
  return dec(num(stats, key));
}

// What a cell is worth under this league's settings. A pattern gathers the
// tiered keys - pts_allow_0_6, fgm_40_49 - that are one cell between them.
function cellPoints(stats, scoring, key) {
  if (key && key.points) key = key.points;
  if (!stats || !scoring || typeof key === 'function') return null;
  let total = 0, seen = false;
  for (const k in scoring) {
    if (!(key instanceof RegExp ? key.test(k) : k === key)) continue;
    seen = true;
    const v = stats[k];
    if (typeof v === 'number' && v !== 0) total += v * scoring[k];
  }
  return seen ? Math.round(total * 100) / 100 : null;
}

const happened = (stats, key) => {
  if (key && key.points) key = key.points;
  if (typeof key === 'function' || !stats) return false;
  if (key instanceof RegExp) return Object.keys(stats).some((k) => key.test(k) && stats[k] >= 1);
  return num(stats, key) >= 1;
};

// Points, a context string, or nothing to say yet. An em dash rather than
// "0.00 pts", which would read as a claim that something happened.
function thirdLine(stats, scoring, key, line) {
  if (line !== 'P') {
    const text = typeof line === 'function' ? line(stats || {}) : null;
    return text ? { kind: 'ctx', text } : { kind: 'empty', text: '—' };
  }
  const pts = stats ? cellPoints(stats, scoring, key) : null;
  if (!pts) return { kind: 'empty', text: '—' };
  const body = `${Math.abs(pts).toFixed(2)} pts`;
  return pts < 0 ? { kind: 'neg', text: `−${body}` } : { kind: 'pts', text: body };
}

export function railGroups(position, stats, scoring) {
  const table = groups[position === 'TE' ? 'WR' : position] || groups.IDP;
  const out = [];
  for (const [label, cells, cond] of table) {
    if (cond && !cells.some(([, key]) => happened(stats, key))) continue;   // a whole group can be conditional too
    const rendered = [];
    for (const [cellLabel, key, line, flags = ''] of cells) {
      if (/cond/.test(flags) && !happened(stats, key)) continue;
      const value = cellValue(stats, key);
      const third = thirdLine(stats, scoring, key, line);
      rendered.push({
        label: cellLabel,
        value: value == null ? '—' : value,
        // Red is what a stat costs its owner, not what it is called: a
        // quarterback's interception is a loss, a defence's is a takeaway. The
        // ones marked as losses read red even in a league that pays nothing for
        // them, because a lost fumble is still a lost fumble.
        bad: /loss/.test(flags) ? Number(value) > 0 : third.kind === 'neg',
        line: third,
      });
    }
    if (rendered.length) out.push({ label, cells: rendered });
  }
  return out;
}

export function railPlayer(id, player, points, projection, stats, scoring, projected = false) {
  const position = player?.p || '', name = player?.n || `Player ${id}`;
  return {
    id: String(id), name, position, nflTeam: player?.t || '',
    initials: name.split(/\s+/).map((s) => s[0]).slice(0, 2).join(''),
    headshotUrl: position === 'DEF' ? `https://sleepercdn.com/images/team_logos/nfl/${String(player.t).toLowerCase()}.png` : `https://sleepercdn.com/content/nfl/players/${encodeURIComponent(id)}.jpg`,
    fallbackUrl: player?.e ? `https://a.espncdn.com/i/headshots/nfl/players/full/${encodeURIComponent(player.e)}.png` : '',
    points, projection: projection == null ? null : projection, projected,
    groups: railGroups(position, stats, scoring),
  };
}

export function gameRailPlayers({matchups,rosters,games,scored},matchupId,gameId,rosterId) {
  const sides=matchups.filter(m=>String(m.matchup_id)===String(matchupId));
  const mine=sides.find(m=>String(m.roster_id)===String(rosterId));
  if(!mine) return null;
  const select=m=>{
    if(!m)return [];
    const roster=rosters.find(r=>r.roster_id===m.roster_id);
    const lineup=(m.starters||[]).filter(id=>id&&id!=='0');
    return [...new Set([...(roster?.players||[]),...(m.starters||[])])].filter(id=>id&&id!=='0').map(id=>{
      const p=scored.players[id]?.rail;
      return p&&String(games[p.nflTeam]?.id)===String(gameId)?{...p,bench:!lineup.includes(id),slot:lineup.indexOf(id)}:null;
    }).filter(Boolean).sort((a,b)=>Number(a.bench)-Number(b.bench)||a.slot-b.slot);
  };
  return {mine:select(mine),opp:select(sides.find(m=>m!==mine))};
}
