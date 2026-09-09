import { setupPackageManager as setupBasePackageManager } from './package-manager-base.mjs';

const previewEvent = (bounds,label) => window.dispatchEvent(new CustomEvent('trail:preview-bounds',{detail:{bounds,label}}));

export function setupPackageManager(ctx){
  const api=setupBasePackageManager(ctx);
  const root=document.querySelector('#offlineView .package-library');
  const list=root?.querySelector('#packageList');
  const title=root?.querySelector('.package-title');
  const downloadAll=root?.querySelector('#downloadSouthAustralia');

  let previewAll=document.getElementById('previewSouthAustralia');
  if(title&&downloadAll&&!previewAll){
    const actions=document.createElement('div');
    actions.className='package-title-actions';
    previewAll=document.createElement('button');
    previewAll.id='previewSouthAustralia';
    previewAll.className='package-preview-all';
    previewAll.textContent='預覽全州';
    previewAll.disabled=true;
    actions.append(previewAll,downloadAll);
    title.append(actions);
  }

  const availableByName=()=>new Map((api.listAvailable?.()||[]).map(item=>[item.name,item]));
  const syncPreviewButtons=()=>{
    const available=api.listAvailable?.()||[];
    if(previewAll){
      previewAll.disabled=available.length!==7;
      previewAll.onclick=()=>{
        if(available.length!==7)return;
        const west=Math.min(...available.map(x=>x.bounds[0])),south=Math.min(...available.map(x=>x.bounds[1])),east=Math.max(...available.map(x=>x.bounds[2])),north=Math.max(...available.map(x=>x.bounds[3]));
        previewEvent([west,south,east,north],'南澳大利亞州');
      };
    }
    if(!list)return;
    const byName=availableByName();
    for(const row of list.querySelectorAll('.package-row')){
      const name=row.querySelector('b')?.textContent?.trim(),item=byName.get(name),actions=row.querySelector('.package-actions');
      if(!item||!actions||actions.querySelector('.package-preview'))continue;
      const button=document.createElement('button');
      button.type='button';
      button.className='package-preview';
      button.textContent='預覽範圍';
      button.onclick=event=>{event.preventDefault();event.stopPropagation();previewEvent(item.bounds,item.name);};
      actions.prepend(button);
    }
  };

  if(list)new MutationObserver(()=>requestAnimationFrame(syncPreviewButtons)).observe(list,{childList:true,subtree:true});
  window.addEventListener('trail:packages-changed',()=>requestAnimationFrame(syncPreviewButtons));
  requestAnimationFrame(syncPreviewButtons);
  return api;
}
