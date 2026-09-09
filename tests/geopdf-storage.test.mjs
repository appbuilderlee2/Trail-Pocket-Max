import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

test('v3 upgrade adds GeoPDF storage and keeps existing data',async()=>{
  const name='trail-pocket:'+new URL('../',import.meta.url).pathname;
  const old=await new Promise((resolve,reject)=>{const r=indexedDB.open(name,3);r.onupgradeneeded=()=>{for(const s of ['routes','maps','settings','areas','activities'])r.result.createObjectStore(s,{keyPath:'id'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  await new Promise(resolve=>{const t=old.transaction('routes','readwrite');t.objectStore('routes').put({id:'keep',name:'Keep'});t.oncomplete=resolve;});old.close();
  const db=await import('../storage.mjs');await db.openStore();
  assert.equal((await db.get('routes','keep')).name,'Keep');
  await db.put('geopdfs',{id:'geopdf:1',name:'Official map',imageData:'data:image/webp;base64,AA==',transform:{bounds:{}}});
  assert.equal((await db.listGeoPdfMeta())[0].imageData,undefined);
  const all=await db.exportAll();assert.equal(all.geopdfs[0].name,'Official map');
  await db.removeGeoPdf('geopdf:1');assert.equal((await db.getAll('geopdfs')).length,0);
});
