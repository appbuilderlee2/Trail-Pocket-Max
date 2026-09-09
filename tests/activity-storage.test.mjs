import test from 'node:test';import assert from 'node:assert/strict';import 'fake-indexeddb/auto';
test('v2 upgrade preserves all offline data and activity completion is atomic',async()=>{
 const name='trail-pocket:'+new URL('../',import.meta.url).pathname;
 const old=await new Promise((resolve,reject)=>{const r=indexedDB.open(name,2);r.onupgradeneeded=()=>{for(const s of ['routes','maps','settings','areas'])r.result.createObjectStore(s,{keyPath:'id'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 await new Promise(resolve=>{const t=old.transaction(['routes','maps','settings','areas'],'readwrite');for(const n of ['routes','maps','settings','areas'])t.objectStore(n).put({id:'keep',value:n});t.oncomplete=resolve;});old.close();
 const db=await import('../storage.mjs');await db.openStore();for(const n of ['routes','maps','settings','areas'])assert.equal((await db.get(n,'keep')).value,n);
 await db.put('settings',{id:'active-activity',value:{id:'a'}});await db.finishActivity({id:'a',status:'completed',distance:100});assert.equal((await db.get('activities','a')).distance,100);assert.equal(await db.get('settings','active-activity'),undefined);assert.equal((await db.get('areas','keep')).value,'areas');
 await db.put('settings',{id:'active-activity',value:{id:'b'}});await assert.rejects(db.finishActivity({status:'completed'}));assert.equal((await db.get('settings','active-activity')).value.id,'b');
});
