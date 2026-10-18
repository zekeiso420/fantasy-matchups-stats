(()=>{
 if(document.getElementById('matchup-companion'))return;
 const host=document.createElement('div');host.id='matchup-companion';
 host.style.cssText='all:initial;position:fixed;right:16px;top:72px;z-index:2147483647;pointer-events:none';
 const shadow=host.attachShadow({mode:'closed'});
 shadow.innerHTML=`<style>
 :host{color-scheme:dark}*{box-sizing:border-box}button,input,select{font:inherit}button,select{cursor:pointer}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #f0c543;outline-offset:2px}[hidden]{display:none!important}
 .panel{width:min(var(--panel-width,360px),calc(100vw - 32px));background:#111914;color:#eaefe6;border:1px solid #46593f;font:13px/1.4 system-ui,sans-serif;pointer-events:auto;box-shadow:0 2px 8px #0005}header{display:flex;align-items:center;gap:8px;padding:10px;border-bottom:1px solid #2c3830}header strong{color:#f0c543;margin-right:auto;letter-spacing:.08em;font-size:12px}button{border:1px solid #46593f;background:transparent;color:#eaefe6;padding:5px 9px}button:hover{border-color:#f0c543}.body{max-height:calc(100vh - 180px);overflow:auto;scrollbar-width:none;padding:12px}.body::-webkit-scrollbar{display:none}label{display:block;color:#a5afa4;font-size:11px;margin-bottom:10px}input,select{display:block;width:100%;margin-top:4px;background:#1a231d;border:1px solid #46593f;color:#eaefe6;padding:7px}.status{font-size:11px;color:#9ca896;margin:8px 0;overflow-wrap:anywhere}.teams{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:10px 0}.team{min-width:0;overflow-wrap:anywhere}.team strong{display:block;font-size:22px;font-variant-numeric:tabular-nums}.team:first-child strong{color:#f0c543}h3{font-size:13px;letter-spacing:0;color:#a5afa4;margin:14px 0 5px}.player{display:flex;width:100%;text-align:left;align-items:center;gap:8px;border:0;border-bottom:1px solid #2c3830;padding:8px 0}.face{display:grid;place-items:center;width:32px;height:32px;background:#263128;font-size:11px;flex:none}.player>span{flex:1}.player small{display:block;color:#9ca896}.player b{color:#eaefe6;font-variant-numeric:tabular-nums}.player.mine b{color:#f0c543}.player[aria-expanded=true]{background:#1a231d}.stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;background:#0a0f0c;padding:10px}.stats small{display:block;color:#9ca896}.stats strong{display:block}.toast{padding:8px;background:#283324;color:#f0c543}.collapsed .body{display:none}.collapsed{width:auto}.collapsed [data-action=settings]{display:none}
 </style><section class="panel" aria-label="Sleeper matchup"><header><strong>MATCHUP</strong><button data-action="settings" aria-label="Matchup settings">Settings</button><button data-action="collapse" aria-expanded="true" aria-label="Collapse matchup">−</button></header><div class="body"><div class="status" role="status"></div><div class="toast" role="status" hidden></div><div class="scores"></div><label class="game-label" hidden>Players in game<select aria-label="NFL game"></select></label><div class="roster"></div></div></section>`;
 const $=s=>shadow.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),fmt=n=>(Number(n)||0).toFixed(2);
 let data=null,selected=null,game='',timer,loading=false,generation=0,previous=null,alerts=[],prefs={pollSeconds:15,delaySeconds:3,alerts:true,showBench:true};
 const send=message=>chrome.runtime.sendMessage(message);
 function clearData(){generation++;data=null;previous=null;selected=null;clearAlerts();$('.scores').textContent='';$('.roster').textContent='';$('.game-label').hidden=true;}
 function applyPrefs(response){prefs=response.prefs||prefs;host.style.left=prefs.side==='left'?'16px':'auto';host.style.right=prefs.side==='left'?'auto':'16px';host.style.setProperty('--panel-width',`${prefs.width||360}px`);const closed=response.view?.collapsed===true;$('.panel').classList.toggle('collapsed',closed);const b=$('[data-action=collapse]');b.textContent=closed?'+':'−';b.setAttribute('aria-expanded',String(!closed));b.setAttribute('aria-label',closed?'Open matchup':'Collapse matchup');game=response.view?.game||'';}
 function clearAlerts(){alerts.forEach(clearTimeout);alerts=[];$('.toast').hidden=true;}
 function mount(){if(!document?.body)return;const target=document.fullscreenElement||document.body;if(target.tagName==='VIDEO')return;if(host.parentElement!==target)target.append(host);}
 mount();document.addEventListener('fullscreenchange',mount);
 // YouTube TV navigates without a full page load; restore our host if its shell is replaced.
 const observer=new MutationObserver(()=>{if(!host.isConnected)mount();});observer.observe(document.documentElement,{childList:true,subtree:true});
 function render(){
  if(!data)return;
  $('.scores').innerHTML=`<div class="status">${esc(data.league)} · Week ${data.week}</div><div class="teams">${[data.mine,data.opp].map(t=>`<div class="team">${esc(t?.name||'Bye')}<strong>${fmt(t?.points)}</strong></div>`).join('')}</div>`;
  const select=$('select');select.innerHTML='<option value="">All starters</option>'+data.games.map(g=>`<option value="${esc(g.id)}">${esc(g.away)} @ ${esc(g.home)} · ${esc(g.detail||g.state)}</option>`).join('');
  if(!data.games.some(g=>String(g.id)===game))game='';select.value=game;$('.game-label').hidden=false;
  $('.roster').innerHTML=[['mine',data.mine],['opp',data.opp]].map(([side,t])=>!t?'':`<h3>${esc(t.name)}</h3>`+t.players.filter(p=>game?String(p.gameId)===game&&(prefs.showBench||!p.bench):!p.bench).map(p=>{
   const key=side+':'+p.id;
   return `<button class="player ${side}" data-player="${esc(key)}" aria-expanded="${selected===key}"><span>${esc(p.name)}<small>${esc(p.position)} · ${esc(p.nflTeam)}${p.bench?' · Bench':''}</small></span><b>${fmt(p.points)}</b></button>`+(selected===key?`<div class="stats">${p.projected?'<small>Projected stats</small>':''}${(p.groups||[]).flatMap(g=>g.cells.map(c=>`<div><small>${esc(g.label)} · ${esc(c.label)}</small><strong>${esc(c.value)}</strong><small>${esc(c.line.text)}</small></div>`)).join('')}</div>`:'');
  }).join('')||`<div class="status">No players in this game.</div>`).join('');
 }
 async function refresh(){
  clearTimeout(timer);if(loading||document.hidden)return;loading=true;const token=generation;
  try{
   const response=await chrome.runtime.sendMessage({type:'matchup:refresh'});if(token!==generation)return;
   if(response?.reset){clearData();return;}applyPrefs(response||{});
   if(response?.needsSetup||prefs.enabled===false){clearData();$('.status').textContent=response.needsSetup?'Open Settings to connect your Sleeper matchup.':'Panel paused. Open Settings to enable it.';return;}
   if(response?.error)throw Error(response.error);if(!response?.data)throw Error('No response. Reload this YouTube TV tab.');
   data=response.data;
   const context=data.league+':'+data.week;
   if(prefs.alerts&&previous?.context===context){const p=data.mine.players.find(p=>!p.bench&&previous.points[p.id]!=null&&p.points-previous.points[p.id]>=1);if(p){const delta=p.points-previous.points[p.id];alerts.push(setTimeout(()=>{$('.toast').textContent=`${p.name} +${fmt(delta)} pts`;$('.toast').hidden=false;alerts.push(setTimeout(()=>{$('.toast').hidden=true;},4000));},prefs.delaySeconds*1000));}}
   previous={context,points:Object.fromEntries(data.mine.players.map(p=>[p.id,p.points]))};
   $('.status').textContent=`Updated ${new Date(data.at).toLocaleTimeString()}${data.statsAvailable?'':' · Live stats unavailable; Sleeper totals shown'}`;render();
  }catch(e){if(token===generation)$('.status').textContent=`${e.message} Retrying shortly.`;}
  finally{loading=false;timer=setTimeout(refresh,prefs.pollSeconds*1000);}
 }
 shadow.addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.action==='collapse'){const closed=$('.panel').classList.toggle('collapsed');b.textContent=closed?'+':'−';b.setAttribute('aria-expanded',String(!closed));b.setAttribute('aria-label',closed?'Open matchup':'Collapse matchup');await send({type:'view:save',view:{collapsed:closed,game}});}
  if(b.dataset.action==='settings')await send({type:'settings:open'});
  if(b.dataset.player){selected=selected===b.dataset.player?null:b.dataset.player;render();}
 });
 $('select').addEventListener('change',()=>{game=$('select').value;selected=null;clearAlerts();send({type:'view:save',view:{game,collapsed:$('.panel').classList.contains('collapsed')}});render();});
 chrome.runtime.onMessage.addListener(message=>{if(message.type==='matchup:reset'){clearData();$('.status').textContent='Updating settings…';refresh();}});
 document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(timer);clearAlerts();}else refresh();});
 refresh();
})();
