// Scoring engine shared by server.js (Node ESM) and app.js (browser ESM).
// Sleeper's league.scoring_settings and its per-player stat objects use the
// same key vocabulary (pass_yd, rec, rush_td, bonus_rec_te, pts_allow_0_6,
// idp_tkl, ...), so a league's points are Σ weight × stat.

export function scorePlayer(stats, scoring) {
  if (!stats || !scoring) return 0;
  let total = 0;
  for (const key in scoring) {
    const v = stats[key];
    if (typeof v === 'number' && v !== 0) total += v * scoring[key];
  }
  return round2(total);
}

// Per-category breakdown, sorted by absolute contribution, zeros dropped.
export function breakdown(stats, scoring) {
  if (!stats || !scoring) return [];
  const rows = [];
  for (const key in scoring) {
    const v = stats[key];
    if (typeof v !== 'number' || v === 0 || scoring[key] === 0) continue;
    rows.push({ key, label: STAT_LABEL[key] || key.replace(/_/g, ' '), value: v, weight: scoring[key], points: round2(v * scoring[key]) });
  }
  return rows.sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
}

// Fraction of a game that remains (1 = not started, 0 = final), from ESPN
// period + display clock. Used to blend actual points with projections.
export function fractionRemaining(game) {
  if (!game || game.state === 'pre') return 1;
  if (game.state === 'final') return 0;
  const period = game.period || 1;
  const [m, s] = (game.clock || '15:00').split(':').map(Number);
  const secsLeftInPeriod = (Number.isFinite(m) ? m * 60 : 900) + (Number.isFinite(s) ? s : 0);
  const totalSecs = 4 * 900;
  const elapsed = Math.min(period - 1, 4) * 900 + (900 - Math.min(secsLeftInPeriod, 900));
  return Math.max(0, Math.min(1, 1 - elapsed / totalSecs));
}

// Expected final points for one player given actual so far and a projection.
export function expectedPoints(actual, projected, game) {
  const a = Number(actual) || 0, p = Number(projected) || 0;
  if (!game) return a || p;                     // bye / FA: whatever we have
  const rem = fractionRemaining(game);
  if (rem >= 1) return Math.max(a, p);
  if (rem <= 0) return a;
  return round2(a + p * rem);
}

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export const STAT_LABEL = {
  pass_yd: 'Passing yards', pass_td: 'Passing TD', pass_int: 'Interception thrown', pass_2pt: 'Passing 2-pt', pass_cmp: 'Completions', pass_att: 'Pass attempts', pass_inc: 'Incompletions', pass_sack: 'Sacked',
  rush_yd: 'Rushing yards', rush_td: 'Rushing TD', rush_2pt: 'Rushing 2-pt', rush_att: 'Rush attempts', rush_fd: 'Rushing first down',
  rec: 'Reception', rec_yd: 'Receiving yards', rec_td: 'Receiving TD', rec_2pt: 'Receiving 2-pt', rec_fd: 'Receiving first down', rec_tgt: 'Target',
  fum: 'Fumble', fum_lost: 'Fumble lost', fum_rec_td: 'Fumble recovery TD',
  bonus_rec_te: 'TE reception bonus', bonus_rec_rb: 'RB reception bonus', bonus_rec_wr: 'WR reception bonus',
  bonus_pass_yd_300: '300+ passing yards', bonus_pass_yd_400: '400+ passing yards', bonus_rush_yd_100: '100+ rushing yards', bonus_rush_yd_200: '200+ rushing yards', bonus_rec_yd_100: '100+ receiving yards', bonus_rec_yd_200: '200+ receiving yards',
  fgm_0_19: 'FG 0–19', fgm_20_29: 'FG 20–29', fgm_30_39: 'FG 30–39', fgm_40_49: 'FG 40–49', fgm_50p: 'FG 50+', fgm_50_59: 'FG 50–59', fgm_60p: 'FG 60+', fgmiss: 'FG missed', fgm: 'FG made', xpm: 'XP made', xpmiss: 'XP missed',
  def_td: 'Defensive TD', def_st_td: 'Special teams TD', def_st_ff: 'ST forced fumble', def_st_fum_rec: 'ST fumble recovery', st_td: 'ST TD', st_ff: 'ST forced fumble', st_fum_rec: 'ST fumble recovery',
  sack: 'Sack', int: 'Interception', ff: 'Forced fumble', fum_rec: 'Fumble recovery', safe: 'Safety', blk_kick: 'Blocked kick', def_pr_td: 'Punt return TD', def_kr_td: 'Kick return TD',
  pts_allow_0: '0 points allowed', pts_allow_1_6: '1–6 points allowed', pts_allow_7_13: '7–13 points allowed', pts_allow_14_20: '14–20 points allowed', pts_allow_21_27: '21–27 points allowed', pts_allow_28_34: '28–34 points allowed', pts_allow_35p: '35+ points allowed',
  yds_allow_0_100: '0–100 yards allowed', yds_allow_100_199: '100–199 yards allowed', yds_allow_200_299: '200–299 yards allowed', yds_allow_300_349: '300–349 yards allowed', yds_allow_350_399: '350–399 yards allowed', yds_allow_400_449: '400–449 yards allowed', yds_allow_450_499: '450–499 yards allowed', yds_allow_500_549: '500–549 yards allowed', yds_allow_550p: '550+ yards allowed',
  idp_tkl: 'Tackle', idp_tkl_solo: 'Solo tackle', idp_tkl_ast: 'Assisted tackle', idp_tkl_loss: 'Tackle for loss', idp_sack: 'Sack', idp_int: 'Interception', idp_ff: 'Forced fumble', idp_fum_rec: 'Fumble recovery', idp_pass_def: 'Pass defended', idp_qb_hit: 'QB hit', idp_safe: 'Safety', idp_def_td: 'Defensive TD', idp_blk_kick: 'Blocked kick',
};
