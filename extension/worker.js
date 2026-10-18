import {getState,getUser,getWeekData} from './vendor/backend-static.js';
import {clearMemo} from './vendor/memo.js';
import {config,snapshot,preferences,senderRole} from './model.js';
const ready=Promise.all([chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}),chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'})]);
let pending=null,epoch=0;
const viewers=new Set();
function invalidate(){epoch++;pending=null;clearMemo();}
function notify(){for(const tab of viewers)chrome.tabs.sendMessage(tab,{type:'matchup:reset'}).catch(()=>viewers.delete(tab));}
chrome.action.onClicked.addListener(()=>chrome.runtime.openOptionsPage());
async function handle(message,role,sender){
 await ready;
 if(role==='options'){
  if(message.type==='settings:read'){
   const local=await chrome.storage.local.get(['settings','prefs']),session=await chrome.storage.session.get('settings');
   return {settings:session.settings||local.settings||{},prefs:preferences(local.prefs),remember:!!local.settings};
  }
  if(message.type==='settings:clear'){
   invalidate();await Promise.all([chrome.storage.local.clear(),chrome.storage.session.clear()]);notify();return {ok:true};
  }
  if(message.type==='settings:save'){
   const settings=config(message.settings),prefs=preferences(message.prefs);invalidate();
   await chrome.storage.session.set({settings});await chrome.storage.local.set({prefs});
   if(message.remember===true)await chrome.storage.local.set({settings});else await chrome.storage.local.remove('settings');
   notify();return {ok:true};
  }
 }
 if(role==='overlay'){
  if(sender.tab?.id!=null)viewers.add(sender.tab.id);
  if(message.type==='settings:open'){await chrome.runtime.openOptionsPage();return {ok:true};}
  if(message.type==='view:save'){
   const view={collapsed:message.view?.collapsed===true,game:/^[\w-]{0,40}$/.test(message.view?.game||'')?message.view.game||'':''};
   await chrome.storage.session.set({view});return {ok:true};
  }
  if(message.type==='matchup:refresh'){
   const local=await chrome.storage.local.get(['settings','prefs']),session=await chrome.storage.session.get(['settings','view']);
   const prefs=preferences(local.prefs),settings=session.settings||local.settings;
   if(!settings||!prefs.enabled)return {needsSetup:!settings,prefs,view:session.view||{}};
   const token=epoch;
   if(!pending){const request=(async()=>{
    const c=config(settings),state=await getState(),user=await getUser(c.username);
    if(!user)throw Error('Sleeper user not found.');
    const data=await getWeekData(c.leagueId,c.week||Number(state.display_week||state.week||1));
    return snapshot(data,user.user_id);
   })();pending=request;request.finally(()=>{if(token!==epoch)clearMemo();if(pending===request)pending=null;}).catch(()=>{});}
   const data=await pending;
   if(token!==epoch)return {reset:true};
   return {data,prefs,view:session.view||{}};
  }
 }
 return {error:'Unsupported request.'};
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 const role=senderRole(sender,chrome.runtime.id,chrome.runtime.getURL('options.html'));if(!role)return;
 handle(message,role,sender).then(respond,()=>respond({error:'Unable to load settings or scores. Check your Sleeper setup and connection.'}));return true;
});
