import { PROVIDER, streamKey, sourceLabel } from './video.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = n => (Number(n) || 0).toFixed(2);
const icon = paths => `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">${paths}</svg>`;
const singleIcon = icon('<rect x="3" y="4" width="18" height="16"/>');
const gridIcon = icon('<rect x="3" y="4" width="11" height="9"/><rect x="16" y="4" width="5" height="4"/><rect x="16" y="11" width="5" height="4"/><rect x="3" y="16" width="11" height="4"/>');
export const LAYOUTS = {
  1:[[0,0,896,504],[904,0,196,110],[904,118,196,110],[904,236,196,110],[904,354,196,110],[904,472,196,110]],
  2:[[0,0,546,307],[554,0,546,307],[0,315,269,151],[277,315,269,151],[554,315,269,151],[831,315,269,151]],
  3:[[0,0,470,264],[478,0,470,264],[239,272,470,264],[956,106,144,81],[956,195,144,81],[956,284,144,81]],
  4:[[0,0,440,248],[448,0,440,248],[0,256,440,248],[448,256,440,248],[896,0,196,110],[896,118,196,110]]
};
export function boxes(n, count=6) {
  const b=LAYOUTS[Math.max(1,Math.min(4,n))].slice(0,count);
  const off=(604-Math.max(...b.map(x=>x[1]+x[3]),0))/2;
  return b.map(([x,y,w])=>[x,y+off,w,w*9/16]);
}
export function toggleFeatured(order, count, id) {
  const i=order.indexOf(id); if(i<0) return {order,count};
  if(i<count) {
    if(count===1) return {order,count};
    return {order:[...order.slice(0,i),...order.slice(i+1,count),id,...order.slice(count)],count:count-1};
  }
  if(count===4) return {order,count};
  return {order:[id,...order.filter(x=>x!==id)],count:count+1};
}
const TEAM_COLOR={BAL:'#8a6ae0',IND:'#3f9ddb',BUF:'#4d7fdb',HOU:'#b9c3cc',TB:'#e0553c',CIN:'#f07a32',NO:'#cdb489',DET:'#56a6d6',CHI:'#e07a3c',CAR:'#3fa3d6',ATL:'#e0576a',PIT:'#c9a227',SF:'#d9705c',LAR:'#5b8ce0',MIN:'#8f6bd6',GB:'#3f8f52',LV:'#b9c3cc',DEN:'#e08a3c',NYJ:'#3f9e6b',MIA:'#3fb5b0'};
const title=g=>g ? `${g.away} @ ${g.home}` : 'No game selected';
const status=g=>g.halftime?'HALFTIME':g.state==='final'?'FINAL':g.state==='live'?(g.detail || `${g.clock || ''} · Q${g.period || ''}`):new Date(g.kickoff).toLocaleString([], {weekday:'short',hour:'numeric',minute:'2-digit'});
function line(g) {
  if(!g) return '';
  const ab=t=>`${g.state==='live'&&!g.halftime&&g.possession===t?'<img src="./football-icon.svg" width="12" height="8" alt="Has possession">':''}<span class="w-ab" style="--tc:${TEAM_COLOR[t]||'var(--line-str)'}">${esc(t)}</span>`;
  return `${ab(g.away)}<span class="w-sc">${num(g.awayScore).replace('.00','')}</span><span class="w-at">@</span>${ab(g.home)}<span class="w-sc">${num(g.homeScore).replace('.00','')}</span>`;
}

// Kept separate from roster rendering: live updates patch this surface without
// replacing media or the source of an active drag.
export function createWatch({getData,getStream,onWatch,onEnter,onExit,onMatchup,createPlayerRails}) {
  let data,root=null,active=false,context=null,returnToTheater=true;
  let playerRails=null;
  const s={mode:'single',watching:null,expanded:null,order:[],count:1,repl:{},edit:false,pin:false,hover:false,rail:true,details:true,all:false,more:false,drag:null,pool:null,audio:null};
  const tiles=new Map(),switches=new Map(),media=new Map();
  const modeHost=document.createElement('div'); modeHost.className='watch-mode'; modeHost.hidden=true;
  modeHost.innerHTML=`<span>VIEW</span><div class="w-seg"><button class="w-seg-opt" data-mode="single" aria-pressed="true">${singleIcon}SINGLE</button><button class="w-seg-opt" data-mode="multi" aria-pressed="false">${gridIcon}MULTI</button></div>`;
  document.querySelector('.topbar-right').append(modeHost);
  modeHost.addEventListener('click',e=>{const b=e.target.closest('[data-mode]');if(b && (active || b.dataset.mode==='multi'))open(b.dataset.mode);});
  const $=id=>root.querySelector(`[data-id="${id}"]`);
  const game=id=>data.games.find(g=>g.id===id);
  const slot=id=>game(s.repl[id]||id);
  const bucket=g=>data.buckets.find(b=>b.game?.id===g?.id)||{a:[],b:[]};
  const starters=(g,key)=>bucket(g)[key].filter(p=>!p.bench);
  const swing=g=>starters(g,'a').reduce((n,p)=>n+(Number(p.pts)||0),0)-starters(g,'b').reduce((n,p)=>n+(Number(p.pts)||0),0);
  const eligible=()=>data.games.filter(g=>g.state==='live' && starters(g,'a').length);
  const color=d=>Math.abs(d)<8?'var(--gold)':d>0?'var(--green)':d < -25?'var(--red)':'var(--orange)';
  const perf=g=>['a','b'].map((key,i)=>`<div class="w-perf-side ${i?'w-perf-side--them':''}"><div class="w-perf-head"><span class="w-perf-team">${esc(data.teams[i]?.name||'Bye')}</span><span class="w-perf-sum" style="color:${color(swing(g))}">${i?'':(swing(g)>0?'+':'')+num(swing(g))}</span></div>${bucket(g)[key].map(p=>`<div class="w-perf-row"><span class="w-pn"><span>${esc(p.name)}</span><span class="w-pp">${esc(p.pos)} ${esc(p.team)}${p.bench?' · BN':''}</span></span><span class="w-pt">${num(p.pts)}</span></div>`).join('')||'<div class="w-perf-none">—</div>'}</div>`).join('');
  function mount(){
    root=document.createElement('section');root.className='watch-surface w-app';root.setAttribute('aria-label','Matchup watch');
    root.innerHTML=`<div class="w-body"><aside class="w-rail" data-id="rail"><button class="w-rail-tab" data-action="panel" aria-label="Open matchup panel">›<span class="w-rail-tab-label">THIS MATCHUP</span></button><div class="w-rail-inner" data-id="railInner"><div class="w-rail-head"><span class="w-eyebrow">THIS MATCHUP</span><button class="w-rail-link" data-action="all">All matchups ▾</button></div><div class="w-rail-all" data-id="all" hidden></div><div class="w-mine" data-id="mine"></div><section class="w-sec w-sec--single"><div class="w-rail-head w-rail-head--mid"><span class="w-eyebrow">SWITCH GAME</span></div><button class="w-watch-all" data-action="multi">${gridIcon}<span data-id="liveCount"></span><span class="w-watch-all-tag">MULTI-VIEW</span></button><div class="w-switch-list" data-id="switch"></div></section><section class="w-sec w-sec--multi"><div class="w-rail-head w-rail-head--mid"><span class="w-eyebrow" data-id="gridCount"></span><span class="w-drop-hint" data-id="drop" hidden>DROP TO REPLACE</span></div><div data-id="rows"></div><button class="w-rail-more" data-action="more" data-id="moreBtn"></button><div class="w-rail-pool" data-id="pool"></div></section><footer class="w-rail-foot"><span data-id="audioName"></span><button class="w-rail-link" data-action="pin" data-id="pin">Pin panel</button><button class="w-rail-collapse" data-action="collapse">Collapse panel ‹</button></footer></div></aside><aside class="w-details" data-id="details"><div class="w-details-head"><span class="w-eyebrow">IN THIS GAME</span></div><div class="w-details-game" data-id="detailsGame"></div><div class="w-perf-body" data-id="detailsBody"></div></aside><div class="w-stage"><div class="w-stage-head"><span class="w-stage-title" data-id="stageTitle"></span><span class="w-head-ctl"><span class="w-edit-hint" data-id="hint"></span><button class="w-edit-btn" data-action="edit" data-id="edit">Edit grid layout</button></span></div><div class="w-single"><div class="w-player"><div class="w-player-top"><span class="w-player-clock" data-id="clock"></span><span class="w-player-score" data-id="score"></span></div><div class="w-well w-well--player" data-id="singleMedia"></div><div class="w-chrome"><button class="w-btn" data-action="exit">Exit theater</button><label class="w-eyebrow" for="watch-source">SOURCE</label><select id="watch-source" class="w-source" data-id="source" aria-label="Stream source"></select></div></div></div><div class="w-grid" data-id="grid"></div><div class="w-grid-empty" data-id="empty" hidden>No live games right now. Choose Single to watch another game.</div></div></div>`;
    document.body.append(root);
    playerRails=createPlayerRails?.($('singleMedia'));
    root.addEventListener('click',click);
    root.addEventListener('keydown',e=>{const tile=e.target.closest('[data-tile]');if(tile&&s.edit&&(e.key==='Enter'||e.key===' ')){e.preventDefault();Object.assign(s,toggleFeatured(s.order,s.count,tile.dataset.tile));render();return;}if(e.key==='Escape'){e.stopPropagation();clearDrag();if(s.edit){s.edit=false;render();}else close();}});
    $('rail').addEventListener('mouseenter',()=>{if(s.mode==='multi'){s.hover=true;render();}});
    $('rail').addEventListener('mouseleave',()=>{if(s.mode==='multi'){s.hover=false;render();}});
    root.addEventListener('dragstart',e=>{
      const pool=e.target.closest('[data-pool]'),tile=e.target.closest('[data-tile]');
      if(pool)s.pool=pool.dataset.pool;else if(tile&&s.edit)s.drag=tile.dataset.tile;else return;
      e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',s.pool||s.drag);render();
    });
    root.addEventListener('dragover',e=>{if((s.pool||s.drag)&&e.target.closest('[data-tile],[data-slot]'))e.preventDefault();});
    root.addEventListener('drop',e=>{
      const el=e.target.closest('[data-tile],[data-slot]');if(!el||(!s.pool&&!s.drag))return;e.preventDefault();
      const id=el.dataset.tile||el.dataset.slot;
      if(s.pool){s.repl[id]=s.pool;}else{const a=s.order.indexOf(s.drag),b=s.order.indexOf(id);if(a>=0&&b>=0)[s.order[a],s.order[b]]=[s.order[b],s.order[a]];}
      clearDrag();render();
    });
    $('source').addEventListener('change',()=>{const m=media.get(s.watching);if(m)setSource(m,Number($('source').value));});
  }
  function clearDrag(){s.pool=null;s.drag=null;if(active)render();}
  document.addEventListener('dragend',clearDrag);
  function click(e){
    const action=e.target.closest('[data-action]')?.dataset.action;
    if(action){
      if(action==='multi')return setMode('multi');
      if(action==='exit')return close();
      if(action==='panel'){if(s.mode==='single')s.rail=true;else s.pin=!s.pin;}
      if(action==='collapse')s.rail=false;
      if(action==='pin')s.pin=!s.pin;
      if(action==='all')s.all=!s.all;
      if(action==='more')s.more=!s.more;
      if(action==='edit'){s.edit=!s.edit;s.pool=s.drag=null;}
      render();return;
    }
    const match=e.target.closest('[data-match]');if(match){onMatchup(match.dataset.match);return;}
    const row=e.target.closest('[data-game]');if(row){const id=row.dataset.game;s.expanded=s.watching===id&&s.expanded===id?null:id;s.watching=id;onWatch(id);render();return;}
    const audio=e.target.closest('[data-audio]');if(audio){s.audio=audio.dataset.audio;render();return;}
    const el=e.target.closest('[data-tile],[data-slot]');if(el&&s.edit){Object.assign(s,toggleFeatured(s.order,s.count,el.dataset.tile||el.dataset.slot));render();}
  }
  function setMode(mode){
    if(mode==='multi')playerRails?.setEnabled(false);
    else playerRails?.setEnabled(true);
    if(mode==='single' && s.mode==='multi' && !returnToTheater){close();return;}
    if(mode===s.mode){render();return;}
    s.mode=mode;s.edit=false;s.pool=s.drag=null;
    if(mode==='multi'){
      const candidates=eligible();
      const chosen=data.games.some(g=>g.state==='live')?game(s.watching):null;
      const seeded=[...(chosen?[chosen]:[]),...candidates].filter((g,i,a)=>a.findIndex(x=>x.id===g.id)===i).slice(0,6);
      if(!seeded.length)seeded.push(...data.games.filter(g=>g.state==='live').slice(0,6));
      s.order=seeded.map(g=>g.id);s.count=1;s.repl={};s.audio=s.order[0];s.pin=s.hover=false;
    }
    render();
  }
  function update(){
    data=getData();modeHost.hidden=!data;
    if(!data){if(active)close();return;}
    if(context!==data.context){const wasMulti=s.mode==='multi';context=data.context;s.order=[];s.repl={};s.watching=data.watching;s.expanded=s.watching;destroyMedia();if(root)$('grid').replaceChildren();switches.clear();if(root)$('switch').replaceChildren();if(active&&wasMulti){s.mode='single';setMode('multi');}}
    if(!s.watching||!game(s.watching)){s.watching=data.watching||data.games.find(g=>g.state==='live')?.id||data.games[0]?.id;s.expanded=s.watching;}
    // Do not reorder an ongoing grid when clocks tick or a game finishes.
    s.order=s.order.filter(id=>game(s.repl[id]||id));s.count=Math.max(1,Math.min(s.count,s.order.length));
    if(active)render();
  }
  function open(mode='single'){
    update();if(!data)return;
    if(!active){returnToTheater=mode!=='multi';onEnter();active=true;document.body.classList.add('watch-open');mount();s.mode='single';}
    setMode(mode);
  }
  function close(){active=false;playerRails?.destroy();playerRails=null;destroyMedia();root?.remove();root=null;switches.clear();s.mode='single';s.edit=false;s.drag=s.pool=null;document.body.classList.remove('watch-open');syncMode();onExit(s.watching);}
  function syncMode(){modeHost.querySelectorAll('[data-mode]').forEach(b=>{const on=b.dataset.mode===s.mode;b.classList.toggle('w-is-on',on);b.setAttribute('aria-pressed',String(on));});}
  function render(){
    if(!active||!root)return;syncMode();const multi=s.mode==='multi',g=game(s.watching);
    for(const [cls,on] of Object.entries({'w-is-multi':multi,'w-is-single':!multi,'w-is-railshut':!s.rail,'w-has-details':s.details,'w-is-edit':s.edit,'w-is-pool':!!s.pool,'w-is-railpinned':s.pin}))root.classList.toggle(cls,on);
    const railVisible=multi?s.pin||s.hover:s.rail;
    $('rail').classList.toggle('w-is-open',railVisible);$('rail').classList.toggle('w-is-pinned',s.pin);
    $('railInner').inert=!railVisible;$('details').inert=multi||s.rail||!s.details;
    $('pin').hidden=!multi;$('pin').textContent=s.pin?'Unpin panel':'Pin panel';
    $('all').hidden=!s.all;$('all').innerHTML=data.matchups.map(m=>{const d=m.a.points-(m.b?.points||0);return `<button class="w-all-row" data-match="${esc(m.id)}"><span>${esc(m.a.name)}</span><span class="w-s w-s-a">${num(m.a.points)}</span><span class="w-s w-s-b">${num(m.b?.points)}</span><span class="w-n-b">${esc(m.b?.name||'Bye')}</span></button><div class="w-swing"><i style="${d>=0?'right':'left'}:50%;width:${Math.min(50,Math.abs(d)/60*50)}%;background:${color(d)}"></i></div>`;}).join('');
    $('mine').innerHTML=data.teams.filter(Boolean).map((t,i)=>`<div class="w-mine-row ${i?'w-mine-row--them':''}"><span class="w-mine-name">${esc(t.name)} ${t.mine?'<span class="w-you">YOU</span>':''}</span><span class="w-mine-score">${num(t.points)}</span></div>`).join('');
    const n=eligible().length;$('liveCount').textContent=`Watch ${n>6?'6 of '+n:'all '+n} live`;
    $('detailsGame').innerHTML=line(g);$('detailsBody').innerHTML=g?perf(g):'';
    $('stageTitle').innerHTML=multi?'MULTI-VIEW':line(g);$('clock').textContent=g?status(g):'No game selected';$('score').innerHTML=line(g);
    $('hint').textContent=multi&&s.edit?(s.count===4?'Four large · deselect one to add another · drag to swap':'Select up to four large games · drag to swap'):'';
    $('edit').textContent=s.edit?'Done':'Edit grid layout';$('edit').setAttribute('aria-pressed',String(s.edit));$('drop').hidden=!s.pool;
    renderSwitch();
    const bk=bucket(g),reverse=data.teams[1]?.mine;
    // The fantasy team rides along with each player: you can be watching a
    // matchup that is not yours, where "my" and "opponent" name nobody.
    const railSide=(key,i)=>(bk[key]||[]).filter(p=>p.rail).map(p=>({...p.rail,bench:p.bench,slot:p.slot,fantasyTeam:data.teams[i]?.name||'',state:g?.state,kick:g?.kickoff,ctx:g?{away:g.away,home:g.home,as:g.awayScore,hs:g.homeScore,state:g.state,kick:g.kickoff,half:g.halftime,period:g.period,clock:g.clock,detail:g.detail}:null})).sort((a,b)=>Number(a.bench)-Number(b.bench)||a.slot-b.slot);
    playerRails?.update(`${data.context}:${g?.id}`,{mine:railSide(reverse?'b':'a',reverse?1:0),opp:railSide(reverse?'a':'b',reverse?0:1)});
    if(multi)renderGrid();else if(g){const m=ensureMedia(g);placeMedia(m,$('singleMedia'));sourceOptions(m);}
    $('empty').hidden=!multi||s.order.length>0;
    const needed=new Set(multi?s.order.map(id=>slot(id)?.id):[g?.id]);
    for(const [id,m] of media)if(!needed.has(id)){m.el.remove();m.el.src='about:blank';media.delete(id);}
    $('audioName').textContent='';
  }
  function renderSwitch(){
    const ids=new Set(data.games.map(g=>g.id));
    for(const [id,r] of switches)if(!ids.has(id)){r.row.remove();r.perf.remove();switches.delete(id);}
    for(const g of data.games){
      let r=switches.get(g.id);
      if(!r){const row=document.createElement('button');row.className='w-switch-row';row.dataset.game=g.id;row.innerHTML='<span class="w-name"></span><span class="w-flag"></span><span class="w-meta"></span>';const panel=document.createElement('div');panel.className='w-perf';panel.innerHTML='<div class="w-perf-body"></div>';$('switch').append(row,panel);r={row,perf:panel};switches.set(g.id,r);}
      r.row.querySelector('.w-name').innerHTML=line(g);const flag=r.row.querySelector('.w-flag');flag.textContent=status(g);flag.classList.toggle('w-live',g.state==='live');
      r.row.querySelector('.w-meta').textContent=`${s.watching===g.id?'Watching · ':''}${starters(g,'a').length} starters`;
      r.row.classList.toggle('w-is-watching',s.watching===g.id);r.row.classList.toggle('w-is-open',s.expanded===g.id);r.row.setAttribute('aria-expanded',String(s.expanded===g.id));
      r.perf.firstChild.innerHTML=perf(g);r.perf.style.maxHeight=s.expanded===g.id?r.perf.firstChild.scrollHeight+'px':'0px';r.perf.inert=s.expanded!==g.id;
    }
  }
  function renderGrid(){
    const layout=boxes(s.count,s.order.length);
    $('gridCount').textContent=`IN THE GRID · ${s.order.length} games`;
    for(const [id,t] of tiles)if(!s.order.includes(id)){t.remove();tiles.delete(id);}
    s.order.forEach((id,i)=>{
      const g=slot(id);if(!g)return;
      let t=tiles.get(id);if(!t){t=document.createElement('div');t.className='w-tile';t.dataset.tile=id;t.innerHTML=`<div class="w-well"><div class="w-media"></div><span class="w-grip"></span><div class="w-tile-bar"><span class="w-name"></span><span class="w-status"></span></div></div>`;t.querySelector('.w-media').style.cssText='position:absolute;inset:0';$('grid').append(t);tiles.set(id,t);}
      const [x,y,w,h]=layout[i];Object.assign(t.style,{left:x/1100*100+'%',top:y/604*100+'%',width:w/1100*100+'%',height:h/604*100+'%'});
      t.draggable=s.edit;t.tabIndex=s.edit?0:-1;t.setAttribute('aria-label',`${title(g)}, ${i<s.count?'large':'small'}, slot ${i+1}`);
      t.classList.toggle('w-is-feat',i<s.count);t.classList.toggle('w-is-big',i<s.count);t.classList.toggle('w-is-target',!!s.pool);t.classList.toggle('w-is-dragging',s.drag===id);
      t.querySelector('.w-grip').textContent=`${i<s.count?'LARGE · ':''}SLOT ${i+1}`;t.querySelector('.w-name').textContent=title(g);const st=t.querySelector('.w-status');st.textContent=status(g);st.classList.toggle('w-live',g.state==='live');
      placeMedia(ensureMedia(g),t.querySelector('.w-media'));
    });
    $('rows').innerHTML=s.order.map((id,i)=>{const g=slot(id);return `<button class="w-rail-row ${i<s.count?'w-is-feat':''} ${s.pool?'w-is-target':''}" data-slot="${esc(id)}" aria-label="${esc(title(g))}, slot ${i+1}" aria-pressed="${i<s.count}"><span></span><span class="w-mid"><span class="w-label">${line(g)}<span class="w-status ${g.state==='live'?'w-live':''}">${esc(status(g))}</span></span><span class="w-players">${s.repl[id]?'':`${starters(g,'a').length} starters · ${starters(g,'b').length} opposing`}</span></span><span class="w-swing-val" style="color:${color(swing(g))}">${s.repl[id]?'—':(swing(g)>0?'+':'')+num(swing(g))}</span></button>`;}).join('');
    const pool=data.games.filter(g=>g.state==='live'&&!s.order.some(id=>slot(id)?.id===g.id));
    $('moreBtn').textContent=`${s.more?'Hide':'Show'} ${pool.length} other live games`;$('moreBtn').setAttribute('aria-expanded',String(s.more));$('pool').hidden=!s.more;
    if(!s.pool)$('pool').innerHTML=pool.map(g=>`<div class="w-pool-row" draggable="true" data-pool="${esc(g.id)}"><span class="w-label">${line(g)}</span><span class="w-status">${esc(status(g))}</span></div>`).join('');
    for(const row of $('pool').children)row.classList.toggle('w-is-dragging',row.dataset.pool===s.pool);
  }
  // Provider controls receive input directly except while arranging the grid.
  function ensureMedia(g){
    if(media.has(g.id))return media.get(g.id);
    const el=document.createElement('iframe');el.title=title(g);el.allow='autoplay; fullscreen; picture-in-picture; encrypted-media';el.allowFullscreen=true;
    const m={el,game:g,options:[{url:PROVIDER.embedUrl(g),label:'Auto'}],index:0};media.set(g.id,m);el.src=m.options[0].url;
    getStream(streamKey(g)).then(result=>{
      if(media.get(g.id)!==m)return;
      if(result?.sources?.length){m.options=result.sources.map((url,i)=>({url,label:sourceLabel(url,i)}));m.options.push({url:PROVIDER.embedUrl(g),label:'Auto'});let best=0;m.options.forEach((o,i)=>{if(parseInt(o.label)>parseInt(m.options[best].label))best=i;});setSource(m,best);}
      if(active&&s.mode==='single'&&s.watching===g.id)sourceOptions(m);
    }).catch(()=>{});
    return m;
  }
  function setSource(m,i){if(!m.options[i])return;m.index=i;if(m.el.src!==m.options[i].url)m.el.src=m.options[i].url;}
  function placeMedia(m,host){if(m.el.parentElement!==host)host.append(m.el);}
  function sourceOptions(m){$('source').innerHTML=m.options.map((o,i)=>`<option value="${i}">${esc(o.label)}</option>`).join('');$('source').value=String(m.index);}
  function destroyMedia(){for(const m of media.values()){m.el.src='about:blank';m.el.remove();}media.clear();tiles.clear();}
  return {open,close,update,get active(){return active;},get mode(){return s.mode;}};
}
