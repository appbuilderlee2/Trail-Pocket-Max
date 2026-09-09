const WALKABLE=new Set(['path','footway','track','steps','bridleway','pedestrian','living_street','residential','service','unclassified','tertiary']);
const RESTRICTED=new Set(['private','no','customers','permit','agricultural','forestry']);

export function isWalkable(tags={}){
  if(!WALKABLE.has(tags.highway)||RESTRICTED.has(tags.access)||tags.foot==='no')return false;
  if(tags.highway==='service'&&['driveway','parking_aisle'].includes(tags.service)&&!['yes','designated','permissive'].includes(tags.foot))return false;
  return true;
}

export function walkingCost(tags={}){
  if(['path','footway','pedestrian'].includes(tags.highway))return tags.route==='hiking'?0.9:1;
  if(tags.highway==='track')return 1.1;
  if(tags.highway==='steps')return 1.25;
  if(['residential','living_street','unclassified'].includes(tags.highway))return 1.3;
  if(tags.highway==='tertiary')return 1.55;
  return 1.4;
}
