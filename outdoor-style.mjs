const layersFor = source => [
  {id:`${source}-landcover`,type:'fill',source,'source-layer':'landcover',paint:{'fill-color':['match',['get','class'],'wood','#d7e7c9','grass','#e7eed7','sand','#f1e7cc','#ececdf'],'fill-opacity':0.92}},
  {id:`${source}-landuse`,type:'fill',source,'source-layer':'landuse',paint:{'fill-color':['match',['get','class'],'park','#cfe3ad','cemetery','#dce7d2','hospital','#eee1da','school','#f2edc8','#ebece2'],'fill-opacity':0.82}},
  {id:`${source}-water`,type:'fill',source,'source-layer':'water',paint:{'fill-color':'#b9dce8'}},
  {id:`${source}-waterway`,type:'line',source,'source-layer':'waterway',paint:{'line-color':'#8fc6d6','line-width':['interpolate',['linear'],['zoom'],9,0.7,15,2]}},
  {id:`${source}-buildings`,type:'fill',source,'source-layer':'building',minzoom:13,paint:{'fill-color':'#d3d0c5','fill-outline-color':'#bbb7aa','fill-opacity':0.96}},
  {id:`${source}-road-case`,type:'line',source,'source-layer':'transportation',filter:['!',['in',['get','class'],['literal',['path','track']]]],paint:{'line-color':['match',['get','class'],'motorway','#e29b32','trunk','#e7aa43','primary','#dbc383','#cbc8bd'],'line-width':['interpolate',['linear'],['zoom'],7,1.4,12,3.2,16,8.5]}},
  {id:`${source}-roads`,type:'line',source,'source-layer':'transportation',filter:['!',['in',['get','class'],['literal',['path','track']]]],paint:{'line-color':['match',['get','class'],'motorway','#ffc34d','trunk','#ffd06b','primary','#ffe29a','secondary','#fff3c7','#fffdf7'],'line-width':['interpolate',['linear'],['zoom'],7,0.8,12,2.2,16,6.2]}},
  {id:`${source}-trails`,type:'line',source,'source-layer':'transportation',filter:['in',['get','class'],['literal',['path','track']]],paint:{'line-color':['match',['get','class'],'track','#8c704f','#4e7b52'],'line-width':['interpolate',['linear'],['zoom'],10,0.8,14,1.4,17,2.5],'line-dasharray':[2,1.7]}},
  {id:`${source}-road-labels`,type:'symbol',source,'source-layer':'transportation_name',minzoom:12,layout:{'symbol-placement':'line','text-field':['coalesce',['get','name:zh'],['get','name:en'],['get','name']],'text-size':['interpolate',['linear'],['zoom'],12,10,17,13],'text-letter-spacing':0.01,'text-max-angle':35,'text-padding':4},paint:{'text-color':'#3c4039','text-halo-color':'#fbfbf4','text-halo-width':1.6}},
  {id:`${source}-boundaries`,type:'line',source,'source-layer':'boundary',paint:{'line-color':'#819678','line-width':['interpolate',['linear'],['zoom'],7,0.7,15,1.3],'line-dasharray':[4,3]}},
  {id:`${source}-parking`,type:'symbol',source,'source-layer':'poi',minzoom:15,filter:['all',['has','name'],['any',['==',['get','class'],'parking'],['==',['get','subclass'],'parking']]],layout:{'text-field':'P','text-size':12,'text-font':['Noto Sans Regular'],'text-allow-overlap':false,'text-padding':5},paint:{'text-color':'#2373a8','text-halo-color':'#f7f8f1','text-halo-width':2}},
  {id:`${source}-poi-label`,type:'symbol',source,'source-layer':'poi',minzoom:15,filter:['has','name'],layout:{'text-field':['coalesce',['get','name:zh'],['get','name:en'],['get','name']],'text-size':['interpolate',['linear'],['zoom'],15,10,18,12],'text-padding':6,'text-optional':false,'symbol-sort-key':['case',['in',['get','class'],['literal',['park','peak','hospital','school','grocery','restaurant']]],1,5]},paint:{'text-color':'#3a443c','text-halo-color':'#f8f9f2','text-halo-width':1.5}},
  {id:`${source}-places`,type:'symbol',source,'source-layer':'place',layout:{'text-field':['coalesce',['get','name:zh'],['get','name:en'],['get','name']],'text-size':['interpolate',['linear'],['zoom'],7,11,15,15],'text-padding':6,'text-optional':true},paint:{'text-color':'#263a30','text-halo-color':'#f8f9f3','text-halo-width':1.5}},
  {id:`${source}-house-numbers`,type:'symbol',source,'source-layer':'housenumber',minzoom:17,layout:{'text-field':['get','housenumber'],'text-size':10},paint:{'text-color':'#696a63','text-halo-color':'#f8f8f2','text-halo-width':1.1}},
];

export function offlineOutdoorStyle(packages) {
  const sources = {}, layers = [{id:'background',type:'background',paint:{'background-color':'#efefe4'}}];
  for (const item of packages) {
    const id = `tp-${item.id}`;
    sources[id] = {type:'vector',url:`pmtiles://${item.protocolKey}`};
    layers.push(...layersFor(id));
  }
  return {version:8,name:'Trail Pocket Outdoor 4.1',sources,layers};
}
