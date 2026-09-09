const TERRAIN_ROOT='https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
export const TERRAIN_INTERVAL=20;
export const TERRAIN_ZOOM=12;

function tilePoint(lon,lat,z){
  const n=2**z,r=Math.max(-85,Math.min(85,lat))*Math.PI/180;
  return [Math.floor((lon+180)/360*n),Math.floor((1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*n)];
}
export function terrainTiles(bounds,z=TERRAIN_ZOOM){
  if(!bounds||![bounds.west,bounds.east,bounds.south,bounds.north].every(Number.isFinite)||bounds.east<=bounds.west||bounds.north<=bounds.south||bounds.west< -180||bounds.east>180||bounds.south< -85||bounds.north>85)throw Error('等高線範圍無效。');
  const n=2**z,[west,north]=tilePoint(bounds.west,bounds.north,z),[east,south]=tilePoint(bounds.east,bounds.south,z),tiles=[];
  for(let y=Math.max(0,north);y<=Math.min(n-1,south);y++)for(let x=Math.max(0,west);x<=Math.min(n-1,east);x++)tiles.push({z,x,y,url:`${TERRAIN_ROOT}/${z}/${x}/${y}.png`});
  if(!tiles.length||tiles.length>80)throw Error('等高線範圍需要太多資料，請縮小範圍。');
  return tiles;
}
export function terrainZoom(bounds,preferred=TERRAIN_ZOOM){for(let z=preferred;z>=10;z--){try{terrainTiles(bounds,z);return z;}catch(e){if(!String(e.message).includes('太多資料'))throw e;}}throw Error('等高線範圍需要太多資料，請縮小範圍。');}
export const terrariumElevation=(r,g,b)=>r*256+g+b/256-32768;

function lonLat(x,y,z){const n=256*2**z;return [x/n*360-180,Math.atan(Math.sinh(Math.PI*(1-2*y/n)))*180/Math.PI];}
const key=p=>p[0].toFixed(4)+','+p[1].toFixed(4);
function stitch(segments){
  const links=new Map(),used=new Uint8Array(segments.length);
  segments.forEach((s,i)=>s.forEach(p=>{const k=key(p),a=links.get(k)||[];a.push(i);links.set(k,a);}));
  const extend=(path,front)=>{while(true){const p=front?path[0]:path.at(-1),next=(links.get(key(p))||[]).find(i=>!used[i]);if(next===undefined)break;used[next]=1;const s=segments[next],q=key(s[0])===key(p)?s[1]:s[0];front?path.unshift(q):path.push(q);}};
  const paths=[];for(let i=0;i<segments.length;i++){if(used[i])continue;used[i]=1;const path=[segments[i][0],segments[i][1]];extend(path,false);extend(path,true);paths.push(path);}return paths;
}
export function contoursFromSamples(samples,width,height,{originX=0,originY=0,stride=2,z=TERRAIN_ZOOM,interval=TERRAIN_INTERVAL}={}){
  if(!(samples instanceof Float32Array)||samples.length!==width*height||width<2||height<2||interval<=0)throw Error('高程資料無效。');
  const groups=new Map(),cross=(x1,y1,v1,x2,y2,v2,level)=>{const t=v1===v2?.5:(level-v1)/(v2-v1);return [originX+(x1+(x2-x1)*t)*stride,originY+(y1+(y2-y1)*t)*stride];};
  for(let y=0;y<height-1;y++)for(let x=0;x<width-1;x++){
    const a=samples[y*width+x],b=samples[y*width+x+1],c=samples[(y+1)*width+x+1],d=samples[(y+1)*width+x];if(![a,b,c,d].every(Number.isFinite))continue;
    const lo=Math.ceil(Math.min(a,b,c,d)/interval)*interval,hi=Math.floor(Math.max(a,b,c,d)/interval)*interval;
    for(let level=lo;level<=hi;level+=interval){const pts=[],edge=(x1,y1,v1,x2,y2,v2)=>{if((v1<level&&v2>=level)||(v2<level&&v1>=level))pts.push(cross(x1,y1,v1,x2,y2,v2,level));};edge(x,y,a,x+1,y,b);edge(x+1,y,b,x+1,y+1,c);edge(x+1,y+1,c,x,y+1,d);edge(x,y+1,d,x,y,a);if(pts.length===2){const s=groups.get(level)||[];s.push(pts);groups.set(level,s);}else if(pts.length===4){const s=groups.get(level)||[],center=(a+b+c+d)/4;if(center>=level)s.push([pts[0],pts[3]],[pts[1],pts[2]]);else s.push([pts[0],pts[1]],[pts[2],pts[3]]);groups.set(level,s);}}
  }
  return [...groups].sort((a,b)=>a[0]-b[0]).map(([elevation,segments])=>({elevation,paths:stitch(segments).map(path=>path.map(p=>lonLat(p[0],p[1],z)).map(p=>p.map(v=>Number(v.toFixed(6)))))}));
}

async function bitmapFrom(blob){
  if(typeof createImageBitmap==='function')return createImageBitmap(blob);
  const url=URL.createObjectURL(blob),image=new Image();try{await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('未能讀取高程圖塊。'));image.src=url;});return image;}finally{URL.revokeObjectURL(url);}
}
export async function downloadContours(bounds,{signal,onProgress=()=>{},fetcher=fetch,z=TERRAIN_ZOOM,interval=TERRAIN_INTERVAL}={}){
  z=terrainZoom(bounds,z);const tiles=terrainTiles(bounds,z),minX=Math.min(...tiles.map(t=>t.x)),maxX=Math.max(...tiles.map(t=>t.x)),minY=Math.min(...tiles.map(t=>t.y)),maxY=Math.max(...tiles.map(t=>t.y)),sample=2,side=256/sample,width=(maxX-minX+1)*side,height=(maxY-minY+1)*side,values=new Float32Array(width*height);let bytes=0,done=0;
  for(const tile of tiles){if(signal?.aborted)throw Error('下載已取消。');const response=await fetcher(tile.url,{credentials:'omit',signal});if(!response.ok)throw Error('高程服務回應 '+response.status+'。');const blob=await response.blob();bytes+=blob.size;const bitmap=await bitmapFrom(blob),canvas=typeof OffscreenCanvas==='function'?new OffscreenCanvas(256,256):Object.assign(document.createElement('canvas'),{width:256,height:256}),ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0,256,256);const pixels=ctx.getImageData(0,0,256,256).data;bitmap.close?.();const ox=(tile.x-minX)*side,oy=(tile.y-minY)*side;for(let sy=0;sy<side;sy++)for(let sx=0;sx<side;sx++){const i=((sy*sample)*256+sx*sample)*4;values[(oy+sy)*width+ox+sx]=terrariumElevation(pixels[i],pixels[i+1],pixels[i+2]);}done++;onProgress({done,total:tiles.length,bytes});}
  const contours=contoursFromSamples(values,width,height,{originX:minX*256,originY:minY*256,stride:sample,z,interval});return {contours,bytes,terrain:{source:'Mapzen Terrain Tiles / AWS Open Data',zoom:z,interval}};
}
