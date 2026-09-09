import {buildSearchIndex} from './offline-search.mjs';
import {buildRoutingGraph} from './routing-core.mjs';
export function buildOfflinePackage(data){const searchIndex=buildSearchIndex(data?.elements),routingGraph=buildRoutingGraph(data?.elements);return{searchIndex,routingGraph,packageVersion:3,stats:{searchEntries:searchIndex.length,routingNodes:routingGraph.nodes.length,routingEdges:routingGraph.edges.length}};}
