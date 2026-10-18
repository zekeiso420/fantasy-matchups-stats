import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {config,snapshot,preferences,senderRole} from '../extension/model.js';
test('extension validates configuration and resolves owner, opponent, bench and duplicate teams',()=>{
 assert.deepEqual(config({username:'viewer',leagueId:'1234567890123456789',week:''}),{username:'viewer',leagueId:'1234567890123456789',week:null});
 assert.throws(()=>config({username:'x',leagueId:'../bad'}));assert.throws(()=>config({username:'x',leagueId:'1234567890123456789',week:23}));
 const game={id:'g',away:'JAX',home:'BUF'};
 const data={league:{name:'League'},week:6,statsAvailable:true,rosters:[{roster_id:1,owner_id:'owner',co_owners:['me'],players:['p','b']},{roster_id:2,owner_id:'opp',players:[]}],users:[{user_id:'owner',display_name:'Name',metadata:{team_name:'My Team'}}],matchups:[{roster_id:1,matchup_id:1,starters:['p'],points:8},{roster_id:2,matchup_id:1,starters:[],points:4}],games:{JAC:game,JAX:game},scored:{teams:{1:{pts:9}},players:{p:{rail:{id:'p',nflTeam:'JAX'}},b:{rail:{id:'b',nflTeam:'JAX'}}}}};
 const s=snapshot(data,'me');assert.equal(s.mine.name,'My Team');assert.equal(s.mine.points,9);assert.equal(s.opp.points,4);assert.equal(s.mine.players[1].bench,true);assert.equal(s.games.length,1);assert.throws(()=>snapshot(data,'absent'));
 data.matchups[0].matchup_id=null;assert.equal(snapshot(data,'me').opp,null);
});
test('overlay keeps native video unchanged, escapes data, collapses and follows fullscreen',async()=>{
 const dom=new JSDOM('<main><video controls></video></main>',{url:'https://tv.youtube.com/watch/test',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;let shadow;
 const attach=w.Element.prototype.attachShadow;w.Element.prototype.attachShadow=function(o){const s=attach.call(this,o);shadow=s;return s;};
 w.setTimeout=()=>1;w.clearTimeout=()=>{};
 const saved={settings:{username:'test',leagueId:'1234567890123456789',week:''}};
 const data={league:'League',week:6,at:Date.now(),statsAvailable:true,games:[{id:'g',away:'BUF',home:'KC',state:'live'}],mine:{name:'<img src=x>',points:10,players:[{id:'p',initials:'AB',name:'Player',position:'QB',nflTeam:'BUF',points:10,gameId:'g',groups:[{label:'PASS',cells:[{label:'YDS',value:'100',line:{text:'4 pts'}}]}]}]},opp:null};
 w.chrome={runtime:{sendMessage:async()=>({data,prefs:preferences(),view:{}}),onMessage:{addListener(){}}}};
 const video=w.document.querySelector('video');w.eval(readFileSync(new URL('../extension/content.js',import.meta.url),'utf8'));
 await new Promise(r=>setTimeout(r,20));assert.equal(w.document.querySelector('video'),video);assert.equal(video.controls,true);assert.equal(shadow.querySelector('img'),null);assert.match(shadow.textContent,/<img src=x>/);
 shadow.querySelector('[data-player]').click();assert.match(shadow.querySelector('.stats').textContent,/100/);
 shadow.querySelector('[data-action=collapse]').click();assert.equal(shadow.querySelector('.panel').classList.contains('collapsed'),true);
 const main=w.document.querySelector('main');Object.defineProperty(w.document,'fullscreenElement',{value:main,configurable:true});w.document.dispatchEvent(new w.Event('fullscreenchange'));assert.equal(w.document.querySelector('#matchup-companion').parentElement,main);
 assert.equal(video.parentElement,main);dom.window.close();
});

test('privacy boundaries allow only the extension options page and top-level YouTube TV script',()=>{
 const id='abc',url='chrome-extension://abc/options.html';
 assert.equal(senderRole({id,url},id,url),'options');
 assert.equal(senderRole({id,url:'https://tv.youtube.com/watch/test',frameId:0},id,url),'overlay');
 for(const sender of [{id:'other',url},{id,url:'https://tv.youtube.com.evil.test/',frameId:0},{id,url:'https://tv.youtube.com/',frameId:1}])assert.equal(senderRole(sender,id,url),null);
 const prefs=preferences({width:99999,delaySeconds:-1,pollSeconds:1,token:'secret'});assert.equal(prefs.width,360);assert.equal(prefs.delaySeconds,3);assert.equal(prefs.pollSeconds,15);assert.equal('token' in prefs,false);
});
