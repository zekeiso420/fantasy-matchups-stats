// The engine is key-agnostic: points are the sum of weight x stat over every
// key the league defines. These cases pin that against the league's real
// settings with totals worked out by hand, so a change to the engine or to a
// stat-key spelling fails here rather than quietly mis-scoring a Sunday.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scorePlayer, breakdown } from '../public/scoring.js';

// Full PPR, no TE premium, no yardage bonuses.
const SCORING = {
  pass_yd: 0.04, pass_td: 4, pass_2pt: 2, pass_int: -1,
  rush_yd: 0.1, rush_td: 6, rush_2pt: 2,
  rec: 1, rec_yd: 0.1, rec_td: 6, rec_2pt: 2,
  fgm_0_19: 3, fgm_20_29: 3, fgm_30_39: 3, fgm_40_49: 4, fgm_50_59: 5, fgm_60p: 6,
  xpm: 1, fgmiss: -1, xpmiss: -1,
  def_td: 6, sack: 1, int: 2, fum_rec: 2, safe: 2, ff: 1, blk_kick: 2,
  pts_allow_0: 10, pts_allow_1_6: 7, pts_allow_7_13: 4, pts_allow_14_20: 1,
  pts_allow_21_27: 0, pts_allow_28_34: -1, pts_allow_35p: -4,
  def_st_td: 6, def_st_ff: 1, def_st_fum_rec: 1,
  st_td: 6, st_ff: 1, st_fum_rec: 1,
  fum_lost: -2, fum_rec_td: 6,
};

test('quarterback line', () => {
  // 275 x .04 = 11, +2 TD = 8, one pick = -1, 30 rush yards = 3.
  assert.equal(scorePlayer({ pass_yd: 275, pass_td: 2, pass_int: 1, rush_yd: 30 }, SCORING), 21);
});

test('receiver line is full PPR, not half', () => {
  // 7 catches = 7, 94 yards = 9.4, one TD = 6.
  assert.equal(scorePlayer({ rec: 7, rec_yd: 94, rec_td: 1 }, SCORING), 22.4);
  // The same line under half PPR would be 3.5 lower, which is the mistake this
  // guards against.
  assert.equal(scorePlayer({ rec: 7, rec_yd: 94, rec_td: 1 }, { ...SCORING, rec: 0.5 }), 18.9);
});

test('tight end gets no reception premium', () => {
  const line = { rec: 5, rec_yd: 60, rec_td: 1 };
  assert.equal(scorePlayer(line, SCORING), 17);
  assert.equal(scorePlayer(line, { ...SCORING, bonus_rec_te: 0.5 }), 17, 'no bonus_rec_te stat, so no effect');
});

test('kicker distance tiers', () => {
  // 0-39 all pay 3, then 4 / 5 / 6 by decade.
  assert.equal(scorePlayer({ fgm_30_39: 1 }, SCORING), 3);
  assert.equal(scorePlayer({ fgm_40_49: 1 }, SCORING), 4);
  assert.equal(scorePlayer({ fgm_50_59: 1 }, SCORING), 5);
  assert.equal(scorePlayer({ fgm_60p: 1 }, SCORING), 6);
  // A 47-yarder, a 52-yarder, three PATs, one miss: 4 + 5 + 3 - 1.
  assert.equal(scorePlayer({ fgm_40_49: 1, fgm_50_59: 1, xpm: 3, fgmiss: 1 }, SCORING), 11);
});

test('team defence line', () => {
  // 7-13 allowed = 4, three sacks = 3, two picks = 4, a recovery = 2, a TD = 6.
  assert.equal(scorePlayer({ pts_allow_7_13: 1, sack: 3, int: 2, fum_rec: 1, def_td: 1 }, SCORING), 19);
});

test('points allowed can go negative', () => {
  assert.equal(scorePlayer({ pts_allow_35p: 1, sack: 1 }, SCORING), -3);
  assert.equal(scorePlayer({ pts_allow_0: 1 }, SCORING), 10);
});

test('a shutout tier scoring zero contributes nothing', () => {
  // 21-27 allowed is worth 0, so it must not appear in a breakdown either.
  assert.equal(scorePlayer({ pts_allow_21_27: 1, sack: 2 }, SCORING), 2);
  const rows = breakdown({ pts_allow_21_27: 1, sack: 2 }, SCORING);
  assert.deepEqual(rows.map((r) => r.key), ['sack']);
});

test('special teams defence and returner are separate keys', () => {
  assert.equal(scorePlayer({ def_st_td: 1, def_st_ff: 1 }, SCORING), 7);
  assert.equal(scorePlayer({ st_td: 1, st_ff: 1 }, SCORING), 7);
});

test('fumbles', () => {
  assert.equal(scorePlayer({ rush_yd: 40, rush_td: 1, fum_lost: 1 }, SCORING), 8);
  assert.equal(scorePlayer({ fum_rec_td: 1 }, SCORING), 6);
});

test('unweighted stats in the feed are ignored', () => {
  // The feed carries far more keys than a league scores; anything the league
  // does not define must not leak into the total.
  assert.equal(scorePlayer({ rec: 3, rec_tgt: 9, pass_cmp: 4, idp_tkl: 6 }, SCORING), 3);
});

test('breakdown sorts by absolute contribution and labels keys', () => {
  // 9.4 yards, then 7 for the catches, then 6 for the score, then -2. At full
  // PPR seven receptions outweigh a touchdown, which is the ordering to hold.
  const rows = breakdown({ rec: 7, rec_yd: 94, rec_td: 1, fum_lost: 1 }, SCORING);
  assert.deepEqual(rows.map((r) => r.key), ['rec_yd', 'rec', 'rec_td', 'fum_lost']);
  assert.equal(rows.find((r) => r.key === 'fum_lost').points, -2);
  assert.equal(rows.find((r) => r.key === 'rec_yd').label, 'Receiving yards');
  assert.equal(rows.reduce((t, r) => t + r.points, 0), 20.4);
});
