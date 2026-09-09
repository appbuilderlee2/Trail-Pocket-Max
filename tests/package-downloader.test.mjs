import test from 'node:test';
import assert from 'node:assert/strict';
import { Sha256 } from '../sha256.mjs';
import { downloadPackage, assertPackageStorage } from '../package-downloader.mjs';

const bytes = value => new TextEncoder().encode(value);
const digest = value => new Sha256().update(value).digest();
function memoryFiles() {
  const data = new Map();
  return {
    data,
    async stat(name){const v=data.get(name);return v?{name,size:v.length}:null},
    async read(name,offset=0,length){const v=data.get(name);return v.slice(offset,length===undefined?v.length:offset+length).buffer},
    async append(name,offset,chunk){const old=data.get(name)||new Uint8Array();assert.equal(old.length,offset);const next=new Uint8Array(offset+chunk.length);next.set(old);next.set(chunk,offset);data.set(name,next);return next.length},
    async remove(name){data.delete(name)},
  };
}
function manifest(contents) {
  const names=['map.pmtiles','search.index','routing.graph'];
  return {schema:1,id:'para-wirra',name:'Para Wirra',version:'2026.09.08',bounds:[138.78,-34.735,138.91,-34.60],builtAt:'2026-09-08T00:00:00Z',osmDate:'2026-09-07',minAppVersion:'4.0.0',files:names.map((name,i)=>({name,url:`https://maps.example/${name}`,size:contents[i].length,sha256:digest(contents[i])}))};
}
function catalog() { const records=new Map(); return {records,async put(store,value){records.set(`${store}:${value.id}`,structuredClone(value));return value.id}}; }
function rangeFetcher(contents) {
  const byName=new Map(['map.pmtiles','search.index','routing.graph'].map((n,i)=>[n,contents[i]]));
  return async (url,{headers})=>{const source=byName.get(url.split('/').pop()),m=/bytes=(\d+)-(\d+)/.exec(headers.Range),start=+m[1],end=Math.min(+m[2],source.length-1),part=source.slice(start,end+1);return new Response(part,{status:206,headers:{'content-range':`bytes ${start}-${end}/${source.length}`,'content-length':String(part.length)}})};
}

test('incremental SHA-256 matches standard vectors across chunk boundaries',()=>{
  assert.equal(digest(bytes('abc')),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const hash=new Sha256();hash.update(bytes('a'));hash.update(bytes('bc'));assert.equal(hash.digest(),digest(bytes('abc')));
});
test('package download uses ranges, verifies every file and only then marks ready',async()=>{
  const contents=[bytes('0123456789'),bytes('search data'),bytes('walking graph')],files=memoryFiles(),cat=catalog();
  const installed=await downloadPackage(manifest(contents),{files,catalog:cat,fetcher:rangeFetcher(contents),chunkSize:4,skipStorageCheck:true,now:()=>5});
  assert.equal(installed.state,'ready');
  assert.equal(cat.records.get('downloads:para-wirra').state,'ready');
  assert.equal(installed.files.length,3);
});
test('interrupted package resumes from exact partial offset',async()=>{
  const contents=[bytes('0123456789'),bytes('search data'),bytes('walking graph')],files=memoryFiles(),cat=catalog(),controller=new AbortController();
  await assert.rejects(downloadPackage(manifest(contents),{files,catalog:cat,fetcher:rangeFetcher(contents),chunkSize:4,skipStorageCheck:true,signal:controller.signal,onProgress:()=>controller.abort()}),/aborted|暫停/i);
  assert.equal(cat.records.get('downloads:para-wirra').state,'paused');
  let firstRange=''; const base=rangeFetcher(contents);
  const fetcher=async(url,opts)=>{if(!firstRange)firstRange=opts.headers.Range;assert.equal(opts.headers.Accept,'application/octet-stream');return base(url,opts)};
  await downloadPackage(manifest(contents),{files,catalog:cat,fetcher,chunkSize:4,skipStorageCheck:true});
  assert.equal(firstRange,'bytes=4-7');
});
test('storage preflight refuses downloads without safety reserve',async()=>{
  await assert.rejects(assertPackageStorage({estimate:async()=>({quota:100,usage:90})},20,5),/不足/);
});
