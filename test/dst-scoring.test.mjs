import test from 'node:test';
import assert from 'node:assert/strict';
import {railGroups} from '../public/rail-data.js';
const cells=(stats,settings)=>railGroups('DEF',stats,settings).flatMap(g=>g.cells);
test('DST allowed tiers use each league settings for positive and negative contributions',()=>{
 const stats={pts_allow:17,pts_allow_14_20:1,yds_allow:470,yds_allow_450_499:1,sack:2};
 let c=cells(stats,{pts_allow_14_20:1,yds_allow_450_499:-4,sack:1});
 assert.equal(c.find(x=>x.label==='YDS').value,'470');assert.equal(c.find(x=>x.label==='YDS').line.text,'−4.00 pts');assert.equal(c.find(x=>x.label==='YDS').bad,true);
 c=cells(stats,{yds_allow_450_499:3,sack:2});assert.equal(c.find(x=>x.label==='YDS').line.text,'3.00 pts');assert.equal(c.find(x=>x.label==='SACK').line.text,'4.00 pts');assert.equal(c.some(x=>x.label==='PTS'),false);
});
test('DST includes enabled turnover, block and special team contributions, excludes disabled settings',()=>{
 const c=cells({ff:2,blk_kick:1,def_st_td:1,def_st_fum_rec:1,int:1},{ff:1,blk_kick:2,def_st_td:6,def_st_fum_rec:1,int:0});
 assert.equal(c.find(x=>x.label==='FORCED FUM').line.text,'2.00 pts');assert.equal(c.find(x=>x.label==='BLOCK').line.text,'2.00 pts');assert.equal(c.find(x=>x.label==='ST TD').line.text,'6.00 pts');assert.equal(c.some(x=>x.label==='INT'),false);
 assert.deepEqual(railGroups('DST',{sack:1},{sack:2}),railGroups('DEF',{sack:1},{sack:2}));
});
