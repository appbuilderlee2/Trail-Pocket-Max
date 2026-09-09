import test from 'node:test';import assert from 'node:assert/strict';import 'fake-indexeddb/auto';
const dbURL=new URL('../storage.mjs',import.meta.url),name='trail-pocket:'+new URL('./',dbURL).pathname;
test('v1 upgrade preserves routes, maps and settings while adding independent areas',async()=>{
  const old=await new Promise((resolve,reject)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>{for(const n of ['routes','maps','settings'])r.result.createObjectStore(n,{keyPath:'id'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  await new Promise((resolve,reject)=>{const t=old.transaction(['routes','maps','settings'],'readwrite');t.objectStore('routes').put({id:'route-old',name:'Keep'});t.objectStore('maps').put({id:'route-old',data:{elements:[{id:1}]},size:123});t.objectStore('settings').put({id:'alerts',value:{threshold:100}});t.oncomplete=resolve;t.onerror=()=>reject(t.error);});old.close();
  const db=await import('../storage.mjs');await db.openStore();assert.equal((await db.get('routes','route-old')).name,'Keep');assert.equal((await db.get('maps','route-old')).size,123);assert.equal((await db.get('settings','alerts')).value.threshold,100);
  await db.put('areas',{id:'north',name:'North',data:{elements:[]},size:50});await db.put('areas',{id:'south',name:'South',data:{elements:[]},size:60});assert.equal((await db.listMapMeta('areas')).length,2);assert.equal((await db.listMapMeta('areas'))[0].data,undefined);
  await db.removeArea('north');assert.equal((await db.getAll('areas')).length,1);assert.equal((await db.get('routes','route-old')).name,'Keep');await db.removeRoute('route-old');assert.equal((await db.get('areas','south')).name,'South');
});
