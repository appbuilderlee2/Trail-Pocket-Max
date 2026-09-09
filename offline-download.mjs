import {areaKm2,mapQuery} from './core.mjs';

export const MAX_AREA_KM2=500;
export const CHUNK_AREA_KM2=100;
export const RESPONSE_LIMIT_BYTES=32*1024*1024;
export const PACKAGE_LIMIT_BYTES=128*1024*1024;
export const OVERPASS_ENDPOINTS=['https://overpass.kumi.systems/api/interpreter','https://overpass-api.de/api/interpreter'];

export function splitBounds(bounds,maxArea=CHUNK_AREA_KM2){
  if(!bounds||!Object.values(bounds).every(Number.isFinite)||bounds.west>=bounds.east||bounds.south>=bounds.north)throw Error(`地圖範圍過大或無效；每張離線地圖最多 ${MAX_AREA_KM2} km²。`);const area=areaKm2(bounds);
  if(area<=0||area>MAX_AREA_KM2)throw Error(`地圖範圍過大或無效；每張離線地圖最多 ${MAX_AREA_KM2} km²。`);
  const width=Math.max(.000001,Math.abs(bounds.east-bounds.west)*Math.cos((bounds.north+bounds.south)*Math.PI/360)),height=Math.max(.000001,Math.abs(bounds.north-bounds.south));
  const count=Math.max(1,Math.ceil(area/maxArea)),cols=Math.max(1,Math.ceil(Math.sqrt(count*width/height))),rows=Math.max(1,Math.ceil(count/cols)),parts=[];
  for(let row=0;row<rows;row++)for(let col=0;col<cols;col++)parts.push({west:bounds.west+(bounds.east-bounds.west)*col/cols,east:bounds.west+(bounds.east-bounds.west)*(col+1)/cols,south:bounds.south+(bounds.north-bounds.south)*row/rows,north:bounds.south+(bounds.north-bounds.south)*(row+1)/rows});
  if(parts.some(part=>areaKm2(part)>maxArea*1.02))throw Error('未能安全分割下載範圍，請稍為縮小。');
  return parts;
}

export function mergeMapChunks(chunks){
  const elements=[],seen=new Set();
  for(const chunk of chunks)for(const element of chunk?.elements||[]){const id=`${element.type}:${element.id}`;if(seen.has(id))continue;seen.add(id);elements.push(element);}
  if(!elements.length)throw Error('所選範圍未取得任何道路、步道或地標，未標示為下載完成。');
  return {version:.6,generator:'Trail Pocket offline merge',elements};
}

export async function readLimitedJson(response,{signal,limit=RESPONSE_LIMIT_BYTES,onBytes=()=>{}}={}){
  if(!response.ok)throw Error('地圖服務回應 '+response.status+'。');
  if(Number(response.headers.get('content-length'))>limit)throw Error('其中一區地圖資料超過 32 MB，請縮小範圍。');
  if(!response.body){const text=await response.text();if(new Blob([text]).size>limit)throw Error('其中一區地圖資料超過 32 MB。');return JSON.parse(text);}
  const reader=response.body.getReader(),decoder=new TextDecoder();let size=0,text='';
  while(true){if(signal?.aborted){await reader.cancel();throw Error('下載已取消。');}const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>limit){await reader.cancel();throw Error('其中一區地圖資料超過 32 MB，請縮小範圍。');}text+=decoder.decode(chunk.value,{stream:true});onBytes(size);}
  return JSON.parse(text+decoder.decode());
}

function validChunk(data){if(!data||!Array.isArray(data.elements)||data.elements.some(e=>!e||typeof e!=='object'))throw Error('伺服器未傳回有效地圖。');if(data.remark)throw Error('地圖服務未能完成此分區。');return data;}

export async function downloadOsmInChunks(bounds,{signal,fetcher=fetch,onProgress=()=>{}}={}){
  const parts=splitBounds(bounds),chunks=[];let transferred=0;
  for(let index=0;index<parts.length;index++){
    if(signal?.aborted)throw Error('下載已取消。');let result,lastError;
    for(let endpointIndex=0;endpointIndex<OVERPASS_ENDPOINTS.length;endpointIndex++){
      const attempt=new AbortController(),relay=()=>attempt.abort(signal?.reason),timer=setTimeout(()=>attempt.abort('endpoint-timeout'),75000);signal?.addEventListener('abort',relay,{once:true});
      try{onProgress({phase:'map',index:index+1,total:parts.length,endpoint:endpointIndex+1,transferred});const response=await fetcher(OVERPASS_ENDPOINTS[endpointIndex],{method:'POST',body:new URLSearchParams({data:mapQuery(parts[index])}),credentials:'omit',signal:attempt.signal});result=validChunk(await readLimitedJson(response,{signal:attempt.signal,onBytes:size=>onProgress({phase:'map',index:index+1,total:parts.length,endpoint:endpointIndex+1,transferred:transferred+size})}));break;}
      catch(error){lastError=error;if(signal?.aborted)throw error;}finally{clearTimeout(timer);signal?.removeEventListener('abort',relay);}
    }
    if(!result)throw lastError||Error('未能取得地圖分區。');chunks.push(result);transferred+=new Blob([JSON.stringify(result)]).size;if(transferred>PACKAGE_LIMIT_BYTES)throw Error('地圖資料已超過 128 MB，請縮小範圍。');
  }
  return {data:mergeMapChunks(chunks),parts:parts.length,transferred};
}

export async function assertStorageRoom(bytes,storage=globalThis.navigator?.storage){
  if(!storage?.estimate)return true;const estimate=await storage.estimate(),free=Number(estimate.quota||0)-Number(estimate.usage||0),needed=Math.ceil(bytes*1.25+8*1024*1024);
  if(estimate.quota&&free<needed)throw Error(`裝置可用網站空間不足；需要約 ${Math.ceil(needed/1048576)} MB，請先刪除舊地圖或釋放空間。`);return true;
}
