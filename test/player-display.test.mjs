import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { breakdown, scorePlayer, STAT_LABEL } from '../public/scoring.js';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
function renderers(state) {
  // Exercise the actual DOM-free renderers without booting network subscriptions.
  const context = {
    S: state, breakdown, scorePlayer, STAT_LABEL,
    fmt: n => (Number(n) || 0).toFixed(2),
    fmtStat: n => Number.isInteger(n) ? String(n) : n.toFixed(1),
    escape: s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    playerPts: () => 0,
    current: () => ({a: {name: 'My team'}, b: {name: 'Opponent'}}),
    shortKick: () => '8:20 PM',
  };
  runInNewContext(
    section('const PANEL_STATS =', 'const fmtStat =') +
    section('function switchListHtml(', '// --- Video controls') +
    ';this.render = {sheetBodyHtml, switchListHtml};', context);
  return context.render;
}

test('finished zero-point players show Final and actual stats, not projections', () => {
  const state = {players: {p: {p: 'RB', t: 'SEA'}}, data: {
    league: {scoring_settings: {rush_yd: 0.1}}, games: {SEA: {state: 'final'}},
    stats: {p: {rush_yd: 0}}, proj: {p: {rush_yd: 80}}, scored: {players: {p: {proj: 8}}},
  }};
  const render = renderers(state);
  assert.match(render.sheetBodyHtml('p', 1), /sp-hd-lbl">Final/);
  assert.match(render.sheetBodyHtml('p', 1), /sp-hd-val">0.00/);
  state.data.games.SEA.state = 'live';
  assert.match(render.sheetBodyHtml('p', 1), /sp-hd-lbl">Live/);
  state.data.games.SEA.state = 'pre';
  assert.match(render.sheetBodyHtml('p', 1), /sp-hd-lbl">Projected/);
  assert.match(render.sheetBodyHtml('p', 1), /sp-hd-val">8.00/);
});

test('SF/LAR opponent bench player is identified separately from my starters', () => {
  const bk = {game: {id: 'sf-lar', state: 'live', away: 'SF', home: 'LAR'}, a: [], b: [{name: 'Davante Adams', bench: true}]};
  for (const theater of [false, true]) {
    const html = renderers({theater}).switchListHtml([bk], bk);
    assert.match(html, /My team: 0 starters/);
    assert.match(html, /Opponent: 0 starters · 1 bench/);
    assert.match(html, /Davante Adams \(bench\)/);
  }
});
