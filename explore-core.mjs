import {R,unproject,areaKm2} from './core.mjs';
import {MAX_AREA_KM2} from './offline-download.mjs';
export const WORLD=2*Math.PI*R;
export function viewportBounds(center,units,width,height,inset=.0){
  const a=unproject([center[0]-width*units*(.5-inset),center[1]-height*units*(.5-inset)]),b=unproject([center[0]+width*units*(.5-inset),center[1]+height*units*(.5-inset)]);
  return {west:Math.max(-180,a[0]),east:Math.min(180,b[0]),north:Math.min(85,a[1]),south:Math.max(-85,b[1])};
}
export function overlaps(a,b){return a.west<b.east&&a.east>b.west&&a.south<b.north&&a.north>b.south;}
export function contains(a,b){return a.west<=b.west&&a.east>=b.east&&a.south<=b.south&&a.north>=b.north;}
export function validateArea(b){if(!b||!Object.values(b).every(Number.isFinite)||b.west>=b.east||b.south>=b.north||b.west< -180||b.east>180||b.south< -85||b.north>85)throw Error('所選範圍無效，請移到地圖內。');const size=areaKm2(b);if(size>MAX_AREA_KM2)throw Error(`範圍超過 ${MAX_AREA_KM2} km²，請放大地圖再選取。`);if(size<.001)throw Error('範圍太細，請縮小地圖少少。');return size;}
export function placeSearchURL(value){const q=String(value||'').trim();if(q.length<2||q.length>120)throw Error('請輸入 2 至 120 個字的地名。');const url=new URL('https://nominatim.openstreetmap.org/search');url.search=new URLSearchParams({q,format:'jsonv2',limit:'5','accept-language':'zh-Hant,en'});return url;}
export function parsePlaceResults(value){if(!Array.isArray(value))throw Error('地名搜尋結果格式不正確。');return value.filter(x=>x&&typeof x.display_name==='string'&&Number.isFinite(Number(x.lon))&&Number.isFinite(Number(x.lat))&&Math.abs(Number(x.lon))<=180&&Math.abs(Number(x.lat))<=85).slice(0,5).map(x=>({name:x.display_name.trim(),point:[Number(x.lon),Number(x.lat)]})).filter(x=>x.name);}
export function visibleTiles(center,units,width,height){
  const z=Math.max(0,Math.min(19,Math.round(Math.log2(WORLD/(256*units))))),count=2**z,span=WORLD/count;
  const left=center[0]-width*units/2,top=center[1]-height*units/2;
  const minX=Math.max(0,Math.floor((left+WORLD/2)/span)),maxX=Math.min(count-1,Math.floor((left+width*units+WORLD/2)/span));
  const minY=Math.max(0,Math.floor((top+WORLD/2)/span)),maxY=Math.min(count-1,Math.floor((top+height*units+WORLD/2)/span)),result=[];
  for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++)result.push({key:`${z}/${x}/${y}`,z,x,y,left:(x*span-WORLD/2-left)/units,top:(y*span-WORLD/2-top)/units,size:span/units});
  return result;
}
