import './v41-enhancements.mjs';
import { setupUnifiedUI as setupBaseUnifiedUI } from './unified-ui-base.mjs';
import { OFFLINE_REGIONS } from './offline-regions.mjs';

const dispatchPreview=(bounds,label)=>window.dispatchEvent(new CustomEvent('trail:preview-bounds',{detail:{bounds,label}}));

export function setupUnifiedUI(ctx){
  setupBaseUnifiedUI(ctx);
  const list=document.getElementById('regionList');
  const parkByName=()=>new Map(OFFLINE_REGIONS.map(region=>[region.name,region]));

  const syncParkPreviews=()=>{
    if(!list)return;
    const parks=parkByName();
    for(const row of list.querySelectorAll('.region-row')){
      if(row.querySelector('.park-preview'))continue;
      const name=row.querySelector('h3')?.textContent?.trim(),region=parks.get(name),text=row.querySelector('h3')?.parentElement;
      if(!region||!text)continue;
      const preview=document.createElement('span');
      preview.className='park-preview';
      preview.setAttribute('role','button');
      preview.tabIndex=0;
      preview.textContent='預覽框選範圍';
      const open=event=>{event.preventDefault();event.stopPropagation();dispatchPreview(region.bounds,region.name);};
      preview.onclick=open;
      preview.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();open(event);}};
      text.append(preview);
    }
  };

  if(list)new MutationObserver(()=>requestAnimationFrame(syncParkPreviews)).observe(list,{childList:true,subtree:true});
  window.addEventListener('trail:parks-changed',()=>requestAnimationFrame(syncParkPreviews));
  window.addEventListener('trail:packages-changed',()=>requestAnimationFrame(syncParkPreviews));
  requestAnimationFrame(syncParkPreviews);
}
