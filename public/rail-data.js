// Shared by the Node API and the static-host data adapter, never the renderer.
const columns = {
  QB: [['PASS YDS','pass_yd'],['PASS TD','pass_td'],['INT','pass_int'],['RUSH YDS','rush_yd'],['RUSH TD','rush_td']],
  RB: [['CAR','rush_att'],['RUSH YDS','rush_yd'],['TD','total_td'],['REC','rec'],['REC YDS','rec_yd']],
  WR: [['TGT','rec_tgt'],['REC','rec'],['REC YDS','rec_yd'],['TD','total_td'],['LONG','rec_lng']],
  K: [['FG','fgm'],['ATT','fga'],['LONG','fgm_lng'],['XP','xpm'],['MISSED XP','xpmiss']],
  DEF: [['SACK','sack'],['INT','int'],['FUM REC','fum_rec'],['TD','def_td'],['PTS ALW','pts_allow']],
  IDP: [['TACKLES','idp_tkl'],['SACK','idp_sack'],['INT','idp_int'],['FUM REC','idp_fum_rec'],['TD','idp_def_td']],
};
export function railPlayer(id, player, points, projection, stats) {
  const position=player?.p || '', name=player?.n || `Player ${id}`;
  const fields=columns[position==='TE'?'WR':position] || columns.IDP;
  const value=key=>!stats ? '—' : key==='total_td' ? (stats.rush_td||0)+(stats.rec_td||0) : stats[key] ?? (key.endsWith('_lng')?'—':0);
  return {id:String(id), name, position, nflTeam:player?.t || '',
    initials:name.split(/\s+/).map(s=>s[0]).slice(0,2).join(''),
    headshotUrl:position==='DEF' ? `https://sleepercdn.com/images/team_logos/nfl/${String(player.t).toLowerCase()}.png` : `https://sleepercdn.com/content/nfl/players/${encodeURIComponent(id)}.jpg`,
    fallbackUrl:player?.e ? `https://a.espncdn.com/i/headshots/nfl/players/full/${encodeURIComponent(player.e)}.png` : '',
    points, stats:[...fields.map(([key,stat])=>({key,value:value(stat)})),{key:'PROJ',value:projection==null?'—':Number(projection).toFixed(2)}]};
}

export function gameRailPlayers({matchups,rosters,games,scored},matchupId,gameId,rosterId) {
  const sides=matchups.filter(m=>String(m.matchup_id)===String(matchupId));
  const mine=sides.find(m=>String(m.roster_id)===String(rosterId));
  if(!mine) return null;
  const select=m=>{
    if(!m)return [];
    const roster=rosters.find(r=>r.roster_id===m.roster_id);
    return [...new Set([...(roster?.players||[]),...(m.starters||[])])].filter(id=>id&&id!=='0').map(id=>{
      const p=scored.players[id]?.rail;
      return p&&String(games[p.nflTeam]?.id)===String(gameId)?{...p,bench:!(m.starters||[]).includes(id)}:null;
    }).filter(Boolean).sort((a,b)=>Number(a.bench)-Number(b.bench));
  };
  return {mine:select(mine),opp:select(sides.find(m=>m!==mine))};
}
