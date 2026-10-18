export function config(raw={}) {
 const username=String(raw.username||'').trim(),leagueId=String(raw.leagueId||'').trim();
 const week=raw.week===''||raw.week==null?null:Number(raw.week);
 if(!/^[a-zA-Z0-9_-]{1,60}$/.test(username))throw Error('Enter a valid Sleeper username.');
 if(!/^\d{10,25}$/.test(leagueId))throw Error('Enter the numeric Sleeper league ID.');
 if(week!==null&&(!Number.isInteger(week)||week<1||week>22))throw Error('Week must be 1–22, or blank for current.');
 return {username,leagueId,week};
}
export function snapshot(data,userId){
 const mine=data.rosters.find(r=>r.owner_id===userId||(r.co_owners||[]).includes(userId));
 if(!mine)throw Error('That user is not in this league.');
 const m=data.matchups.find(m=>m.roster_id===mine.roster_id);
 if(!m)throw Error('No matchup is available for this week.');
 const opponent=m.matchup_id==null?null:data.matchups.find(o=>o.matchup_id===m.matchup_id&&o.roster_id!==m.roster_id);
 const side=match=>{
  if(!match)return null;
  const roster=data.rosters.find(r=>r.roster_id===match.roster_id);
  const owner=data.users.find(u=>u.user_id===roster?.owner_id);
  return {name:owner?.metadata?.team_name||owner?.display_name||`Team ${match.roster_id}`,
   points:data.scored.teams[match.roster_id]?.pts??match.points??0,
   players:[...new Set([...(match.starters||[]),...(roster?.players||[])])].filter(id=>id&&id!=='0').map(id=>{
    const p=data.scored.players[id]?.rail;
    return p?{id:p.id,name:p.name,position:p.position,nflTeam:p.nflTeam,points:p.points,projected:p.projected,groups:p.groups,bench:!(match.starters||[]).includes(id),gameId:data.games[p.nflTeam]?.id||null}:null;
   }).filter(Boolean)};
 };
 return {league:data.league.name,week:data.week,statsAvailable:data.statsAvailable,mine:side(m),opp:side(opponent),
  games:[...new Map(Object.values(data.games).map(g=>[g.id,g])).values()],at:Date.now()};
}

export const DEFAULT_PREFS={enabled:true,side:'right',width:360,pollSeconds:15,showBench:true,alerts:true,delaySeconds:3};
export function preferences(raw={}){
 return {enabled:raw.enabled!==false,side:raw.side==='left'?'left':'right',width:[280,360,440].includes(Number(raw.width))?Number(raw.width):360,
 pollSeconds:[15,30,60].includes(Number(raw.pollSeconds))?Number(raw.pollSeconds):15,showBench:raw.showBench!==false,alerts:raw.alerts!==false,
 delaySeconds:Number.isInteger(Number(raw.delaySeconds))&&Number(raw.delaySeconds)>=0&&Number(raw.delaySeconds)<=120?Number(raw.delaySeconds):3};
}
export function senderRole(sender,id,optionsUrl){
 if(sender.id!==id)return null;
 if(sender.url===optionsUrl)return 'options';
 try {if(new URL(sender.url).origin==='https://tv.youtube.com'&&sender.frameId===0)return 'overlay';}catch{}
 return null;
}
