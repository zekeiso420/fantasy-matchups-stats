import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {railPlayer,gameRailPlayers} from '../public/rail-data.js';
import {createWatch} from '../public/watch.js';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const factory=source.slice(source.indexOf('function createPlayerRails('),source.indexOf('// Boot',source.indexOf('function createPlayerRails(')));
function setup(coarse=false){
 const dom=new JSDOM('<div class="topbar-right"></div><div id="picture"><iframe></iframe></div>',{runScripts:'outside-only'}),w=dom.window;
 globalThis.document=w.document;
 let timer;w.setTimeout=fn=>(timer=fn,1);w.clearTimeout=()=>{timer=null;};
 w.matchMedia=()=>({matches:coarse});w.fmt=n=>Number(n||0).toFixed(2);w.eval(factory);
 const picture=w.document.querySelector('#picture'),rails=w.createPlayerRails(picture);
 const player=railPlayer('1',{n:'Josh Allen',p:'QB',t:'BUF'},14,25,{pass_yd:120,pass_td:2});
 const sides={mine:[player],opp:[{...player,id:'2',name:'Opponent'}]};rails.update('game1',sides);
 const $=s=>picture.querySelector(s),fire=type=>picture.dispatchEvent(new w.MouseEvent(type));
 return {w,dom,picture,rails,sides,$,fire,expire:()=>timer?.(),hasTimer:()=>!!timer};
}
test('rails select, pin through idle, toggle, dismiss on leave and preserve nodes on live ticks',()=>{
 const t=setup(),face=t.$('.pv-player'),strip=t.$('.pv-strip'),frame=t.$('iframe');
 t.fire('mouseenter');assert.ok(t.$('.pv-hot'));t.expire();assert.equal(t.$('.pv-hot'),null);
 t.fire('mousemove');face.click();assert.ok(strip.classList.contains('pv-up'));assert.equal(t.$('.pv-grid').children.length,6);
 t.expire();assert.ok(t.$('.pv-hot'));assert.ok(strip.classList.contains('pv-up'));
 t.sides.mine[0].points=20;t.sides.mine[0].stats[0].value=180;t.rails.update('game1',t.sides);
 assert.equal(t.$('.pv-player'),face);assert.equal(t.$('.pv-strip'),strip);assert.equal(t.$('iframe'),frame);
 assert.equal(t.$('.pv-total strong').textContent,'20.00');assert.equal(t.$('.pv-cell strong').textContent,'180');
 face.click();assert.equal(strip.hidden,true);assert.ok(t.$('.pv-hot'));
 face.click();t.$('.pv-close').click();assert.equal(strip.hidden,true);
 face.click();t.fire('mouseleave');assert.equal(strip.hidden,true);assert.ok(t.$('.pv-away'));assert.equal(t.hasTimer(),false);
 t.fire('mouseenter');assert.equal(strip.hidden,true);t.rails.destroy();t.dom.window.close();
});
test('keyboard, opponent selection, coarse input and stream controls',()=>{
 const t=setup(true);assert.equal(t.hasTimer(),false);
 t.sides.mine.push({...t.sides.mine[0],id:'3'});t.rails.update('game1',t.sides);
 const face=t.$('.pv-player');face.focus();face.dispatchEvent(new t.w.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
 assert.equal(t.w.document.activeElement.dataset.key,'mine:3');
 t.$('.pv-opp .pv-player').click();assert.ok(t.$('.pv-strip.pv-opp'));assert.match(t.$('.pv-meta').textContent,/OPPONENT STARTER/);
 t.$('.pv-close').dispatchEvent(new t.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(t.$('.pv-strip').classList.contains('pv-up'),false);
 assert.equal(t.hasTimer(),false);t.rails.setEnabled(false);assert.equal(t.$('.pv-overlay').hidden,true);assert.ok(!t.picture.classList.contains('pv-enabled'));
 t.rails.setEnabled(true);assert.equal(t.$('.pv-overlay').hidden,false);t.rails.update('game2',{mine:[],opp:[]});assert.equal(t.$('.pv-overlay').hidden,true);
 t.rails.destroy();t.dom.window.close();
});
test('data has six labeled stats, missing data stays unknown, rosters filter to the selected game',()=>{
 for(const position of ['QB','RB','WR','TE','K','DEF','LB'])assert.equal(railPlayer('1',{p:position,n:'A B',t:'BUF'},0,null,null).stats.length,6);
 const p=railPlayer('1',{p:'RB',n:'A B',t:'BUF'},12,20,{rush_td:1,rec_td:1,rush_att:8});
 assert.equal(p.stats[2].value,2);assert.equal(p.stats[0].value,8);
 assert.equal(railPlayer('1',{p:'QB'},0,null,null).stats[0].value,'—');
 const data={matchups:[{matchup_id:1,roster_id:2,starters:['1']},{matchup_id:1,roster_id:3,starters:[]}],rosters:[{roster_id:2,players:['1','2']},{roster_id:3,players:['3']}],games:{BUF:{id:'g'},KC:{id:'other'}},scored:{players:{'1':{rail:p},'2':{rail:{...p,id:'2',nflTeam:'KC'}},'3':{rail:{...p,id:'3'}}}}};
 const result=gameRailPlayers(data,1,'g',2);assert.deepEqual(result.mine.map(p=>p.id),['1']);assert.equal(result.mine[0].bench,false);assert.equal(result.opp[0].bench,true);assert.equal(gameRailPlayers(data,1,'g',7),null);
});
test('watch integration suppresses multi rails and keeps the frame while scoring changes',()=>{
 const t=setup();t.rails.destroy();
 const g={id:'g',state:'live',away:'BUF',home:'KC'},data={context:'1',watching:'g',games:[g],teams:[{name:'Mine',mine:true},{name:'Opp'}],matchups:[],buckets:[{game:g,a:[{rail:t.sides.mine[0],bench:false}],b:[]}]};
 const watch=createWatch({getData:()=>data,getStream:async()=>({sources:[]}),onWatch(){},onEnter(){},onExit(){},onMatchup(){},createPlayerRails:t.w.createPlayerRails});watch.open('single');
 const root=t.w.document.querySelector('.watch-surface'),frame=root.querySelector('iframe'),face=root.querySelector('.pv-player');face.click();watch.update();assert.equal(root.querySelector('iframe'),frame);assert.ok(root.querySelector('.pv-strip').classList.contains('pv-up'));
 watch.open('multi');assert.equal(root.querySelector('.pv-overlay').hidden,true);watch.open('single');assert.equal(root.querySelector('.pv-overlay').hidden,false);watch.close();t.dom.window.close();
});
