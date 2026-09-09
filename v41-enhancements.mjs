import * as store from './storage.mjs';

const $ = id => document.getElementById(id);

function installStyles(){
  if ($('v41EnhancementStyles')) return;
  const style=document.createElement('style');
  style.id='v41EnhancementStyles';
  style.textContent=`
    .area-preview-note{margin:8px 0 2px;padding:10px 12px;border-radius:12px;background:#eef4e8;color:#315746;font-size:12px;line-height:1.55}
    .area-frame.previewing{box-shadow:0 0 0 4px rgba(63,137,91,.2),0 0 0 9999px rgba(20,53,39,.08);animation:areaPreviewPulse .8s ease 2}
    @keyframes areaPreviewPulse{50%{border-color:#7ee56d;box-shadow:0 0 0 7px rgba(126,229,109,.2),0 0 0 9999px rgba(20,53,39,.08)}}
    .activity-record-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.activity-record-actions button{margin-top:0!important}
    .activity-delete{color:#9a382f;border-color:#e5c9c4;background:#fff7f5}
    .area-preview-hint{font-size:11px;color:var(--muted);margin-top:8px}

    #settingsView>.settings-intro{margin:0 0 12px;font-size:12px;color:var(--muted)}
    #settingsView .settings-card-head p{display:none}
    #settingsView .settings-list button small{display:none}
    #settingsView .settings-list button{min-height:54px}
    #settingsView .settings-collapse{padding:0;margin:0;border:0;border-bottom:1px solid var(--border);background:#fff}
    #settingsView .settings-collapse>summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:58px;padding:8px 2px;font-weight:750}
    #settingsView .settings-collapse>summary::-webkit-details-marker{display:none}
    #settingsView .settings-collapse>summary span{display:flex;flex-direction:column;gap:2px;min-width:0}
    #settingsView .settings-collapse>summary b{font-size:17px}
    #settingsView .settings-collapse>summary small{font-size:11px;font-weight:500;color:var(--muted);white-space:normal}
    #settingsView .settings-collapse>summary:after{content:'›';font-size:25px;font-weight:400;color:var(--muted);transform:rotate(0deg);transition:transform .18s ease}
    #settingsView .settings-collapse[open]>summary:after{transform:rotate(90deg)}
    #settingsView .settings-collapse-content{padding:2px 0 18px}
    #settingsView .settings-collapse-content>h2:first-child{display:none}
    #settingsView .settings-collapse-content>.fineprint:first-of-type{margin-top:8px}
    #settingsView .settings-help-collapse{margin:0;border-bottom:1px solid var(--border)}
    #settingsView .settings-help-collapse>summary{font-size:16px}
    #settingsView .settings-help-collapse .steps{margin:2px 0 16px;padding-left:24px}
    #settingsView .settings-help-collapse .steps p{font-size:12px;line-height:1.55;margin:5px 0 12px}
    #settingsView .settings-guide-title{display:none}
    @media(max-width:600px){
      #settingsView .settings-collapse>summary{min-height:56px}
      #settingsView .settings-collapse>summary b{font-size:16px}
    }
  `;
  document.head.append(style);
}

function installSelectionPreview(){
  const controls=$('areaControls'),frame=$('areaFrame');
  if(!controls||!frame)return;
  let note=$('areaPreviewNote');
  if(!note){
    note=document.createElement('p');
    note.id='areaPreviewNote';
    note.className='area-preview-note';
    note.textContent='預覽：地圖上嘅藍色框就係即將下載嘅範圍。你可以先拖動／縮放地圖調整，確認後先下載。';
    $('areaSize')?.after(note);
  }
  const row=controls.querySelector('.row');
  if(row&&!$('previewSelectedArea')){
    const b=document.createElement('button');
    b.id='previewSelectedArea';
    b.type='button';
    b.textContent='預覽框選範圍';
    b.onclick=()=>{
      frame.classList.add('previewing');
      frame.querySelector('span') && (frame.querySelector('span').textContent='預覽：將下載此範圍');
      setTimeout(()=>frame.classList.remove('previewing'),1700);
    };
    row.insertBefore(b,$('saveArea'));
  }
}

function collapseSettingsCard(card,subtitle='撳一下查看設定'){
  if(!card||card.tagName==='DETAILS'||card.dataset.compacted==='1')return null;
  const title=card.querySelector(':scope > h2')?.textContent?.trim() || card.querySelector(':scope > .settings-card-head h2')?.textContent?.trim();
  if(!title)return null;
  const details=document.createElement('details');
  details.className=[...card.classList,'settings-collapse'].join(' ');
  details.dataset.compacted='1';
  const summary=document.createElement('summary');
  summary.innerHTML=`<span><b>${title}</b><small>${subtitle}</small></span>`;
  const content=document.createElement('div');content.className='settings-collapse-content';
  while(card.firstChild)content.append(card.firstChild);
  details.append(summary,content);
  card.replaceWith(details);
  return details;
}

function compactSettings(){
  const view=$('settingsView');if(!view)return;
  const intro=view.querySelector(':scope > .settings-intro');
  if(intro)intro.textContent='常用設定直接顯示；其他選項及說明需要時再展開。';

  for(const card of [...view.querySelectorAll(':scope > .settings-card')]){
    if(card.dataset.compacted==='1'||card.tagName==='DETAILS')continue;
    const title=card.querySelector(':scope > h2')?.textContent?.trim() || card.querySelector(':scope > .settings-card-head h2')?.textContent?.trim();
    if(!title||['GPS 與位置','地圖與導航'].includes(title))continue;
    const subtitle={
      '方向與指南針':'方向感應及指南針選項',
      '活動':'螢幕常亮及活動相關設定',
      'App 與儲存':'更新及清理舊地圖',
      '離線與本機資料':'等高線、備份、自檢及儲存',
    }[title]||'撳一下查看設定';
    collapseSettingsCard(card,subtitle);
  }

  const guideTitle=view.querySelector(':scope > .settings-guide-title');
  const steps=view.querySelector(':scope > .steps');
  if(steps&&!steps.closest('details')){
    const details=document.createElement('details');
    details.className='settings-guide settings-collapse settings-help-collapse';
    details.dataset.compacted='1';
    const summary=document.createElement('summary');
    summary.innerHTML='<span><b>使用及安全說明</b><small>操作流程、離線使用及安全提醒</small></span>';
    const content=document.createElement('div');content.className='settings-collapse-content';
    content.append(steps);
    if(guideTitle)guideTitle.replaceWith(details);else view.append(details);
    details.append(summary,content);
  }
}

async function enhanceAreaList(){
  const list=$('areaList');
  if(!list||!list.children.length)return;
  try{
    const areas=(await store.listMapMeta('areas')).sort((a,b)=>b.downloaded-a.downloaded);
    [...list.querySelectorAll('.download-card')].forEach((card,index)=>{
      const area=areas[index];
      if(!area)return;
      const buttons=[...card.querySelectorAll('button')];
      const open=buttons.find(b=>/開啟離線區域|預覽範圍/.test(b.textContent));
      if(open){
        open.textContent='預覽範圍';
        open.setAttribute('aria-label',`預覽 ${area.name} 框選範圍`);
      }
      if(!card.querySelector('.area-preview-hint')){
        const hint=document.createElement('p');
        hint.className='area-preview-hint';
        hint.textContent='按「預覽範圍」會回到地圖並完整框住呢個離線區域。';
        card.append(hint);
      }
    });
  }catch{}
}

async function enhanceActivityList(){
  const list=$('activityHistoryList');
  if(!list||!list.querySelector('.activity-record'))return;
  try{
    const items=(await store.getAll('activities')).sort((a,b)=>b.created-a.created);
    [...list.querySelectorAll('.activity-record')].forEach((card,index)=>{
      const activity=items[index];
      if(!activity||card.querySelector('.activity-record-actions'))return;
      const view=card.querySelector('button');
      const actions=document.createElement('div');
      actions.className='activity-record-actions';
      if(view)actions.append(view);
      const del=document.createElement('button');
      del.type='button';
      del.className='activity-delete';
      del.textContent='刪除';
      del.setAttribute('aria-label',`刪除活動 ${activity.name}`);
      del.onclick=async()=>{
        const ok=window.confirm(`刪除活動「${activity.name}」？\n\n只會刪除呢一條活動紀錄，其他活動、路線同離線地圖唔受影響。`);
        if(!ok)return;
        del.disabled=true;
        try{
          await store.transaction(['activities'],'readwrite',t=>t.objectStore('activities').delete(activity.id));
          card.remove();
          if(!list.querySelector('.activity-record')){
            const empty=document.createElement('p');empty.textContent='未有已完成活動。';list.append(empty);
          }
        }catch(error){
          del.disabled=false;
          alert(error?.message||'未能刪除活動。');
        }
      };
      actions.append(del);
      card.append(actions);
    });
  }catch{}
}

function boot(){
  installStyles();
  installSelectionPreview();
  compactSettings();
  enhanceAreaList();
  enhanceActivityList();
  const observer=new MutationObserver(()=>{
    installSelectionPreview();
    compactSettings();
    enhanceAreaList();
    enhanceActivityList();
  });
  observer.observe(document.body,{childList:true,subtree:true});
  window.addEventListener('trail:view',()=>{
    requestAnimationFrame(()=>{enhanceAreaList();enhanceActivityList();installSelectionPreview();compactSettings();});
  });
}

if(typeof document!=='undefined'){
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
}
