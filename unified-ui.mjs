import { OFFLINE_REGIONS } from './offline-regions.mjs';
import * as store from './storage.mjs';

const $ = id => document.getElementById(id);
let previewOfflineBounds=(bounds,name)=>{};
const APP_VERSION_FALLBACK='v4.1.10';
const paths = {
 map:'<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15"/>',
 saved:'<path d="M6 3h12v18l-6-4-6 4V3Z"/>',
 settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
 back:'<path d="m14 5-7 7 7 7"/>',
 layers:'<path d="m3 7 9-4 9 4-9 4-9-4Zm0 5 9 4 9-4m-18 5 9 4 9-4"/>',
 location:'<circle cx="12" cy="12" r="6"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>',
 plus:'<path d="M12 5v14M5 12h14"/>',minus:'<path d="M5 12h14"/>',
 more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
 refresh:'<path d="M20 6v5h-5M4 18v-5h5"/><path d="M18 9a7 7 0 0 0-12-2M6 15a7 7 0 0 0 12 2"/>',
 trash:'<path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
const parkFor = name => OFFLINE_REGIONS.find(region => region.name === name);
const fmtBytes=n=>n>=1048576?`${(n/1048576).toFixed(1)} MB`:`${Math.max(1,Math.round(n/1024))} KB`;
const cleanVersion=value=>String(value||'').match(/v\d+\.\d+\.\d+(?:[-+][\w.-]+)?/i)?.[0]||APP_VERSION_FALLBACK;

function applyVisibleVersion(version){
 const v=cleanVersion(version);
 const header=document.querySelector('.header-status .version');if(header)header.textContent=v;
 const settingsEyebrow=document.querySelector('#settingsView>.eyebrow');if(settingsEyebrow)settingsEyebrow.textContent=`TRAIL POCKET · ${v.toUpperCase()}`;
 const status=$('updateCheckStatus');if(status&&!/正在檢查|發現新版本|檢查失敗/.test(status.textContent||''))status.textContent=`目前版本 ${v}`;
 return v;
}

function workerVersion(worker,timeout=1800){
 return new Promise(resolve=>{
  if(!worker?.postMessage)return resolve(null);
  const channel=new MessageChannel(),timer=setTimeout(()=>resolve(null),timeout);
  channel.port1.onmessage=event=>{clearTimeout(timer);resolve(event.data?.version||null);};
  try{worker.postMessage({type:'STATUS'},[channel.port2]);}catch{clearTimeout(timer);resolve(null);}
 });
}

async function syncVisibleVersion(){
 applyVisibleVersion(APP_VERSION_FALLBACK);
 try{
  const scope=new URL('./',import.meta.url).href,reg=await navigator.serviceWorker?.getRegistration(scope);
  const worker=navigator.serviceWorker?.controller||reg?.active;
  const version=await workerVersion(worker);
  if(version)applyVisibleVersion(version);
 }catch{}
}

function syncParkRows(){
 const api=window.trailPocketPackages,list=$('regionList');
 if(!api||!list)return;
 for(const row of list.querySelectorAll('.region-row')){
  const name=row.querySelector('h3')?.textContent?.trim(),region=parkFor(name),action=row.querySelector('button');
  if(!region||!action)continue;
  const installed=api.covering?.(region.bounds)||[],available=api.availableCovering?.(region.bounds)||[];
  const state=row.querySelector('.region-state'),meta=[...row.children].find(el=>el.tagName==='SPAN'&&!el.classList.contains('region-state'));
  let preview=row.querySelector('.region-preview');if(!preview){preview=document.createElement('button');preview.className='region-preview';preview.textContent='預覽';preview.type='button';action.before(preview);}preview.onclick=event=>{event.preventDefault();event.stopImmediatePropagation();previewOfflineBounds(region.bounds,region.name);};
  if(installed.length){
   if(state){state.textContent='✓';state.classList.add('saved');}
   if(meta)meta.textContent=`已由 ${installed.map(x=>x.name).join(' + ')} 覆蓋`;
   if(action.textContent!=='開啟'){action.textContent='已涵蓋';action.disabled=true;action.dataset.packageCovered='1';}
  }else if(available.length&&action.textContent!=='開啟'){
   if(meta)meta.textContent=`使用正式區域包 · ${available.map(x=>x.name).join(' + ')}`;
   action.textContent='下載';action.disabled=false;action.dataset.packageDownload='1';
  }
 }
}

function setupOfflineLibraryLayout(){
 const offline=$('offlineView'),pkg=offline?.querySelector('.package-library'),parks=offline?.querySelector('.region-library');
 if(!offline||!pkg||!parks)return;
 pkg.classList.add('statewide-library');
 let collapse=$('parkLibraryCollapse');
 if(!collapse){
  collapse=document.createElement('details');collapse.id='parkLibraryCollapse';collapse.className='park-library-collapse';
  const summary=document.createElement('summary');
  summary.innerHTML='<span><b>南澳公園快捷範圍</b><small id="parkLibraryCount"></small></span><i>展開</i>';
  parks.before(collapse);collapse.append(summary,parks);
  collapse.addEventListener('toggle',()=>{summary.querySelector('i').textContent=collapse.open?'收起':'展開';});
 }
 const heading=offline.querySelector('.heading');if(heading)heading.after(pkg);pkg.after(collapse);
 const regionTitle=parks.querySelector('.region-title h2');if(regionTitle)regionTitle.textContent='公園及保護區';
 const regionBack=$('regionBack');if(regionBack)regionBack.hidden=true;
 const updateCount=()=>{const count=$('parkLibraryCount');if(count)count.textContent=`${OFFLINE_REGIONS.length.toLocaleString()} 個公園／保護區 · 可搜尋，需要時先展開`;};
 updateCount();window.addEventListener('trail:parks-changed',updateCount);
}

function compactSettingsPage(){
 const settings=$('settingsView');
 if(!settings)return;
 const intro=settings.querySelector('.settings-intro');
 if(intro)intro.hidden=true;
 for(const card of settings.querySelectorAll('.settings-card')){
  const notes=[...card.children].filter(el=>el.tagName==='P'&&el.id!=='compassStatus');
  if(notes.length){
   const details=document.createElement('details');
   details.className='settings-help';
   details.innerHTML='<summary>說明</summary>';
   for(const note of notes)details.append(note);
   card.append(details);
  }
 }
 const guideTitle=settings.querySelector('.settings-guide-title'),steps=settings.querySelector('.steps');
 if(guideTitle&&steps){
  const details=document.createElement('details');
  details.className='settings-guide settings-all-guide';
  details.innerHTML='<summary>使用及安全說明</summary>';
  guideTitle.before(details);
  details.append(steps);
  guideTitle.remove();
 }
 const looseNotes=[...settings.children].filter(el=>
  el.matches?.('.notice, p.fineprint') && !el.closest('details')
 );
 if(looseNotes.length){
  const details=document.createElement('details');
  details.className='settings-guide settings-storage-guide';
  details.innerHTML='<summary>儲存與離線地圖說明</summary>';
  looseNotes[0].before(details);
  for(const note of looseNotes)details.append(note);
 }
}

function unifyLocationControls(){
 const gpsButton=$('gps'),compassButton=$('compassToggle');
 if(!gpsButton||!compassButton)return;
 const gpsHandler=gpsButton.onclick,compassHandler=compassButton.onclick;
 const gpsCard=gpsButton.closest('.settings-card'),compassCard=compassButton.closest('.settings-card');
 if(gpsCard?.querySelector('h2'))gpsCard.querySelector('h2').textContent='定位與方向';
 if(compassCard?.querySelector('h2'))compassCard.querySelector('h2').textContent='方向狀態';
 compassButton.hidden=true;
 const normalizeLabel=()=>{
  const stopping=/停止定位/.test(gpsButton.textContent||'');
  const label=stopping?'■ 停止定位與方向':'◎ 開始定位與方向';
  if(gpsButton.textContent!==label)gpsButton.textContent=label;
 };
 gpsButton.onclick=event=>{
  const stopping=/停止定位/.test(gpsButton.textContent||'');
  gpsHandler?.call(gpsButton,event);
  if(!stopping)compassHandler?.call(compassButton,event);
  requestAnimationFrame(normalizeLabel);
 };
 new MutationObserver(normalizeLabel).observe(gpsButton,{childList:true,subtree:true,characterData:true});
 normalizeLabel();
}

async function checkAppUpdate(){
 const button=$('checkAppUpdate'),status=$('updateCheckStatus');
 if(!button||!status)return;
 if(!navigator.onLine){status.textContent='目前離線，未能檢查更新';return;}
 button.disabled=true;status.textContent='正在檢查 GitHub Pages 最新版本…';
 try{
  const scope=new URL('./',import.meta.url).href,reg=await navigator.serviceWorker?.getRegistration(scope);
  if(!reg){status.textContent='Service Worker 尚未安裝；請連線重開 App';return;}
  await reg.update();
  let worker=reg.installing;
  if(worker&&worker.state!=='installed')await new Promise(resolve=>{
   const timer=setTimeout(resolve,8000);
   worker.addEventListener('statechange',()=>{if(['installed','redundant'].includes(worker.state)){clearTimeout(timer);resolve();}});
  });
  if(reg.waiting){
   const waitingVersion=cleanVersion(await workerVersion(reg.waiting));
   status.textContent=`發現新版本 ${waitingVersion}，可立即更新`;
   $('updates')?.classList.remove('hide');
  }else{
   const current=applyVisibleVersion(await workerVersion(navigator.serviceWorker?.controller||reg.active)||APP_VERSION_FALLBACK);
   status.textContent=`已是最新版本 · ${current} · ${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`;
  }
 }catch(error){status.textContent='檢查失敗：'+(error?.message||'請稍後再試');}
 finally{button.disabled=false;}
}

async function cleanupLegacyMaps(){
 const button=$('cleanupLegacyMaps'),status=$('cleanupLegacyStatus'),api=window.trailPocketPackages;
 if(!button||!status)return;
 if(!api?.fullyCovering){status.textContent='正式南澳地圖尚未就緒，未有刪除任何資料';return;}
 button.disabled=true;status.textContent='正在比對舊地圖同 production 覆蓋範圍…';
 try{
  const [areas,maps]=await Promise.all([store.getAll('areas'),store.getAll('maps')]),candidates=[],keptTerrain=[];
  for(const [kind,list] of [['areas',areas],['maps',maps]])for(const item of list){
   if(!item?.bounds||!api.fullyCovering(item.bounds).length)continue;
   if(Array.isArray(item.contours)&&item.contours.length){keptTerrain.push(item);continue;}
   candidates.push({kind,item});
  }
  if(!candidates.length){status.textContent=keptTerrain.length?`冇可安全清理嘅重複地圖；保留 ${keptTerrain.length} 張有等高線地圖`:'冇發現重複舊地圖';return;}
  const bytes=candidates.reduce((n,x)=>n+(Number(x.item.size)||0),0),names=candidates.slice(0,5).map(x=>x.item.name||x.item.id).join('、');
  const ok=window.confirm(`可安全清理 ${candidates.length} 張舊地圖（約 ${fmtBytes(bytes)}）。\n\n${names}${candidates.length>5?' 等':''}\n\n呢啲範圍已被正式南澳向量地圖完整覆蓋。GPX/KML、活動、標記、GeoPDF 同有等高線嘅自訂地圖會保留。`);
  if(!ok){status.textContent='已取消，冇刪除任何資料';return;}
  for(const {kind,item} of candidates){if(kind==='areas')await store.removeArea(item.id);else await store.removeMap(item.id);}
  status.textContent=`已清理 ${candidates.length} 張重複舊地圖，釋放約 ${fmtBytes(bytes)}`;
  setTimeout(()=>location.reload(),900);
 }catch(error){status.textContent='清理失敗：'+(error?.message||'請稍後再試');}
 finally{button.disabled=false;}
}

export function setupUnifiedUI(ctx) {
 previewOfflineBounds=ctx.previewBounds||previewOfflineBounds;
 applyVisibleVersion(APP_VERSION_FALLBACK);
 const heading=document.createElement('section');heading.id='libraryHeader';heading.className='library-header hide';
 heading.innerHTML='<h1>我的</h1><div class="library-tabs" role="tablist" aria-label="我的分類"><button id="myRoutes" role="tab" aria-selected="true">路線</button><button id="myMaps" role="tab" aria-selected="false">離線地圖</button><button id="myActivities" role="tab" aria-selected="false">活動</button><button id="myMarkers" role="tab" aria-selected="false">標記</button></div>';
 document.querySelector('main').prepend(heading);
 $('myRoutes').onclick=()=>ctx.nav('routes');$('myMaps').onclick=()=>ctx.nav('offline');$('myActivities').onclick=()=> $('activityHistory').click();$('myMarkers').onclick=()=>ctx.nav('markers');
 window.addEventListener('trail:view',({detail:name})=>{heading.classList.toggle('hide',!['routes','offline','history','markers'].includes(name));for(const [id,view] of [['myRoutes','routes'],['myMaps','offline'],['myActivities','history'],['myMarkers','markers']]) $(id).setAttribute('aria-selected',String(view===name));$('mapToolMenu')?.removeAttribute('open');if(name==='offline')requestAnimationFrame(syncParkRows);});
 window.addEventListener('trail:packages-changed',()=>requestAnimationFrame(syncParkRows));window.addEventListener('trail:parks-changed',()=>{const search=$('regionSearch');if(search)search.dispatchEvent(new Event('input'));requestAnimationFrame(syncParkRows);});
 const parkObserver=new MutationObserver(()=>requestAnimationFrame(syncParkRows));if($('regionList'))parkObserver.observe($('regionList'),{childList:true});
 $('regionList')?.addEventListener('click',async event=>{const action=event.target.closest('.region-row button');if(!action||action.textContent==='開啟'||action.dataset.packageCovered==='1')return;const row=action.closest('.region-row'),region=parkFor(row?.querySelector('h3')?.textContent?.trim()),api=window.trailPocketPackages;if(!region||!api?.availableCovering?.(region.bounds)?.length)return;event.preventDefault();event.stopImmediatePropagation();action.disabled=true;try{await api.downloadCovering(region.bounds);}finally{action.disabled=false;requestAnimationFrame(syncParkRows);}},true);
 for(const [tab,svg,label] of [['explore','map','地圖'],['saved','saved','我的'],['settings','settings','設定']]){const b=document.querySelector(`nav button[data-tab="${tab}"]`);b.innerHTML=icon(svg)+`<span>${label}</span>`;b.setAttribute('aria-label',label);}
 for(const [id,name,label] of [['back','back','返回我的'],['follow','location','返回目前位置'],['fit','map','顯示整條路線'],['zoomIn','plus','放大'],['zoomOut','minus','縮小']]){const b=$(id);b.innerHTML=icon(name);b.setAttribute('aria-label',label);}
 const menu=document.createElement('details');menu.id='mapToolMenu';menu.className='map-tool-menu';menu.innerHTML=`<summary aria-label="更多工具">${icon('more')}</summary><div class="map-tool-items"></div>`;document.querySelector('.map-wrap').append(menu);const items=menu.querySelector('div');
 for(const id of ['jumpPlace','selectArea']){const button=$(id);button.textContent=id==='jumpPlace'?'搜尋地點':'下載地圖範圍';items.append(button);}const quickMarker=document.createElement('button');quickMarker.textContent='標記目前位置';quickMarker.onclick=()=>{$('addMarker').click();menu.open=false;};items.append(quickMarker);const tools=document.querySelector('.trail-tools');if(tools)items.append(tools);items.addEventListener('click',e=>{if(e.target.closest('button'))menu.open=false;});
 const extras=document.createElement('details');extras.className='library-actions';extras.innerHTML='<summary>新增及匯入</summary><div></div>';const row=extras.querySelector('div'),routeHeading=document.querySelector('#routesView .heading');for(const b of [...routeHeading.querySelectorAll('button')]){if(b.id==='import')row.append(b);else b.hidden=true;}const routeTools=document.querySelector('#routesView .route-tools');if(routeTools)for(const b of [...routeTools.querySelectorAll('button')])row.append(b);$('routesView').prepend(extras);
 $('settingsActivityHistory').hidden=true;$('closeActivityHistory').hidden=true;const extraHistory=$('activityHistory');extraHistory.hidden=true;document.querySelectorAll('.eyebrow,.activity-heading small').forEach(e=>e.hidden=true);document.querySelector('#routesView h1').textContent='路線';$('startActivity').textContent='開始活動';
 const appCard=document.createElement('section');appCard.className='settings-card';appCard.innerHTML=`<h2>App 與儲存</h2><p>Trail Pocket 會檢查 PWA 更新，亦可安全清走已被正式南澳地圖完整覆蓋嘅舊式離線包。</p><div class="settings-list"><button id="checkAppUpdate"><span>${icon('refresh')}</span><b>檢查更新</b><small id="updateCheckStatus">目前版本 ${APP_VERSION_FALLBACK}</small><i>›</i></button><button id="cleanupLegacyMaps"><span>${icon('trash')}</span><b>清理重複舊地圖</b><small id="cleanupLegacyStatus">保留 GPX／KML、活動、標記、GeoPDF 及有等高線嘅自訂地圖</small><i>›</i></button></div>`;const storageCard=document.querySelector('#settingsView .settings-storage');storageCard?.before(appCard);$('checkAppUpdate').onclick=checkAppUpdate;$('cleanupLegacyMaps').onclick=cleanupLegacyMaps;
 const downloadGuide=document.createElement('details');downloadGuide.className='settings-guide';downloadGuide.innerHTML='<summary>離線地圖格式及下載說明</summary>';for(const note of [...$('offlineView').querySelectorAll('.fineprint')])downloadGuide.append(note);$('settingsView').append(downloadGuide);
 for(const b of row.querySelectorAll('button'))b.textContent=b.textContent.replace(/^[＋✎▧]\s*/, '');for(const b of items.querySelectorAll('button'))b.textContent=b.textContent.replace(/^[☀⌁✎]\s*/, '');for(const [id,title]of [['settingsMapSource','地圖來源及 GeoPDF'],['settingsLayers','地圖圖層'],['settingsAlerts','偏离路線提醒']]){const b=$(id);b.querySelector('span').innerHTML=icon(id==='settingsMapSource'?'layers':id==='settingsLayers'?'map':'location');b.querySelector('i').innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m9 5 7 7-7 7"/></svg>';}
 setupOfflineLibraryLayout();
 compactSettingsPage();
 unifyLocationControls();
 requestAnimationFrame(syncParkRows);
 syncVisibleVersion();
 navigator.serviceWorker?.addEventListener('controllerchange',()=>setTimeout(syncVisibleVersion,50));
}