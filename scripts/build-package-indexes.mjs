import { createReadStream, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { isWalkable, walkingCost } from '../package-index-core.mjs';

const [input, searchOutput, graphOutput] = process.argv.slice(2);
if (!input || !searchOutput || !graphOutput) throw Error('usage: build-package-indexes input.geojsonseq search.index routing.graph');
const poiTags = new Set(['parking','toilets','drinking_water','shelter','camp_site','viewpoint','information','trailhead','peak']);
const categoryName={parking:'停車場',toilets:'洗手間',drinking_water:'飲用水',shelter:'避雨亭',camp_site:'營地',viewpoint:'觀景點',information:'資訊牌',trailhead:'行山入口',peak:'山峰'};
const nodes=[], edges=[], nodeIds=new Map(), search=[];
const radians = n => n*Math.PI/180;
function distance(a,b){const dLat=radians(b[1]-a[1]),dLon=radians(b[0]-a[0]),x=Math.sin(dLat/2)**2+Math.cos(radians(a[1]))*Math.cos(radians(b[1]))*Math.sin(dLon/2)**2;return 12742000*Math.asin(Math.sqrt(x));}
function nodeId(p){const key=`${p[0].toFixed(5)},${p[1].toFixed(5)}`;if(!nodeIds.has(key)){nodeIds.set(key,nodes.length);nodes.push([+p[0].toFixed(6),+p[1].toFixed(6)]);}return nodeIds.get(key);}
function center(geometry){if(!geometry)return null;let p=geometry.coordinates;while(Array.isArray(p?.[0]?.[0]))p=p.flat();if(!Array.isArray(p?.[0]))return Array.isArray(p)&&Number.isFinite(p[0])?p:null;return p[Math.floor(p.length/2)];}
function tags(feature){return feature.properties?.tags || feature.properties || {};}
for await (let line of createInterface({input:createReadStream(input),crlfDelay:Infinity})) {
  line=line.replace(/^\x1e/,'').trim(); if(!line)continue;
  const feature=JSON.parse(line), t=tags(feature), p=center(feature.geometry), name=t['name:zh']||t['name:en']||t.name;
  const kind=t.amenity||t.tourism||t.information||t.natural||t.highway||t.place||t.leisure, display=name||categoryName[kind];
  if(p&&display&&(kind||t.boundary)) search.push({n:display,e:t['name:en']||'',z:t['name:zh']||'',p:[+p[0].toFixed(6),+p[1].toFixed(6)],t:poiTags.has(kind)?kind:(t.place||'place')});
  if(feature.geometry?.type==='LineString'&&isWalkable(t)) {
    const points=feature.geometry.coordinates;
    for(let i=1;i<points.length;i++){const d=distance(points[i-1],points[i]);if(d>0&&d<5000){const a=nodeId(points[i-1]),b=nodeId(points[i]),w=Math.round(d*walkingCost(t));edges.push([a,b,w],[b,a,w]);}}
  }
}
const write=(path,value)=>new Promise((resolve,reject)=>{const out=createWriteStream(path);out.on('error',reject);out.on('finish',resolve);out.end(JSON.stringify(value));});
await write(searchOutput,{version:1,entries:search});
await write(graphOutput,{version:1,nodes,edges});
console.log(JSON.stringify({search:search.length,nodes:nodes.length,edges:edges.length}));
