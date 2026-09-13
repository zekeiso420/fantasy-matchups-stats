import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeGames} from '../public/nfl.js';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const board = type => ({events:[{id:'game',competitions:[{
  status:{type,period:2,displayClock:'0:00'},
  competitors:[{homeAway:'home',team:{abbreviation:'SEA'}},{homeAway:'away',team:{abbreviation:'NE'}}]
}]}]});
test('halftime uses explicit feed status, not just a zero clock', () => {
  for (const type of [
    {state:'in',name:'STATUS_HALFTIME'},
    {state:'in',shortDetail:'Halftime'},
  ]) {
    const g=summarizeGames(board(type)).SEA;
    assert.equal(g.halftime,true);
    assert.equal(g.state,'live');
  }
  for (const type of [
    {state:'in',name:'STATUS_END_PERIOD',shortDetail:'End of 2nd'},
    {state:'in',name:'STATUS_IN_PROGRESS',shortDetail:'15:00 - 3rd'},
    {state:'post',completed:true,shortDetail:'Final'},
  ]) assert.equal(summarizeGames(board(type)).SEA.halftime,false);
});
test('entering and leaving halftime changes the render key', () => {
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const start=source.indexOf('function structureKey()');
  const code=source.slice(start,source.indexOf('function patchNumbers()',start));
  const S={data:{games:{SEA:{id:'game',state:'live',halftime:false}},matchups:[]}};
  const key=runInNewContext(code+';structureKey',{S});
  const before=key();S.data.games.SEA.halftime=true;
  assert.notEqual(key(),before);
  S.data.games.SEA.halftime=false;assert.equal(key(),before);
});
