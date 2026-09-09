const key=p=>`${p[0].toFixed(5)},${p[1].toFixed(5)}`;
export function mergePackageGraphs(graphs){
  const nodes=[],lookup=new Map(),edgeWeights=new Map();
  const node=p=>{const k=key(p);if(!lookup.has(k)){lookup.set(k,nodes.length);nodes.push(p);}return lookup.get(k)};
  for(const graph of graphs){if(!graph||graph.version!==1||!Array.isArray(graph.nodes)||!Array.isArray(graph.edges))throw Error('步道路網格式無效');const ids=graph.nodes.map(node);for(const [a,b,w] of graph.edges)if(ids[a]!==undefined&&ids[b]!==undefined&&Number.isFinite(w)&&w>0){const k=`${ids[a]}:${ids[b]}`,previous=edgeWeights.get(k);if(previous===undefined||w<previous)edgeWeights.set(k,w);}}
  const edges=[...edgeWeights].map(([pair,w])=>{const [a,b]=pair.split(':').map(Number);return [a,b,w];});
  return {version:1,nodes,edges};
}
