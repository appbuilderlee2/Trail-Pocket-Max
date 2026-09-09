import {distance,validCoordinate} from './core.mjs';

export function boundsContainPoint(bounds,point){return Boolean(bounds&&validCoordinate(point)&&point[0]>=bounds.west&&point[0]<=bounds.east&&point[1]>=bounds.south&&point[1]<=bounds.north);}

export function chooseRoutingRecord(records,start,end){return (records||[]).filter(r=>r?.packageVersion>=2&&r.routingGraph?.nodes?.length&&boundsContainPoint(r.bounds,start)&&boundsContainPoint(r.bounds,end)).sort((a,b)=>a.routingGraph.nodes.length-b.routingGraph.nodes.length)[0]||null;}

export function closestRoutePoint(segments,point){let best=null,metres=Infinity;for(const segment of segments||[])for(const p of segment){const d=distance(point,p);if(d<metres){best=p;metres=d;}}return best?{point:[best[0],best[1]],distance:metres}:null;}
