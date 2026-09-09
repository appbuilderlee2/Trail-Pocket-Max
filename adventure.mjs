import {distance,routeLength,nearestDistance,validCoordinate} from './core.mjs';
import {elevationStats,planRoute,createCustomRoute,toGPX,advanceDeviation,weatherPoint,weatherURL,validateWeather} from './adventure-core.mjs';
import {chooseRoutingRecord,closestRoutePoint} from './routing-client.mjs';
import * as store from './storage.mjs';

export function setupAdventure(ctx){
  const $=id=>document.getElementById(id),map=ctx.map;
  let layers={forest:true,water:true,roads:true,buildings:true,pois:true,labels:true,contours:true,waypoints:true,slope:false},alertSettings={enabled:false,threshold:100,sound:false},deviation={armed:false},audio=null,draft=null,waypoints=[],weatherBusy=false,weatherSerial=0,rerouteBusy=false,rerouteKey='';
  let routeWorker,workerSerial=0;const workerJobs=new Map(),loadedGraphs=new Set();
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  const btn=(text,fn)=>{const n=el('button',text);n.onclick=fn;return n;};
  const warn=e=>ctx.toast(ctx.failure(e));
  $('routesView').querySelector('.heading').after(Object.assign(el('div'),{className:'route-tools'}));
  document.querySelector('.route-tools').append(btn('✎ 建立自訂路線',()=>startEditor(false)),el('small','毋須訂閱 · 可儲存多條路線；受裝置容量及下載服務限制。','muted'));
  const tools=el('div',undefined,'trail-tools');
  tools.append(btn('☀ 天氣',openWeather),btn('⌁ 路線助手',openPlanner),btn('✎ 自訂／匯出',openCustom));
  for(const b of tools.children)b.dataset.routeRequired='true';
  $('mapView').querySelector('.map-head').after(tools);
  $('mapView').insertAdjacentHTML('beforeend',`<div id="deviationBanner" class="deviation hide" role="alert"></div><div id="editorBar" class="editor-bar hide"><b>自訂路線 · 紫色虛線</b><p>拖動地圖，將中央十字移到目標，再按「加入中心點」。</p><label class="check"><input id="snapPaths" type="checkbox" checked> 沿已下載步道自動連線</label><div id="draftInfo" role="status"></div><div class="row"><button id="addPoint">＋ 加入中心點</button><button id="undoPoint">撤回末點</button><button id="reverseDraft">反轉方向</button><button id="saveDraft" class="primary">另存新路線</button><button id="cancelDraft">取消編輯</button></div></div>`);
  document.body.insertAdjacentHTML('beforeend',`
    <dialog id="layersDialog"><h2>地圖圖層</h2><p>道路、林地、水域、名稱及等高線開關只影響「已下載離線底圖」；在線完整地圖為固定圖層。路線坡度及標記兩種模式均可用。</p><div id="layerChoices" class="check-list"></div><p class="notice">等高線以約 20 m 間距顯示，由下載的開放高程格網在手機產生；粗線及標籤為 100 m 主等高線。只作地形參考，並非測量或安全資料。</p><p class="notice">坡度只根據 GPX／KML 高度，唔係整片地形。綠 &lt;5% · 橙 5–15% · 紅 ≥15% · 灰：缺少高度或點距太短。高度誤差可能造成異常顏色。</p><p>林地唔代表全程有遮蔭；此版未提供衛星或山泥傾瀉風險圖。</p><button data-close="layersDialog" class="primary">完成</button></dialog>
    <dialog id="alertsDialog"><h2>偏離路線提醒</h2><label class="check"><input id="alertsEnabled" type="checkbox"> 開啟前景提醒</label><label for="alertThreshold">提醒距離</label><select id="alertThreshold"><option value="50">50 m（較敏感）</option><option value="100" selected>100 m</option><option value="200">200 m</option></select><label class="check"><input id="alertSound" type="checkbox"> 聲音提示</label><button id="testAlert">測試提示聲</button><p class="notice">需要同時「開始定位」。先到達路線約 300 m 範圍才啟動監察；連續 3 個可靠位置、至少持續 10 秒先提醒。GPS 精度差會暫停判斷。iPhone 鎖屏／背景、靜音模式可能冇聲或停止定位，唔可以代替留意路牌。</p><button data-close="alertsDialog" class="primary">完成</button></dialog>
    <dialog id="plannerDialog"><h2>路線助手</h2><p id="plannerName"></p><div class="form-grid"><label>步速 km/h<input id="planSpeed" type="number" min="1" max="8" step="0.5" value="3"></label><label>總休息 分鐘<input id="planRest" type="number" min="0" max="600" value="20"></label><label>每段 km<input id="planStage" type="number" min="0.5" max="20" step="0.5" value="2"></label></div><button id="calculatePlan">計算行程</button><div id="planOutput"></div><div id="elevationProfile"></div><p class="fineprint">本機規則式估算，唔係 AI 導遊或安全評級。距離只計匯入軌跡，唔自動加入回程。完整高度時，每上升 600 m 加 1 小時；未考慮路況、負重或下坡難度。分段標記唔代表安全休息點。</p><button data-close="plannerDialog" class="primary">關閉</button></dialog>
    <dialog id="weatherDialog"><h2>路線附近天氣</h2><p id="weatherName"></p><div id="weatherOutput"></div><p class="fineprint">按更新會將路線中點（約 10 m 精度）送往 Open-Meteo；唔會傳送 GPS 即時位置或整個檔案。顯示該區模型預報，唔係沿線實測，亦未提供即時封路、火警或現場積雪狀況。</p><button id="refreshWeather">同意並更新天氣</button><p><a href="https://open-meteo.com/" target="_blank" rel="noopener">Weather data by Open-Meteo</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a></p><button data-close="weatherDialog" class="primary">關閉</button></dialog>
    <dialog id="customDialog"><h2>自訂路線</h2><p>複製後編輯，不會改動原始路線。已下載完整離線地圖時，可在手機內沿步道路網計算；沒有路網才會警告並使用直線。</p><div class="stack"><button id="editCopy">複製目前路線再編輯</button><button id="drawNew">喺目前地圖畫新路線</button><button id="exportGPX">匯出目前路線 GPX</button></div><button data-close="customDialog" class="primary">關閉</button></dialog>
    <dialog id="startDialog"><h2>選擇起始地區</h2><p>輸入起點附近座標，之後可拖動地圖加點。未下載底圖時只會顯示路線。</p><label>緯度<input id="startLat" type="number" min="-85" max="85" step="any" placeholder="例如 -34.68"></label><label>經度<input id="startLon" type="number" min="-180" max="180" step="any" placeholder="例如 138.82"></label><button id="startDrawing" class="primary">開始畫線</button><button data-close="startDialog">取消</button></dialog>
    <dialog id="saveDraftDialog"><h2>另存自訂路線</h2><label>新路線名稱<input id="draftName" maxlength="160"></label><p>儲存後到「離線下載」下載新路線範圍；不會假設原有底圖覆蓋新路線。</p><button id="confirmDraft" class="primary">儲存新路線</button><button data-close="saveDraftDialog">繼續編輯</button></dialog>`);
  for(const b of document.querySelectorAll('[data-close]'))b.onclick=()=>$(b.dataset.close).close();
  for(const [key,label] of Object.entries({roads:'道路及步道',buildings:'建築物',pois:'設施及地點',forest:'林地／地表',water:'河流及水域',labels:'名稱標籤',contours:'20 m 等高線',waypoints:'路線標記',slope:'路線坡度著色'})){
    const l=el('label',undefined,'check'),input=el('input');input.type='checkbox';input.checked=layers[key];input.dataset.layer=key;input.onchange=async()=>{layers[key]=input.checked;map.setLayers(layers);try{await store.put('settings',{id:'layers',value:layers});}catch(e){warn(e);}};l.append(input,document.createTextNode(label));$('layerChoices').append(l);
  }
  async function init(){try{const saved=await store.get('settings','layers');if(saved?.value)Object.assign(layers,saved.value);map.setLayers(layers);for(const input of document.querySelectorAll('[data-layer]'))input.checked=Boolean(layers[input.dataset.layer]);const a=await store.get('settings','alerts');if(a?.value)Object.assign(alertSettings,a.value);$('alertsEnabled').checked=alertSettings.enabled;$('alertSound').checked=alertSettings.sound;$('alertThreshold').value=String(alertSettings.threshold);}catch(e){warn(e);}}
  async function unlockAudio(){try{const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)throw Error('此瀏覽器未支援提示聲。');audio??=new Audio();await audio.resume();return true;}catch(e){warn(e);return false;}}
  function beep(){if(audio?.state!=='running')return;try{const o=audio.createOscillator(),g=audio.createGain();o.frequency.value=740;g.gain.setValueAtTime(.12,audio.currentTime);g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+.6);o.connect(g);g.connect(audio.destination);o.start();o.stop(audio.currentTime+.6);o.onended=()=>{o.disconnect();g.disconnect();};}catch{}}
  async function saveAlerts(){alertSettings={enabled:$('alertsEnabled').checked,threshold:Number($('alertThreshold').value),sound:$('alertSound').checked};deviation={armed:false};$('deviationBanner').classList.add('hide');if(alertSettings.sound)await unlockAudio();try{await store.put('settings',{id:'alerts',value:alertSettings});if(alertSettings.enabled)ctx.toast('提醒已開啟；到達路線 300 m 範圍後先會開始偏航監察。');}catch(e){warn(e);}}
  $('alertsEnabled').onchange=$('alertThreshold').onchange=$('alertSound').onchange=saveAlerts;
  $('testAlert').onclick=async()=>{if(await unlockAudio()){beep();ctx.toast('提示聲已測試；請檢查音量。');}};
  async function routeDownloaded(start,end){
    const record=chooseRoutingRecord(map.getOfflineRecords(),start,end)||await ctx.getPackageGraph?.(start,end);if(!record)throw Error('起點及終點不在同一個已下載步道路網內。');
    if(!routeWorker){routeWorker=new Worker(new URL('./route-worker.mjs',import.meta.url),{type:'module'});routeWorker.onmessage=e=>{const job=workerJobs.get(e.data?.id);if(!job)return;workerJobs.delete(e.data.id);e.data.ok?job.resolve(e.data.result):job.reject(Error(e.data.error));};routeWorker.onerror=()=>{for(const job of workerJobs.values())job.reject(Error('離線路線運算器發生錯誤。'));workerJobs.clear();loadedGraphs.clear();routeWorker.terminate();routeWorker=null;};}
    const id=++workerSerial,graphId=(record.id||'map')+':'+(record.downloaded||0),payload={id,graphId,start,end};if(!loadedGraphs.has(graphId)){payload.graph=record.routingGraph;loadedGraphs.add(graphId);}return new Promise((resolve,reject)=>{workerJobs.set(id,{resolve,reject});routeWorker.postMessage(payload);});
  }
  async function refreshReroute(fix,route,d){
    const point=[fix.coords.longitude,fix.coords.latitude],target=closestRoutePoint(route.segments,point);if(!target)return;const key=route.id+':'+point.map(v=>v.toFixed(4)).join(',');if(rerouteBusy||key===rerouteKey)return;rerouteBusy=true;rerouteKey=key;const banner=$('deviationBanner');banner.classList.remove('hide','uncertain');banner.textContent=`你偏離路線約 ${Math.round(d)} m。正在已下載步道路網內計算返回路線…`;
    try{const result=await routeDownloaded(point,target.point);if(ctx.getRoute()?.id!==route.id)return;map.setReroute([result.path]);banner.textContent=`你偏離路線約 ${Math.round(d)} m。藍色虛線是離線步道路網建議，約 ${Math.round(result.distance)} m 返回原路線；請先核對現場路牌及可通行性。`;}
    catch(e){map.setReroute(null);banner.textContent=`你偏離路線約 ${Math.round(d)} m。未能在已下載範圍內重新規劃：${ctx.failure(e)} 請停在安全位置核對地圖。`;}
    finally{rerouteBusy=false;}
  }
  function onFix(fix){
    const r=ctx.getRoute(),banner=$('deviationBanner');if(!fix||!r||!alertSettings.enabled||draft){banner.classList.add('hide');deviation={};map.setReroute(null);rerouteKey='';return;}
    const d=nearestDistance([fix.coords.longitude,fix.coords.latitude],r.segments);
    deviation=advanceDeviation(deviation,{distance:d,accuracy:fix.coords.accuracy,timestamp:fix.timestamp},alertSettings.threshold);
    banner.classList.toggle('hide',['on-route','checking','not-started'].includes(deviation.status));
    banner.textContent=deviation.status==='uncertain'?'偏航判斷暫停：位置過舊或 GPS 精度不足。':`你可能偏離路線約 ${Math.round(d)} m。請停喺安全位置，核對地圖及路牌。`;
    banner.classList.toggle('uncertain',deviation.status==='uncertain');
    if(['on-route','checking','not-started'].includes(deviation.status)){map.setReroute(null);rerouteKey='';}
    if(deviation.notify&&!document.hidden){if(alertSettings.sound)beep();refreshReroute(fix,r,d).catch(warn);}
  }
  function routeChanged(){deviation={armed:false};rerouteKey='';map.setReroute(null);$('deviationBanner').classList.add('hide');}
  function openPlanner(){if(!ctx.getRoute())return;const r=ctx.getRoute();$('plannerName').textContent=r.name;$('planSpeed').value=r.plan?.speed||3;$('planRest').value=r.plan?.rest??20;$('planStage').value=r.plan?.stage||2;calculatePlan(false);$('plannerDialog').showModal();}
  async function calculatePlan(save=true){
    const r=ctx.getRoute();if(!r)return;const out=$('planOutput');out.replaceChildren();
    try{const speed=Number($('planSpeed').value),rest=Number($('planRest').value),stage=Number($('planStage').value),plan=planRoute(r.segments,speed,rest,stage);
      const rounded=Math.round(plan.minutes);out.append(el('h3',`約 ${Math.floor(rounded/60)} 小時 ${rounded%60} 分鐘`),el('p',`${(plan.length/1000).toFixed(2)} km · 包括休息 ${rest} 分鐘`));
      out.append(el('p',plan.elevation.complete?`檔案累計上升 ${Math.round(plan.elevation.ascent)} m／下降 ${Math.round(plan.elevation.descent)} m（未平滑，可能受誤差影響）`:`高度資料不足（涵蓋 ${Math.round(plan.elevation.coverage*100)}% 距離），時間未加上爬升。`));
      if(r.note)out.append(el('p',r.note,'notice'));
      out.append(el('h3','行程分段'));plan.stages.forEach((s,i)=>out.append(btn(`${i+1}. 累計 ${(s.distance/1000).toFixed(2)} km · 查看位置`,()=>{$('plannerDialog').close();ctx.pauseFollow();map.focus(s.point);})));
      profile(r);if(save){const latest=await store.get('routes',r.id);if(!latest)throw Error('路線已不存在。');latest.plan={speed,rest,stage};await store.put('routes',latest);ctx.replaceRoute(latest);ctx.toast('行程設定已儲存，可離線查看。');}
    }catch(e){out.append(el('p',ctx.failure(e),'error-text'));}
  }
  $('calculatePlan').onclick=()=>calculatePlan();
  function profile(r){
    const host=$('elevationProfile');host.replaceChildren();const stats=elevationStats(r.segments);if(stats.coverage===0){host.append(el('p','此路線冇可用高度曲線。'));return;}
    let x=0,min=Infinity,max=-Infinity;const points=[];for(const s of r.segments){const path=[];s.forEach((p,i)=>{if(i)x+=distance(s[i-1],p);path.push([x,Number.isFinite(p[2])?p[2]:null]);if(Number.isFinite(p[2])){min=Math.min(min,p[2]);max=Math.max(max,p[2]);}});points.push(path);}
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 400 150');svg.setAttribute('role','img');svg.setAttribute('aria-label','檔案高度曲線；缺少高度嘅部分留空');
    for(const s of points){let d='',pen=false;for(const p of s){if(p[1]===null){pen=false;continue;}d+=(pen?'L':'M')+(12+p[0]/Math.max(1,r.length)*376)+','+(125-(p[1]-min)/Math.max(1,max-min)*105)+' ';pen=true;}const path=document.createElementNS(ns,'path');path.setAttribute('d',d);path.setAttribute('stroke','#288561');path.setAttribute('stroke-width','2');path.setAttribute('fill','none');svg.append(path);}
    host.append(el('h3','檔案高度曲線'),svg,el('p',`${Math.round(min)}–${Math.round(max)} m · 缺資料處留空；0 高度亦可能係原檔預設值。`));
  }
  const value=(v,unit='')=>typeof v==='number'&&Number.isFinite(v)?Math.round(v*10)/10+unit:'未提供';
  async function renderWeather(){
    const serial=++weatherSerial,r=ctx.getRoute();if(!r)return;const latest=await store.get('routes',r.id);if(serial!==weatherSerial||ctx.getRoute()?.id!==r.id)return;
    const out=$('weatherOutput'),w=latest?.weather;out.replaceChildren();$('weatherName').textContent=r.name;
    if(!w){out.append(el('p','尚未下載天氣。按下方更新，先取得可離線查看嘅預報。'));return;}
    const d=w.data,c=d.current,old=Date.now()-w.fetched>3*3600000;
    out.append(el('p',`${navigator.onLine?'已儲存預報':'離線快照 · 不會更新'}${old?' · 已超過 3 小時，請重新更新':''}`,'notice'),el('p','取得時間：'+new Date(w.fetched).toLocaleString()),el('p',`預報地區：${w.point[1].toFixed(4)}, ${w.point[0].toFixed(4)} · 時區 ${d.timezone||'當地時間'}`),el('h3',value(c.temperature_2m,'°C')+' · 體感 '+value(c.apparent_temperature,'°C')),el('p',`模型時刻 ${c.time.replace('T',' ')} · 風速 ${value(c.wind_speed_10m,' km/h')} · 降水 ${value(c.precipitation,' mm')}`));
    const h=d.hourly,index=h?.time?.findIndex(t=>t>=c.time);if(index>=0)out.append(el('p',`模型積雪深度（${h.time[index].replace('T',' ')}）：${value(h.snow_depth?.[index],' m')}；唔係現場量度。`));
    d.daily.time.forEach((day,i)=>{const card=el('div',undefined,'weather-day');card.append(el('b',day),el('p',`${value(d.daily.temperature_2m_min[i],'°C')} – ${value(d.daily.temperature_2m_max[i],'°C')} · 降雨機率 ${value(d.daily.precipitation_probability_max[i],'%')}`),el('p',`降水 ${value(d.daily.precipitation_sum[i],' mm')} · 最大風速 ${value(d.daily.wind_speed_10m_max[i],' km/h')}`),el('small',`日出 ${d.daily.sunrise[i]?.slice(11,16)||'未提供'} · 日落 ${d.daily.sunset[i]?.slice(11,16)||'未提供'}`));out.append(card);});
  }
  async function openWeather(){if(!ctx.getRoute())return;$('weatherDialog').showModal();try{await renderWeather();}catch(e){warn(e);}}
  $('refreshWeather').onclick=async()=>{
    if(weatherBusy)return;if(!navigator.onLine){ctx.toast('目前離線，只可查看上次預報。');return;}
    const r=ctx.getRoute();if(!r)return;weatherBusy=true;$('refreshWeather').disabled=true;$('refreshWeather').textContent='正在更新…';const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
    try{const point=weatherPoint(r),response=await fetch(weatherURL(point),{signal:controller.signal,credentials:'omit'});if(!response.ok)throw Error('天氣服务回應 '+response.status+'，請稍後重試。');const data=validateWeather(await response.json()),latest=await store.get('routes',r.id);if(!latest)throw Error('路線已不存在。');latest.weather={point,data,fetched:Date.now()};await store.put('routes',latest);ctx.replaceRoute(latest);await renderWeather();ctx.toast('天氣預報已儲存。');}catch(e){ctx.toast('天氣更新失敗，舊資料仍保留。'+(e.name==='AbortError'?'服務逾時。':ctx.failure(e)));}finally{clearTimeout(timer);weatherBusy=false;$('refreshWeather').disabled=false;$('refreshWeather').textContent='同意並更新天氣';}
  };
  window.addEventListener('offline',()=>{if($('weatherDialog').open)renderWeather().catch(warn);});
  function openCustom(){if(ctx.getRoute())$('customDialog').showModal();}
  function startEditor(copy){
    if(!ctx.isReady()){ctx.toast('本機儲存未就緒。');return;}if(draft){ctx.toast('請先完成目前編輯。');return;}
    const r=ctx.getRoute();if(!r){begin([],[]);return;}
    begin(copy?structuredClone(r.segments):[],copy?structuredClone(r.waypoints):[]);
  }
  function begin(segments,marks){draft=segments;waypoints=marks;ctx.pauseFollow();ctx.showMap();map.resize();map.setDraft(draft);$('editorBar').classList.remove('hide');$('draftName').value=ctx.getRoute()?ctx.getRoute().name+' · 自訂':'我的自訂路線';onFix(null);updateDraft();}
  $('startDrawing').onclick=()=>{const lat=$('startLat').value,lon=$('startLon').value,p=[Number(lon),Number(lat)];if(!lat.trim()||!lon.trim()||!validCoordinate(p)){ctx.toast('請輸入有效經緯度（緯度 ±85°）。');return;}$('startDialog').close();begin([],[]);map.focus(p);};
  $('editCopy').onclick=()=>{$('customDialog').close();startEditor(true);};$('drawNew').onclick=()=>{$('customDialog').close();startEditor(false);};
  $('exportGPX').onclick=()=>{const r=ctx.getRoute();if(!r)return;const blob=new Blob([toGPX(r)],{type:'application/gpx+xml'}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=r.name.replace(/[^\p{L}\p{N}_-]/gu,'_')+'.gpx';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);ctx.toast('已建立 GPX，請按瀏覽器提示儲存。');};
  function updateDraft(){const count=draft?.reduce((n,s)=>n+s.length,0)||0,mode=$('snapPaths').checked?'已下載步道路網':'直線模式';$('draftInfo').textContent=`${count} 點 · ${(routeLength(draft||[])/1000).toFixed(2)} km · ${mode}`;$('saveDraft').disabled=count<2;$('undoPoint').disabled=!count;$('reverseDraft').disabled=count<2;map.setDraft(draft);}
  $('snapPaths').onchange=updateDraft;
  $('addPoint').onclick=async()=>{if(!draft)return;const button=$('addPoint'),p=map.centerPoint();if(!validCoordinate(p)){ctx.toast('中心點超出支援範圍。');return;}if(!draft.length)draft.push([]);const segment=draft.at(-1),last=segment.at(-1);if(last&&distance(last,p)<1){ctx.toast('請移動地圖至少 1 m 再加點。');return;}button.disabled=true;button.textContent='正在計算…';try{if(last&&$('snapPaths').checked){try{const result=await routeDownloaded(last,p);segment.push(...result.path.slice(1));ctx.toast(`已沿下載步道加入約 ${Math.round(result.distance)} m。`);}catch(e){segment.push(p);ctx.toast('未能沿已下載步道連接：'+ctx.failure(e)+' 已改用直線；必須核對可通行性。');}}else segment.push(p);updateDraft();}finally{button.disabled=false;button.textContent='＋ 加入中心點';}};
  $('undoPoint').onclick=()=>{if(!draft?.length)return;draft.at(-1).pop();if(!draft.at(-1).length)draft.pop();updateDraft();};
  $('reverseDraft').onclick=()=>{if(!draft)return;draft.reverse().forEach(s=>s.reverse());updateDraft();};
  function finishEditor(){draft=null;waypoints=[];map.setDraft(null);map.setReroute(null);$('editorBar').classList.add('hide');if(!ctx.getRoute())ctx.showRoutes();}
  $('cancelDraft').onclick=finishEditor;
  $('saveDraft').onclick=()=>$('saveDraftDialog').showModal();
  $('confirmDraft').onclick=async()=>{if(!draft)return;$('confirmDraft').disabled=true;try{const r=createCustomRoute($('draftName').value,draft,waypoints);await store.put('routes',r);$('saveDraftDialog').close();draft=null;waypoints=[];map.setDraft(null);$('editorBar').classList.add('hide');await ctx.refresh();await ctx.selectRoute(r.id);ctx.toast('新路線已儲存；請下載其離線底圖。');}catch(e){warn(e);}finally{$('confirmDraft').disabled=false;}};
  document.addEventListener('visibilitychange',()=>{if(document.hidden){deviation={armed:Boolean(deviation.armed)};if(alertSettings.enabled)$('deviationBanner').textContent='回到前景後等候新 GPS 位置。';}});
  return {init,onFix,routeChanged,isEditing:()=>draft!==null};
}
