const form=document.querySelector('form'),status=document.querySelector('#status');
const booleans=['remember','enabled','showBench','alerts'];
async function send(message){const r=await chrome.runtime.sendMessage(message);if(r?.error)throw Error(r.error);return r;}
async function load(){const r=await send({type:'settings:read'});const values={username:'',leagueId:'',week:'',...r.settings,...r.prefs,remember:r.remember};for(const [key,value] of Object.entries(values)){if(!form.elements[key])continue;if(booleans.includes(key))form.elements[key].checked=!!value;else form.elements[key].value=value??'';}}
form.addEventListener('submit',async e=>{e.preventDefault();try{const value=Object.fromEntries(new FormData(form));await send({type:'settings:save',settings:{username:value.username,leagueId:value.leagueId,week:value.week},prefs:{...value,enabled:form.elements.enabled.checked,showBench:form.elements.showBench.checked,alerts:form.elements.alerts.checked},remember:form.elements.remember.checked});status.textContent='Saved. Your open YouTube TV panel will update.';}catch(e){status.textContent=e.message;}});
document.querySelector('#clear').addEventListener('click',async()=>{try{await send({type:'settings:clear'});await load();status.textContent='All extension data cleared.';}catch(e){status.textContent=e.message;}});
load().catch(e=>{status.textContent=e.message;});
