import test from 'node:test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createWatch,boxes,toggleFeatured} from '../public/watch.js';

function setup(count=8){
 const dom=new JSDOM('<div class="topbar-right"></div>',{url:'http://localhost/'});globalThis.document=dom.window.document;
 const games=Array.from({length:count},(_,i)=>({id:String(i),away:'BUF',home:'KC',awayScore:14,homeScore:7,state:'live',detail:'3RD 8:00',kickoff:'2026-09-15T18:00:00Z'}));
 const data={context:'L:1:1',watching:'0',games,teams:[{name:'First team',points:25,mine:true},{name:'Opponent',points:22}],matchups:[],buckets:games.map((game,i)=>({game,a:i<6?[{id:'p'+i,name:'Player '+i,pos:'QB',team:'BUF',pts:5,bench:false}]:[],b:[]}))};
 let exitId;
 const watch=createWatch({getData:()=>data,getStream:async()=>({sources:[]}),onEnter(){},onWatch(){},onExit:id=>exitId=id,onMatchup(){}});
 const $=q=>document.querySelector(q),click=q=>$(q).click();
 return {dom,data,watch,$,click,get exitId(){return exitId;}};
}
test('all featured layouts preserve 16:9 and selection constraints',()=>{
 for(let n=1;n<=4;n++)for(const [x,y,w,h] of boxes(n)){assert.ok(Math.abs(w/h-16/9)<0.01);assert.ok(x>=0&&y>=0&&x+w<=1100&&y+h<=604);}
 let a={order:['a','b','c','d','e','f'],count:1};assert.deepEqual(toggleFeatured(a.order,a.count,'a'),a);
 for(const id of ['b','c','d'])a=toggleFeatured(a.order,a.count,id);
 assert.equal(a.count,4);assert.deepEqual(toggleFeatured(a.order,a.count,'e'),a);
 a=toggleFeatured(a.order,a.count,'d');assert.equal(a.count,3);
});
test('mode controls agree, leaving multi returns to original game',()=>{
 const t=setup();t.watch.open();t.click('[data-game="2"]');t.click('[data-action="multi"]');
 assert.equal(t.watch.mode,'multi');assert.equal(t.$('[data-mode="multi"]').getAttribute('aria-pressed'),'true');
 assert.equal(t.$('.w-tile.w-is-feat').dataset.tile,'2');t.click('[data-action="edit"]');t.click('[data-mode="single"]');
 assert.equal(t.$('[data-game="2"]').getAttribute('aria-expanded'),'true');assert.ok(!t.$('.watch-surface').classList.contains('w-is-edit'));t.watch.close();assert.equal(t.exitId,'2');t.dom.window.close();
});
test('score updates, promotion and swaps retain iframe and tile nodes',()=>{
 const t=setup();t.watch.open('multi');const tile=t.$('[data-tile="0"]'),frame=tile.querySelector('iframe');t.data.games[0].awayScore=21;t.watch.update();
 assert.equal(t.$('[data-tile="0"]'),tile);assert.equal(tile.querySelector('iframe'),frame);
 t.click('[data-action="edit"]');t.click('[data-tile="1"]');assert.equal(t.$('[data-tile="0"]'),tile);assert.equal(tile.querySelector('iframe'),frame);
 const start=new t.dom.window.Event('dragstart',{bubbles:true});Object.defineProperty(start,'dataTransfer',{value:{setData(){}}});tile.dispatchEvent(start);
 t.$('[data-tile="2"]').dispatchEvent(new t.dom.window.Event('drop',{bubbles:true,cancelable:true}));assert.equal(tile.querySelector('iframe'),frame);t.watch.close();t.dom.window.close();
});
test('pool replacement keeps slot size and clears cancellation feedback',()=>{
 const t=setup();t.watch.open('multi');t.click('[data-action="more"]');const tile=t.$('[data-tile="3"]'),style=tile.getAttribute('style');const pool=t.$('[data-pool="6"]');
 const start=()=>{const e=new t.dom.window.Event('dragstart',{bubbles:true});Object.defineProperty(e,'dataTransfer',{value:{setData(){}}});pool.dispatchEvent(e);};
 start();t.watch.update();assert.equal(t.$('[data-pool="6"]'),pool);assert.ok(t.$('.w-is-pool'));
 document.dispatchEvent(new t.dom.window.Event('dragend'));assert.ok(!t.$('.w-is-pool'));
 // The next drag starts on the current (reconciled) source node.
 const e=new t.dom.window.Event('dragstart',{bubbles:true});Object.defineProperty(e,'dataTransfer',{value:{setData(){}}});t.$('[data-pool="6"]').dispatchEvent(e);
 tile.dispatchEvent(new t.dom.window.Event('drop',{bubbles:true,cancelable:true}));assert.equal(tile.getAttribute('style'),style);assert.equal(t.$('[data-slot="3"] .w-swing-val').textContent,'—');assert.ok(!t.$('.w-is-pool'));t.watch.close();t.dom.window.close();
});
test('collapsing the rail reveals details without replacing the player',()=>{
 const t=setup();t.watch.open();const frame=t.$('.w-single iframe'),row=t.$('[data-game="0"]');t.click('[data-game="0"]');assert.equal(t.$('[data-game="0"]'),row);
 t.click('[data-action="collapse"]');assert.ok(t.$('.w-is-railshut.w-has-details'));assert.equal(t.$('.w-show-details'),null);assert.equal(t.$('.w-single iframe'),frame);t.watch.close();t.dom.window.close();
});
test('empty schedule and matchup changes release old streams safely',()=>{
 const t=setup(0);t.watch.open('multi');assert.equal(t.$('[data-id="empty"]').hidden,false);assert.equal(t.$('iframe'),null);t.watch.close();t.dom.window.close();
 const u=setup();u.watch.open('multi');const frame=u.$('iframe');u.data.context='L:2:1';u.watch.update();assert.equal(frame.isConnected,false);u.watch.close();u.dom.window.close();
});

test('watch CSS shows expanded performance and hides collapsed controls',()=>{
 const t=setup();const style=document.createElement('style');style.textContent=readFileSync(new URL('../public/watch.css',import.meta.url),'utf8');document.head.append(style);t.watch.open();
 const css=e=>t.dom.window.getComputedStyle(e);
 assert.equal(css(t.$('.w-perf')).opacity,'1');assert.equal(t.$('.w-show-details'),null);
 t.click('[data-action="collapse"]');assert.equal(css(t.$('.w-rail')).width,'46px');assert.equal(css(t.$('.w-details')).width,'260px');
 t.watch.close();t.dom.window.close();
});

test('single-player chrome stays inside the player and scrollbars are hidden',()=>{
 const t=setup();const style=document.createElement('style');style.textContent=readFileSync(new URL('../public/watch.css',import.meta.url),'utf8');document.head.append(style);t.watch.open();
 const player=t.$('.w-player');
 assert.equal(t.$('.w-player-top').parentElement,player);
 assert.equal(t.$('.w-chrome').parentElement,player);
 assert.equal(t.dom.window.getComputedStyle(t.$('.w-stage')).overflow,'hidden');
 assert.equal(t.dom.window.getComputedStyle(t.$('[data-id="railInner"]')).scrollbarWidth,'none');
 t.click('[data-action="collapse"]');
 assert.equal(t.$('.w-player-top').parentElement,player);
 assert.equal(t.$('.w-chrome').parentElement,player);
 t.watch.close();t.dom.window.close();
});

test('theater aliases the shared matchup palette',()=>{
 const css=readFileSync(new URL('../public/watch.css',import.meta.url),'utf8');
 assert.match(css,/--well:\s+var\(--frame-deep\)/);
 assert.match(css,/--sel:\s+var\(--surface-2\)/);
 assert.match(css,/--gold:\s+var\(--accent\)/);
 assert.doesNotMatch(css,/--bg:\s*#[0-9a-f]/i);
});

test('watch stage avoids page main offsets',()=>{
 const t=setup();const style=document.createElement('style');
 style.textContent=readFileSync(new URL('../public/styles.css',import.meta.url),'utf8')+readFileSync(new URL('../public/watch.css',import.meta.url),'utf8');
 document.head.append(style);t.watch.open();
 assert.equal(t.$('.w-stage').tagName,'DIV');
 document.body.classList.add('theater');
 assert.equal(t.dom.window.getComputedStyle(t.$('.w-stage')).marginLeft,'400px');
 t.click('[data-action="collapse"]');
 assert.equal(t.dom.window.getComputedStyle(t.$('.w-stage')).marginLeft,'306px');
 t.click('[data-mode="multi"]');
 assert.equal(t.dom.window.getComputedStyle(t.$('[data-mode="multi"]')).borderLeftStyle,'solid');
 t.watch.close();t.dom.window.close();
});

test('Single returns to the view used to enter Multi',()=>{
 const t=setup();t.watch.update();
 t.click('[data-mode="single"]');assert.equal(t.watch.active,false);
 t.click('[data-mode="multi"]');assert.equal(t.watch.active,true);
 t.click('[data-mode="single"]');assert.equal(t.watch.active,false);assert.equal(t.exitId,'0');
 t.watch.open('single');t.click('[data-mode="multi"]');t.click('[data-mode="single"]');
 assert.equal(t.watch.active,true);assert.equal(t.watch.mode,'single');
 t.watch.close();t.dom.window.close();
});

test('rail scores scroll in a separate region above the collapse footer',()=>{
 const t=setup();const style=document.createElement('style');style.textContent=readFileSync(new URL('../public/watch.css',import.meta.url),'utf8');document.head.append(style);t.watch.open();
 const css=e=>t.dom.window.getComputedStyle(e);
 assert.equal(css(t.$('.w-rail-inner')).overflow,'hidden');
 assert.equal(css(t.$('.w-sec--single')).overflowY,'auto');
 assert.equal(css(t.$('.w-sec--single')).minHeight,'0px');
 assert.equal(css(t.$('.w-rail-foot')).position,'static');
 assert.equal(css(t.$('.w-rail-foot')).flexShrink,'0');
 t.watch.close();t.dom.window.close();
});
