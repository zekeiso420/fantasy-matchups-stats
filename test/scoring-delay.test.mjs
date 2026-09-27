import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';

function setup(){
 const dom=new JSDOM('<div id="player"></div>'),win=dom.window;
 win.matchMedia=()=>({matches:true});let now=0,id=0;const timers=new Map();
 win.setTimeout=(fn,ms)=>{timers.set(++id,{fn,at:now+ms});return id;};win.clearTimeout=id=>timers.delete(id);
 const tick=ms=>{const end=now+ms;for(;;){const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();}now=end;};
 const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const code=source.slice(source.indexOf('const SF_DELAY='),source.indexOf('// Boot'));
 const make=new Function('escape','fmt',code+'\nreturn createScoringBand;')(String,n=>Number(n).toFixed(2));
 const band=make(win.document.querySelector('#player'));
 return {dom,band,tick,visible:()=>win.document.querySelector('.sf-band').classList.contains('sf-on'),announcement:()=>win.document.querySelector('.sf-live').textContent};
}
const event={name:'Player',position:'WR',nflTeam:'BUF',playText:'REC TD',points:'+6.00',teamTotal:'20.00'};
test('score notification and announcement wait three seconds',()=>{
 const t=setup();t.band.show(event);t.tick(2999);assert.equal(t.visible(),false);assert.equal(t.announcement(),'');t.tick(1);assert.equal(t.visible(),true);assert.match(t.announcement(),/REC TD/i);t.band.destroy();t.dom.window.close();
});
test('live score detection delays notification and reset cancels pending plays',()=>{
 const t=setup();const player={id:'p',name:'Player',position:'WR',points:0,groups:[]};t.band.watch([player]);t.band.watch([{...player,points:6}]);t.tick(2999);assert.equal(t.visible(),false);t.tick(1);assert.equal(t.visible(),true);
 t.band.reset();t.band.show(event);t.band.reset();t.tick(4000);assert.equal(t.visible(),false);
 t.band.show(event);t.band.destroy();t.tick(4000);assert.equal(t.dom.window.document.querySelector('.sf-band'),null);t.dom.window.close();
});
