import { openPackageCatalog, openPackageFiles, packageCatalog, recordPackageMigration } from './package-storage.mjs';
import { downloadPackage, repairPackage } from './package-downloader.mjs';
import { localPackageFile, packageBytes, validatePackageManifest } from './package-manifest.mjs';
import { searchPackageEntries } from './package-search.mjs';
import { mergePackageGraphs } from './package-routing.mjs';
import { sha256File } from './sha256.mjs';

const RELEASE_INDEX_URL='https://github.com/appbuilderlee2/Trail-Pocket/releases/download/maps-v4-current/sa-index.json';
const LOCAL_URL='./config/sa-index.json';
const PILOT_URL='https://github.com/appbuilderlee2/Trail-Pocket/releases/download/maps-v4-pilot/sa-index.json';
const PRODUCTION_IDS=['adelaide-mount-lofty','fleurieu-kangaroo-island','yorke-mid-north','eyre-peninsula','flinders-far-north','murraylands-riverland','limestone-coast'];
const mb=n=>n>=1048576?`${(n/1048576).toFixed(1)} MB`:`${Math.ceil(n/1024)} KB`;
const overlap=(a,b)=>a[0]<b.east&&a[2]>b.west&&a[1]<b.north&&a[3]>b.south;
const contains=(bounds,p)=>p[0]>=bounds[0]&&p[0]<=bounds[2]&&p[1]>=bounds[1]&&p[1]<=bounds[3];
const fullyContains=(pkgBounds,b)=>pkgBounds[0]<=b.west&&pkgBounds[1]<=b.south&&pkgBounds[2]>=b.east&&pkgBounds[3]>=b.north;

async function decodeJson(files,file,label){
  const raw=await files.read(file.local);
  let bytes=raw;
  if(file.encoding==='gzip'){
    if(typeof DecompressionStream==='undefined')throw Error(`${label} 使用 v4.1 壓縮格式；此瀏覽器未支援解壓`);
    const stream=new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'));
    bytes=new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function setupPackageManager(ctx){
  const root=document.createElement('section');root.className='package-library';
  root.innerHTML='<div class="package-title"><div><span>V4.1 離線向量地圖</span><h2>南澳大利亞州</h2><p id="packageSummary">正在讀取地圖包目錄…</p></div><button id="downloadSouthAustralia" disabled>下載全部</button></div><div id="packageProgress" class="package-progress hide"><span></span><b></b><button id="pausePackage">暫停</button></div><div id="packageList" class="package-list"></div>';
  document.querySelector('#offlineView .heading').after(root);
  const $=id=>document.getElementById(id),manifests=new Map();
  let db,catalog,files,installed=[],downloads=[],controller,busy=false,indexSource='saved';
  const searchCache=new Map(),graphCache=new Map();
  const state=id=>downloads.find(x=>x.id===id);
  const production=()=>PRODUCTION_IDS.map(id=>manifests.get(id)).filter(Boolean);
  const isCurrent=manifest=>installed.some(x=>x.id===manifest.id&&x.version===manifest.version&&x.state==='ready');
  const availableFor=bounds=>production().filter(item=>overlap(item.bounds,bounds));
  const installedFor=bounds=>installed.filter(item=>item.state==='ready'&&overlap(item.bounds,bounds));
  const fullyInstalledFor=bounds=>installed.filter(item=>item.state==='ready'&&fullyContains(item.bounds,bounds));
  const summary=item=>({id:item.id,version:item.version,name:item.name,bounds:item.bounds,bytes:item.files?packageBytes(item):undefined});

  function notify(){window.dispatchEvent(new CustomEvent('trail:packages-changed'));}

  function render(){
    const prod=production(),show=prod.length===7?prod:[...manifests.values()],currentCount=prod.filter(isCurrent).length,full=prod.length===7&&currentCount===7;
    $('packageList').replaceChildren();
    for(const manifest of show){
      const row=document.createElement('div'),s=state(manifest.id),current=installed.find(x=>x.id===manifest.id&&x.state==='ready'),ready=current?.version===manifest.version,hasUpdate=Boolean(current&&!ready);
      const actionLabel=ready?'已下載':s?.state==='paused'?'繼續':s?.state==='failed'?'修復':hasUpdate?'更新':'下載';
      row.className='package-row';
      row.innerHTML=`<span class="package-state">${ready?'✓':hasUpdate?'↻':'↓'}</span><div><b>${manifest.name}</b><small>${mb(packageBytes(manifest))}${manifest.packageFormat==='v4.1-slim'?' · 瘦身包':''}${hasUpdate?` · 已保留 ${current.version}`:''}${s?.state==='paused'?' · 可繼續':s?.state==='failed'?' · 需要修復':''}</small></div><div class="package-actions"><button>${actionLabel}</button>${!ready&&['paused','failed'].includes(s?.state)?'<button class="package-cancel">取消</button>':''}</div>`;
      const button=row.querySelector('button');button.disabled=busy||ready;button.onclick=()=>confirmDownload([manifest],false);
      const cancel=row.querySelector('.package-cancel');if(cancel)cancel.onclick=()=>discard(manifest);
      $('packageList').append(row);
    }
    $('packageSummary').textContent=full?`南澳完整離線 · 7/7 已驗證`:prod.length===7?`${currentCount}/7 個地區已驗證 · 正式 production 目錄 · 下載後跨區自動拼合`:show.length?'測試／備用地圖包可用；正在等待正式南澳目錄':'未能取得地圖包目錄；已下載地圖仍可使用';
    $('downloadSouthAustralia').disabled=busy||prod.length!==7||full;
    $('downloadSouthAustralia').textContent=full?'已完整下載':'下載全部';
    notify();
  }

  async function confirmDownload(rawItems,all){
    if(busy)return false;
    const items=rawItems.filter(Boolean).filter(manifest=>!isCurrent(manifest));
    if(!items.length){ctx.toast('所選地圖已經係最新版本。');return true;}
    const total=items.reduce((n,x)=>n+packageBytes(x),0),ok=await ctx.ask(all?'下載完整南澳？':'下載離線地圖？',`${items.length} 個地區，共 ${mb(total)}。大型下載建議使用 Wi‑Fi；會檢查空間、支援續傳，並逐檔做 SHA‑256 驗證。`,'開始下載');
    if(!ok)return false;
    busy=true;controller=new AbortController();render();$('packageProgress').classList.remove('hide');
    let completed=false;
    try{
      let prior=0,startedAt=0,startedBytes=0;
      for(let i=0;i<items.length;i++){
        const manifest=items[i],action=state(manifest.id)?.state==='failed'?repairPackage:downloadPackage;
        await action(manifest,{files,catalog,signal:controller.signal,onProgress:p=>{
          if(!startedAt){startedAt=Date.now();startedBytes=prior+p.received;}
          const received=prior+p.received,ratio=Math.min(1,total?received/total:0),elapsed=Math.max(1,(Date.now()-startedAt)/1000),speed=Math.max(0,(received-startedBytes)/elapsed),remaining=speed>1024?Math.ceil(Math.max(0,total-received)/speed):null,eta=remaining===null?'計算剩餘時間…':remaining<60?`約 ${remaining} 秒`:`約 ${Math.ceil(remaining/60)} 分鐘`;
          $('packageProgress').querySelector('span').style.width=`${Math.round(ratio*100)}%`;
          $('packageProgress').querySelector('b').textContent=`${manifest.name} · 總計 ${Math.round(ratio*100)}% · ${eta} · ${i+1}/${items.length}`;
        }});
        prior+=packageBytes(manifest);
      }
      completed=true;ctx.toast('離線地圖已下載並通過完整性驗證。');
    }catch(error){ctx.toast(error?.name==='AbortError'?'下載已暫停；下次會由現有進度繼續。':ctx.failure(error));}
    finally{busy=false;controller=null;downloads=await catalog.list('downloads');installed=await catalog.list('packages');$('packageProgress').classList.add('hide');render();ctx.changed?.();}
    return completed;
  }

  async function downloadCovering(bounds){
    const matches=availableFor(bounds);
    if(!matches.length){ctx.toast('暫時未有正式南澳地圖包覆蓋呢個公園。');return false;}
    return confirmDownload(matches,false);
  }

  $('downloadSouthAustralia').onclick=()=>confirmDownload(production(),true);
  $('pausePackage').onclick=()=>controller?.abort();

  async function discard(manifest){
    if(busy)return;
    for(const entry of manifest.files)try{await files.remove(localPackageFile(manifest,entry));}catch{}
    await catalog.remove('downloads',manifest.id);downloads=await catalog.list('downloads');render();ctx.toast('未完成下載已取消及清除。');
  }

  async function loadIndex(url,timeout){
    const aborter=new AbortController(),timer=setTimeout(()=>aborter.abort(),timeout);
    try{
      const response=await fetch(url,{cache:'no-store',signal:aborter.signal});
      if(!response.ok)throw Error(`HTTP ${response.status}`);
      const index=await response.json();
      if(index.schema!==1||!Array.isArray(index.packages))throw Error('地圖包目錄格式無效');
      return index.packages.map(validatePackageManifest);
    }finally{clearTimeout(timer);}
  }

  async function saveManifests(list){for(const manifest of list){manifests.set(manifest.id,manifest);await catalog.put('manifests',manifest);}}

  async function updateIndex(){
    let productionLoaded=false;
    try{
      const list=await loadIndex(LOCAL_URL,6000),prod=list.filter(x=>PRODUCTION_IDS.includes(x.id));
      if(prod.length===7){await saveManifests(prod);productionLoaded=true;indexSource='same-origin-production';render();}
      else if(!manifests.size){await saveManifests(list);indexSource='local-fallback';render();}
    }catch(error){console.warn('Trail Pocket same-origin catalog unavailable',error);}
    if(!productionLoaded){
      try{
        const list=await loadIndex(RELEASE_INDEX_URL,10000),prod=list.filter(x=>PRODUCTION_IDS.includes(x.id));
        if(prod.length!==7)throw Error(`正式南澳目錄不完整（${prod.length}/7）`);
        await saveManifests(prod);productionLoaded=true;indexSource='release-production';render();
      }catch(error){console.warn('Trail Pocket release catalog unavailable',error);}
    }
    if(!productionLoaded&&production().length===7){productionLoaded=true;indexSource='saved-production';render();}
    if(!productionLoaded&&!production().length){
      try{await saveManifests(await loadIndex(PILOT_URL,8000));indexSource='pilot';render();}
      catch(error){console.warn('Trail Pocket pilot catalog unavailable',error);}
    }
    return {production:productionLoaded,source:indexSource,count:production().length};
  }

  async function init(){
    try{
      db=await openPackageCatalog();catalog=packageCatalog(db);files=await openPackageFiles();await recordPackageMigration(catalog);
      [installed,downloads]=await Promise.all([catalog.list('packages'),catalog.list('downloads')]);
      for(const saved of await catalog.list('manifests'))try{manifests.set(saved.id,validatePackageManifest(saved));}catch{}
    }catch(error){$('packageSummary').textContent=error.message.includes('未支援')?error.message:'未能開啟離線地圖儲存；現有資料不會被覆寫';}
    render();if(navigator.onLine&&catalog)updateIndex().catch(()=>{});
  }

  async function search(query,center){
    const sources=[];
    for(const item of installed.filter(x=>x.state==='ready')){
      const file=item.files.find(x=>x.name==='search.index');if(!file?.local)continue;
      let index=searchCache.get(file.local);if(!index){index=await decodeJson(files,file,`${item.name} 搜尋索引`);if(index.version!==1||!Array.isArray(index.entries))throw Error(`${item.name} 搜尋索引損壞`);searchCache.set(file.local,index);}
      sources.push({name:item.name,entries:index.entries});
    }
    return searchPackageEntries(sources,query,center);
  }

  async function routingGraph(start,end){
    const corridor={west:Math.min(start[0],end[0])-.08,east:Math.max(start[0],end[0])+.08,south:Math.min(start[1],end[1])-.08,north:Math.max(start[1],end[1])+.08},selected=installed.filter(item=>item.state==='ready'&&overlap(item.bounds,corridor));
    if(!selected.some(x=>contains(x.bounds,start))||!selected.some(x=>contains(x.bounds,end)))return null;
    const graphs=[];
    for(const item of selected){const file=item.files.find(x=>x.name==='routing.graph');if(!file?.local)continue;let graph=graphCache.get(file.local);if(!graph){graph=await decodeJson(files,file,`${item.name} 步道路網`);if(graph.version!==1||!graph.nodes||!graph.edges)throw Error(`${item.name} 步道路網損壞`);graphCache.set(file.local,graph);}graphs.push(graph);}
    return graphs.length?{id:'pmtiles:'+selected.map(x=>x.id+':'+x.version).join('|'),downloaded:selected.map(x=>x.verifiedAt).join('|'),routingGraph:mergePackageGraphs(graphs)}:null;
  }

  async function audit(){
    const bad=[];
    for(const item of installed.filter(x=>x.state==='ready'))try{
      for(const file of item.files){const stat=await files.stat(file.local);if(stat?.size!==file.size||await sha256File(files,file.local,file.size)!==file.sha256)throw Error(file.name);}
    }catch{bad.push(item.name||item.id);await catalog.put('packages',{...item,state:'corrupt'});await catalog.put('downloads',{id:item.id,version:item.version,state:'failed',received:0,total:item.files.reduce((n,x)=>n+x.size,0),error:'完整性驗證失敗',updatedAt:Date.now()});}
    if(bad.length){installed=await catalog.list('packages');downloads=await catalog.list('downloads');render();}
    return {checked:installed.filter(x=>x.state==='ready').length+bad.length,bad};
  }

  const api={
    init,search,routingGraph,audit,updateIndex,downloadCovering,
    covering:bounds=>installedFor(bounds),
    fullyCovering:bounds=>fullyInstalledFor(bounds).map(summary),
    availableCovering:bounds=>availableFor(bounds).map(summary),
    listInstalled:()=>installed.filter(x=>x.state==='ready').map(({id,version,name,bounds,files})=>({id,version,name,bounds,bytes:files?.reduce((n,f)=>n+(f.size||0),0)||0})),
    listAvailable:()=>production().map(summary),
    files:()=>files,pause:()=>controller?.abort(),
    refresh:async()=>{installed=await catalog.list('packages');downloads=await catalog.list('downloads');render();}
  };
  window.trailPocketPackages=api;return api;
}
