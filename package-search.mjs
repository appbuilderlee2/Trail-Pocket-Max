import { distance } from './core.mjs';
import { normalizeSearch } from './offline-search.mjs';

const labels={parking:'停車場 泊車 parking carpark',toilets:'洗手間 廁所 toilets wc',drinking_water:'飲用水 水源 drinking water',shelter:'避雨亭 shelter',camp_site:'營地 camping campsite',viewpoint:'觀景點 lookout viewpoint',information:'資訊牌 information',trailhead:'行山入口 trailhead',peak:'山峰 山頂 peak summit',place:'地方 地名 place'};
const kind={parking:'停車場',toilets:'洗手間',drinking_water:'飲用水',shelter:'避雨亭',camp_site:'營地',viewpoint:'觀景點',information:'資訊',trailhead:'行山入口',peak:'山峰',place:'地名'};
function editDistance(a,b,limit=2){if(Math.abs(a.length-b.length)>limit)return limit+1;let last=[...Array(b.length+1).keys()];for(let i=1;i<=a.length;i++){const row=[i];let best=i;for(let j=1;j<=b.length;j++){row[j]=Math.min(row[j-1]+1,last[j]+1,last[j-1]+(a[i-1]===b[j-1]?0:1));best=Math.min(best,row[j]);}if(best>limit)return limit+1;last=row;}return last[b.length];}
export function searchPackageEntries(sources,query,center=null,limit=30){
  const q=normalizeSearch(query);if(q.length<2)throw Error('請輸入至少 2 個字搜尋。');const words=q.split(' '),found=[],seen=new Set();
  for(const source of sources)for(const e of source.entries||[]){const key=normalizeSearch([e.n,e.e,e.z,labels[e.t]].filter(Boolean).join(' ')),tokens=key.split(' '),match=words.every(w=>key.includes(w)||tokens.some(t=>t.startsWith(w)||editDistance(t,w)<=2));if(!match)continue;const unique=`${normalizeSearch(e.n)}|${e.p.join(',')}`;if(seen.has(unique))continue;seen.add(unique);const metres=center?distance(center,e.p):0,score=(key.startsWith(q)?0:key.includes(q)?5:20)+(center?Math.min(500,metres/1000):0);found.push({name:e.n,point:e.p,kind:kind[e.t]||'地名',source:source.name,metres,score});}
  return found.sort((a,b)=>a.score-b.score||a.name.localeCompare(b.name)).slice(0,limit);
}
