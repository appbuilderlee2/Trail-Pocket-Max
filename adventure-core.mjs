import {distance,routeLength,validCoordinate,boundsOf} from './core.mjs';

export function elevationStats(segments){
  let total=0,known=0,ascent=0,descent=0;
  for(const s of segments)for(let i=1;i<s.length;i++){
    const a=s[i-1],b=s[i],d=distance(a,b);total+=d;
    if(Number.isFinite(a[2])&&Number.isFinite(b[2])){known+=d;const delta=b[2]-a[2];ascent+=Math.max(0,delta);descent+=Math.max(0,-delta);}
  }
  return {ascent,descent,coverage:total?known/total:0,complete:total>0&&known/total>.999};
}
export function planRoute(segments,speed=3,rest=20,stageKm=2){
  if(!Number.isFinite(speed)||speed<1||speed>8||!Number.isFinite(rest)||rest<0||rest>600||!Number.isFinite(stageKm)||stageKm<.5||stageKm>20)throw Error('請輸入有效步速、休息時間及分段距離。');
  const length=routeLength(segments),elevation=elevationStats(segments);
  if(Math.ceil(length/(stageKm*1000))>500)throw Error('分段超過 500 段，請增加每段距離或先分拆路線。');
  const minutes=length/1000/speed*60+(elevation.complete?elevation.ascent/600*60:0)+rest;
  const stages=[];let travelled=0,next=stageKm*1000;
  for(const s of segments)for(let i=1;i<s.length;i++){
    const a=s[i-1],b=s[i],d=distance(a,b);
    while(d>0&&next<=travelled+d){const t=(next-travelled)/d;stages.push({distance:next,point:[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]});next+=stageKm*1000;}
    travelled+=d;
  }
  if(!stages.length||Math.abs(stages.at(-1).distance-length)>1)stages.push({distance:length,point:segments.at(-1).at(-1)});
  return {length,elevation,minutes,stages};
}
export function createCustomRoute(name,segments,waypoints=[]){
  name=name.trim();if(!name)throw Error('請輸入路線名稱。');
  if(!segments.length||segments.some(s=>s.length<2)||segments.flat().some(p=>!validCoordinate(p)))throw Error('每段至少需要兩個有效座標點。');
  const count=segments.reduce((n,s)=>n+s.length,0);if(count>100000)throw Error('座標超過 100,000 點。');
  const bounds=boundsOf(segments);if(bounds.east-bounds.west>180)throw Error('暫未支援跨國際換日線路線。');
  if(routeLength(segments)<1)throw Error('請加入不同位置嘅點，路線至少長 1 m。');
  return {id:crypto.randomUUID(),name:name.slice(0,160),segments:structuredClone(segments),waypoints:structuredClone(waypoints),created:Date.now(),length:routeLength(segments),count,buffer:1000,sourceName:'Trail Pocket 自訂路線',note:'手動畫線只連接所選座標，唔會自動沿步道吸附；未驗證可通行性。請逐段對照官方地圖及現場路牌。'};
}
const xml=s=>String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
export function toGPX(route){
  const point=(p,tag)=>`<${tag} lat="${p[1]}" lon="${p[0]}">${Number.isFinite(p[2])?`<ele>${p[2]}</ele>`:''}`;
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Trail Pocket" xmlns="http://www.topografix.com/GPX/1/1">${route.waypoints.map(w=>point(w.point,'wpt')+`<name>${xml(w.name)}</name></wpt>`).join('')}<trk><name>${xml(route.name)}</name>${route.segments.map(s=>'<trkseg>'+s.map(p=>point(p,'trkpt')+'</trkpt>').join('')+'</trkseg>').join('')}</trk></gpx>`;
}
// Three distinct, fresh fixes over >=10s. GPS uncertainty must lie beyond threshold.
export function advanceDeviation(previous={},sample,threshold=100,now=Date.now()){
  const state={count:0,since:0,active:false,lastTimestamp:0,lastNotify:0,armed:true,...previous};
  const {distance:d,accuracy:a,timestamp:t}=sample||{};
  if(![d,a,t].every(Number.isFinite)||a<0||a>Math.min(50,threshold/2)||now-t>20000||t>now+2000){return {...state,count:0,since:0,status:'uncertain',notify:false};}
  if(t<=state.lastTimestamp)return {...state,notify:false};
  if(state.lastTimestamp&&t-state.lastTimestamp>20000){state.count=0;state.since=0;}
  state.lastTimestamp=t;
  if(!state.armed){if(d-a<=Math.max(300,threshold*2))state.armed=true;else return {...state,count:0,since:0,status:'not-started',notify:false};}
  if(d+a<threshold*.6)return {...state,count:0,since:0,active:false,status:'on-route',notify:false};
  if(d-a<=threshold)return {...state,count:0,since:0,status:state.active?'off-route':'checking',notify:false};
  state.count++;if(state.count===1)state.since=t;
  const active=state.active||(state.count>=3&&t-state.since>=10000);
  const notify=active&&(!state.lastNotify||now-state.lastNotify>=60000);
  return {...state,active,status:active?'off-route':'checking',notify,lastNotify:notify?now:state.lastNotify};
}
export function weatherPoint(route){let remaining=routeLength(route.segments)/2;for(const s of route.segments)for(let i=1;i<s.length;i++){const a=s[i-1],b=s[i],d=distance(a,b);if(d&&remaining<=d){const t=remaining/d;return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];}remaining-=d;}return route.segments[0][0];}
export function weatherURL(point){
  const u=new URL('https://api.open-meteo.com/v1/forecast');
  u.search=new URLSearchParams({latitude:point[1].toFixed(4),longitude:point[0].toFixed(4),current:'temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m',daily:'temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,sunrise,sunset',hourly:'snow_depth',timezone:'auto',forecast_days:'3'});
  return u;
}
export function validateWeather(data){
  if(!data?.current||!data?.daily||!Array.isArray(data.daily.time)||!data.daily.time.length||typeof data.current.time!=='string')throw Error('天氣服務未傳回有效資料。');
  for(const key of ['temperature_2m_max','temperature_2m_min','precipitation_probability_max','precipitation_sum','wind_speed_10m_max','sunrise','sunset'])if(!Array.isArray(data.daily[key])||data.daily[key].length!==data.daily.time.length)throw Error('天氣預報資料不完整。');
  return data;
}
