import {readFile,writeFile,mkdir} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
await mkdir(new URL('extension/vendor/',root),{recursive:true});
for(const name of ['backend-static.js','nfl.js','scoring.js','rail-data.js','memo.js']){
 let code=(await readFile(new URL('public/'+name,root),'utf8')).replace(/\.js\?v=[^'"\s]+/g,'.js');
 if(name==='memo.js')code=`// Ephemeral worker cache. No league or player records are written to disk.
const mem=new Map();let generation=0;
export function clearMemo(){generation++;mem.clear();}
export async function memo(key,ttlMs,loader){
 const hit=mem.get(key);if(hit&&hit.expires>Date.now())return hit.value;
 const token=generation;const value=await loader();
 if(token===generation)mem.set(key,{value,expires:Date.now()+ttlMs});
 return value;
}
export const memoPersist=memo;
`;
 if(name==='backend-static.js')code=code.split('// No server to cache for us here')[0].replace('fetch(url)', "fetch(url, {signal: AbortSignal.timeout(15000), credentials:'omit', referrerPolicy:'no-referrer'})");
 await writeFile(new URL('extension/vendor/'+name,root),code);
}
