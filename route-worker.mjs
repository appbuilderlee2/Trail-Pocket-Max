import {routeAStar} from './routing-core.mjs';
const graphs=new Map();
self.onmessage=e=>{const{id,graphId,graph,start,end,options}=e.data||{};try{if(graph)graphs.set(graphId,graph);const selected=graphs.get(graphId);if(!selected)throw Error('已下載步道路網未載入。');self.postMessage({id,ok:true,result:routeAStar(selected,start,end,options)});}catch(error){self.postMessage({id,ok:false,error:error?.message||'未能計算步道路線。'});}};
