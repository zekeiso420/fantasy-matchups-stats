// Ephemeral worker cache. No league or player records are written to disk.
const mem=new Map();let generation=0;
export function clearMemo(){generation++;mem.clear();}
export async function memo(key,ttlMs,loader){
 const hit=mem.get(key);if(hit&&hit.expires>Date.now())return hit.value;
 const token=generation;const value=await loader();
 if(token===generation)mem.set(key,{value,expires:Date.now()+ttlMs});
 return value;
}
export const memoPersist=memo;
