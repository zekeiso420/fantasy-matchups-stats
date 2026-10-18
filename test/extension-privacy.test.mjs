import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {config,snapshot,preferences,senderRole} from '../extension/model.js';
function setup(){
 const stores={local:{},session:{}},levels=[],messages=[];let listener,clearCount=0,resolveState;
 const area=name=>({setAccessLevel:async v=>levels.push([name,v.accessLevel]),get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,stores[name][k]])),set:async values=>Object.assign(stores[name],values),remove:async key=>{delete stores[name][key];},clear:async()=>{stores[name]={};}});
 const chrome={runtime:{id:'abc',getURL:p=>'chrome-extension://abc/'+p,openOptionsPage:async()=>{},onMessage:{addListener:fn=>listener=fn}},storage:{local:area('local'),session:area('session')},action:{onClicked:{addListener(){}}},tabs:{sendMessage:async(id,m)=>messages.push(m)}};
 const source=readFileSync(new URL('../extension/worker.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
 const state=new Promise(r=>resolveState=r);
 new Function('chrome','getState','getUser','getWeekData','clearMemo','config','snapshot','preferences','senderRole',source)(chrome,()=>state,async()=>null,async()=>{},()=>clearCount++,config,snapshot,preferences,senderRole);
 const sender={id:'abc',url:'chrome-extension://abc/options.html'},overlay={id:'abc',url:'https://tv.youtube.com/watch/test',frameId:0,tab:{id:1}};
 const send=(m,s=sender)=>new Promise(resolve=>{if(listener(m,s,resolve)!==true)resolve(undefined);});
 return {stores,levels,messages,send,overlay,resolveState,get clearCount(){return clearCount;}};
}
const settings={username:'test',leagueId:'1234567890123456789',week:''};
test('setup is session-only by default; overlay cannot read identity; opt-in can be revoked',async()=>{
 const t=setup();await t.send({type:'settings:save',settings,prefs:{enabled:false}});
 assert.equal(t.stores.local.settings,undefined);assert.equal(t.stores.session.settings.username,'test');assert.deepEqual(t.levels,[['local','TRUSTED_CONTEXTS'],['session','TRUSTED_CONTEXTS']]);
 const limited=await t.send({type:'matchup:refresh'},t.overlay);assert.equal(limited.prefs.enabled,false);assert.equal('settings' in limited,false);
 assert.ok((await t.send({type:'settings:read'},t.overlay)).error);
 await t.send({type:'settings:save',settings,prefs:{},remember:true});assert.equal(t.stores.local.settings.username,'test');
 await t.send({type:'settings:save',settings,prefs:{},remember:false});assert.equal(t.stores.local.settings,undefined);
 await t.send({type:'settings:clear'});assert.deepEqual(t.stores,{local:{},session:{}});assert.ok(t.clearCount>=4);assert.ok(t.messages.some(m=>m.type==='matchup:reset'));
 assert.equal((await t.send({type:'matchup:refresh'},t.overlay)).needsSetup,true);
});
test('clearing during an in-flight load does not persist or return an old matchup',async()=>{
 const t=setup();await t.send({type:'settings:save',settings,prefs:{}});const response=t.send({type:'matchup:refresh'},t.overlay);
 await new Promise(r=>setTimeout(r,0));await t.send({type:'settings:clear'});t.resolveState({week:6});const r=await response;assert.equal(r.data,undefined);assert.deepEqual(t.stores,{local:{},session:{}});
});
