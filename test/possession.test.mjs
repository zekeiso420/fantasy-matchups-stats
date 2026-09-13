import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeGames} from '../public/nfl.js';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const board=(possession,type={state:'in'},away='NE')=>({events:[{id:'1',competitions:[{
  status:{type},situation:{possession},
  competitors:[{id:'26',homeAway:'home',team:{abbreviation:'SEA'}},{id:'17',homeAway:'away',team:{abbreviation:away}}]
}]}]});
test('possession resolves both sides and normalizes team aliases',()=>{
  assert.equal(summarizeGames(board('26')).SEA.possession,'SEA');
  assert.equal(summarizeGames(board(17)).NE.possession,'NE');
  assert.equal(summarizeGames(board('17',{state:'in'},'WSH')).WAS.possession,'WAS');
});
test('no marker data outside play or without a matching team',()=>{
  for(const value of [undefined,null,'999'])
    assert.equal(summarizeGames(board(value)).SEA.possession,null);
  for(const type of [{state:'pre'},{state:'post',completed:true},{state:'in',name:'STATUS_HALFTIME'}])
    assert.equal(summarizeGames(board('26',type)).SEA.possession,null);
});
test('marker is SVG and moving possession refreshes the UI',()=>{
  const start=source.indexOf('function possessionTeamHtml(');
  const render=runInNewContext(source.slice(start,source.indexOf('function switchListHtml(',start))+';possessionTeamHtml',{escape:String});
  const game={id:'1',state:'live',possession:'SEA'};
  assert.match(render(game,'SEA'),/<img/);
  assert.doesNotMatch(render(game,'NE'),/<img/);
  const k=source.indexOf('function structureKey()');
  const key=runInNewContext(source.slice(k,source.indexOf('function patchNumbers()',k))+';structureKey',{S:{data:{games:{SEA:game},matchups:[]}}});
  const before=key();game.possession='NE';assert.notEqual(key(),before);
  assert.doesNotMatch(render(game,'SEA'),/<img/);
  assert.match(render(game,'NE'),/<img/);
  game.halftime=true;assert.doesNotMatch(render(game,'NE'),/<img/);
});
