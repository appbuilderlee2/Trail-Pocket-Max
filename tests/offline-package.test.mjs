import test from 'node:test';
import assert from 'node:assert/strict';
import {buildOfflinePackage} from '../offline-package.mjs';
import {searchOffline} from '../offline-search.mjs';
import {routeAStar} from '../routing-core.mjs';
import {boundsContainPoint,chooseRoutingRecord,closestRoutePoint} from '../routing-client.mjs';

const data={elements:[
  {type:'node',id:1,lon:138,lat:-34,tags:{natural:'peak',name:'Mount Test'}},
  {type:'node',id:2,lon:138.001,lat:-34,tags:{amenity:'toilets',name:'Picnic Toilets'}},
  {type:'way',id:10,tags:{highway:'path',name:'Creek Walk'},geometry:[{lon:138,lat:-34},{lon:138.001,lat:-34},{lon:138.002,lat:-34}]},
  {type:'way',id:11,tags:{highway:'footway'},geometry:[{lon:138.001,lat:-34},{lon:138.001,lat:-34.001},{lon:138.002,lat:-34.001}]},
  {type:'way',id:12,tags:{highway:'path',access:'private'},geometry:[{lon:138,lat:-34},{lon:138.002,lat:-34.001}]}
]};

test('offline package creates compact search and walkable routing data',()=>{const p=buildOfflinePackage(data);assert.equal(p.packageVersion,3);assert.ok(p.searchIndex.length>=3);assert.equal(searchOffline([{name:'Test area',index:p.searchIndex}],'mount')[0].kind,'山峰');assert.equal(searchOffline([{name:'Test area',index:p.searchIndex}],'toilets')[0].source,'Test area');assert.equal(searchOffline([{name:'Test area',index:p.searchIndex}],'廁所')[0].kind,'洗手間');assert.equal(p.routingGraph.nodes.length,5);assert.equal(p.routingGraph.edges.length,8);});

test('A* follows downloaded paths and rejects locations outside the graph',()=>{const graph=buildOfflinePackage(data).routingGraph,result=routeAStar(graph,[138,-34],[138.002,-34.001]);assert.ok(result.path.length>=4);assert.ok(result.distance>200&&result.distance<400);assert.throws(()=>routeAStar(graph,[139,-35],[138.002,-34.001]),/400 m/);});

test('routing selection never crosses an undownloaded or separate area',()=>{const graph=buildOfflinePackage(data).routingGraph,small={id:'small',packageVersion:2,bounds:{west:137.99,east:138.01,south:-34.01,north:-33.99},routingGraph:graph},other={id:'other',packageVersion:2,bounds:{west:140,east:141,south:-35,north:-34},routingGraph:graph};assert.ok(boundsContainPoint(small.bounds,[138,-34]));assert.equal(chooseRoutingRecord([other,small],[138,-34],[138.002,-34])?.id,'small');assert.equal(chooseRoutingRecord([other,small],[138,-34],[140.5,-34.5]),null);const closest=closestRoutePoint([[[138,-34],[138.003,-34]]],[138.0029,-34]);assert.deepEqual(closest.point,[138.003,-34]);});
