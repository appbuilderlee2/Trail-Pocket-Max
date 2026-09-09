import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { openPackageCatalog, openPackageFiles, packageCatalog, recordPackageMigration } from '../package-storage.mjs';

test('v4 catalog is isolated from the v3 rollback database', async () => {
  const factory = new IDBFactory();
  const old = await new Promise((resolve, reject) => {
    const r = factory.open('trail-pocket:/test/', 5);
    r.onupgradeneeded = () => {
      for (const name of ['routes','maps','settings','areas','activities','geopdfs','markers'])
        r.result.createObjectStore(name, { keyPath: 'id' }).put({ id: 'keep', value: name });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const catalog = await openPackageCatalog(factory, '/test/');
  assert.deepEqual([...catalog.objectStoreNames], ['downloads','manifests','metadata','packages']);
  assert.equal(old.version, 5);
  for (const name of old.objectStoreNames) {
    const result = await new Promise(resolve => {
      const r = old.transaction(name).objectStore(name).get('keep');
      r.onsuccess = () => resolve(r.result);
    });
    assert.equal(result.value, name);
  }
  old.close(); catalog.close();
});

test('v4 catalog records a completed migration without changing personal v5 data',async()=>{
  const db=await openPackageCatalog(new IDBFactory(),'/migration/'), catalog=packageCatalog(db);
  const migration=await recordPackageMigration(catalog,1234);
  assert.equal(migration.schemaVersion,2);
  assert.equal(migration.personalDatabaseVersion,5);
  assert.equal((await catalog.get('metadata','migration')).state,'ready');
  db.close();
});

test('package catalog v1 upgrades to metadata schema without losing downloads',async()=>{
  const factory=new IDBFactory(), name='trail-pocket-packages:/upgrade/';
  const old=await new Promise((resolve,reject)=>{const request=factory.open(name,1);request.onupgradeneeded=()=>{for(const store of ['packages','downloads','manifests'])request.result.createObjectStore(store,{keyPath:'id'});request.transaction.objectStore('downloads').put({id:'para-wirra',state:'paused',received:42});};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  old.close();
  const upgraded=await openPackageCatalog(factory,'/upgrade/'), catalog=packageCatalog(upgraded);
  assert.equal((await catalog.get('downloads','para-wirra')).received,42);
  assert.ok(upgraded.objectStoreNames.contains('metadata'));
  upgraded.close();
});

test('unsupported file storage fails explicitly', async () => {
  await assert.rejects(openPackageFiles({}), /未支援/);
});

test('partial writes require the exact resume offset and reject paths', async () => {
  let data = new Uint8Array();
  const handle = {
    getFile: async () => new Blob([data]),
    createWritable: async () => ({
      async write({position, data: chunk}) {
        const next = new Uint8Array(position + chunk.length);
        next.set(data); next.set(chunk, position); data = next;
      }, async close() {}, async abort() {},
    }),
  };
  const files = await openPackageFiles({getDirectory: async () => ({
    getDirectoryHandle: async () => ({getFileHandle: async () => handle}),
  })});
  await files.append('park.partial', 0, new Uint8Array([1,2]));
  await files.append('park.partial', 2, new Uint8Array([3]));
  assert.deepEqual([...new Uint8Array(await files.read('park.partial'))], [1,2,3]);
  await assert.rejects(files.append('park.partial', 1, new Uint8Array([9])), /不一致/);
  await assert.rejects(files.read('../other'), /名稱/);
  await assert.rejects(files.append('active.pmtiles', 3, new Uint8Array()), /只可/);
});
