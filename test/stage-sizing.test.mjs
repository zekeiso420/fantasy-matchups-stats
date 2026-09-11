import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const sizing = source.slice(source.indexOf('function sizeStage()'), source.indexOf('function trackStageWidth()'));
test('stage fits video plus scoreboard without reserving the removed bar', () => {
  const style = () => ({setProperty(k,v){this[k]=v;},removeProperty(k){delete this[k];}});
  const unit = {style:style(), css:{borderLeftWidth:'1',borderRightWidth:'1',borderTopWidth:'1',borderBottomWidth:'1'}};
  const watch = {style:style(),clientHeight:700,clientWidth:1200,children:[unit]};
  const band = {getBoundingClientRect:()=>({height:34})};
  const toolbar = {getBoundingClientRect:()=>({height:40}),css:{marginTop:'10'}};
  watch.children.push(toolbar);
  const S = {theater:true};
  const ctx = {S,getComputedStyle:el=>el.css||{}, $:sel=>sel==='.player'?unit:sel==='aside.watch'?watch:band};
  runInNewContext(sizing+';this.resize=sizeStage;',ctx);
  for (const [w,h] of [[1200,700],[600,900],[1800,400]]) {
    watch.clientWidth=w;watch.clientHeight=h;ctx.resize();
    const width=parseFloat(unit.style.width),height=parseFloat(unit.style.height);
    assert.ok(width<=w && height<=h-50+0.001);
    assert.ok(Math.abs((width-2)/(height-36)-16/9)<1e-9);
  }
  S.theater=false;ctx.resize();
  assert.equal(unit.style.width,'');
  assert.equal(unit.style.height,'');
});
