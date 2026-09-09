from pathlib import Path


def must_replace(path, old, new, count=1):
    p = Path(path)
    s = p.read_text()
    if old not in s:
        raise SystemExit(f"Pattern not found in {path}: {old[:100]!r}")
    p.write_text(s.replace(old, new, count))

# app.mjs
p=Path('app.mjs'); s=p.read_text()
anchor='function mini(route) {'
insert='''function previewOfflineBounds(rawBounds, name = "離線地圖範圍") {\n  const bounds = Array.isArray(rawBounds)\n    ? { west: rawBounds[0], south: rawBounds[1], east: rawBounds[2], north: rawBounds[3] }\n    : rawBounds;\n  if (!bounds || ![bounds.west,bounds.south,bounds.east,bounds.north].every(Number.isFinite)) {\n    toast("未能讀取呢個離線地圖範圍。");\n    return;\n  }\n  follow = false;\n  $("follow").classList.remove("selected");\n  nav("map");\n  requestAnimationFrame(() => {\n    map.resize();\n    map.fitBounds(bounds);\n    let frame = $("previewBoundsFrame");\n    if (!frame) {\n      frame = document.createElement("div");\n      frame.id = "previewBoundsFrame";\n      frame.className = "preview-bounds-frame";\n      frame.innerHTML = '<span id="previewBoundsLabel"></span><button id="closeBoundsPreview">返回離線下載</button>';\n      document.querySelector(".map-wrap")?.append(frame);\n      $("closeBoundsPreview").onclick = () => { frame.classList.add("hide"); nav("offline"); };\n    }\n    const a = map.screen(project([bounds.west, bounds.north]));\n    const z = map.screen(project([bounds.east, bounds.south]));\n    const left = Math.min(a[0], z[0]), top = Math.min(a[1], z[1]);\n    frame.style.left = `${left}px`;\n    frame.style.top = `${top}px`;\n    frame.style.width = `${Math.max(28, Math.abs(z[0]-a[0]))}px`;\n    frame.style.height = `${Math.max(28, Math.abs(z[1]-a[1]))}px`;\n    $("previewBoundsLabel").textContent = name;\n    frame.classList.remove("hide");\n    $("mapTitle").textContent = name;\n    $("mapMeta").textContent = "離線地圖範圍預覽 · 尚未開始下載";\n    $("mapBadge").classList.add("hide");\n  });\n}\n'''
if 'function previewOfflineBounds(' not in s:
    if anchor not in s: raise SystemExit('app preview anchor missing')
    s=s.replace(anchor,insert+anchor,1)
s=s.replace('const packageManager = setupPackageManager({ask,toast,failure,changed:()=>explore.refresh()});','const packageManager = setupPackageManager({ask,toast,failure,changed:()=>explore.refresh(),previewBounds:previewOfflineBounds});',1)
s=s.replace('setupUnifiedUI({nav});','setupUnifiedUI({nav,previewBounds:previewOfflineBounds});',1)
p.write_text(s)

# package-manager.mjs
p=Path('package-manager.mjs'); s=p.read_text()
old='root.innerHTML=\'<div class="package-title"><div><span>V4.1 離線向量地圖</span><h2>南澳大利亞州</h2><p id="packageSummary">正在讀取地圖包目錄…</p></div><button id="downloadSouthAustralia" disabled>下載全部</button></div><div id="packageProgress" class="package-progress hide"><span></span><b></b><button id="pausePackage">暫停</button></div><div id="packageList" class="package-list"></div>\';'
new='root.innerHTML=\'<div class="package-title"><div><span>V4.1 離線向量地圖</span><h2>南澳大利亞州</h2><p id="packageSummary">正在讀取地圖包目錄…</p></div><div class="package-title-actions"><button id="previewSouthAustralia" disabled>預覽全部</button><button id="downloadSouthAustralia" disabled>下載全部</button></div></div><div id="packageProgress" class="package-progress hide"><span></span><b></b><button id="pausePackage">暫停</button></div><div id="packageList" class="package-list"></div>\';'
if old not in s: raise SystemExit('package title pattern missing')
s=s.replace(old,new,1)
old="row.innerHTML=`<span class=\"package-state\">${ready?'✓':hasUpdate?'↻':'↓'}</span><div><b>${manifest.name}</b><small>${mb(packageBytes(manifest))}${manifest.packageFormat==='v4.1-slim'?' · 瘦身包':''}${hasUpdate?` · 已保留 ${current.version}`:''}${s?.state==='paused'?' · 可繼續':s?.state==='failed'?' · 需要修復':''}</small></div><div class=\"package-actions\"><button>${actionLabel}</button>${!ready&&['paused','failed'].includes(s?.state)?'<button class=\"package-cancel\">取消</button>':''}</div>`;"
new="row.innerHTML=`<span class=\"package-state\">${ready?'✓':hasUpdate?'↻':'↓'}</span><div><b>${manifest.name}</b><small>${mb(packageBytes(manifest))}${manifest.packageFormat==='v4.1-slim'?' · 瘦身包':''}${hasUpdate?` · 已保留 ${current.version}`:''}${s?.state==='paused'?' · 可繼續':s?.state==='failed'?' · 需要修復':''}</small></div><div class=\"package-actions\"><button class=\"package-preview\">預覽</button><button class=\"package-download\">${actionLabel}</button>${!ready&&['paused','failed'].includes(s?.state)?'<button class=\"package-cancel\">取消</button>':''}</div>`;"
if old not in s: raise SystemExit('package row pattern missing')
s=s.replace(old,new,1)
s=s.replace("const button=row.querySelector('button');button.disabled=busy||ready;button.onclick=()=>confirmDownload([manifest],false);","const preview=row.querySelector('.package-preview');preview.disabled=busy;preview.onclick=()=>ctx.previewBounds?.(manifest.bounds,manifest.name);const button=row.querySelector('.package-download');button.disabled=busy||ready;button.onclick=()=>confirmDownload([manifest],false);",1)
s=s.replace("$('downloadSouthAustralia').disabled=busy||prod.length!==7||full;","$('downloadSouthAustralia').disabled=busy||prod.length!==7||full;$('previewSouthAustralia').disabled=busy||!prod.length;",1)
s=s.replace("$('downloadSouthAustralia').onclick=()=>confirmDownload(production(),true);","$('previewSouthAustralia').onclick=()=>{const items=production();if(!items.length)return;const b={west:Math.min(...items.map(x=>x.bounds[0])),south:Math.min(...items.map(x=>x.bounds[1])),east:Math.max(...items.map(x=>x.bounds[2])),north:Math.max(...items.map(x=>x.bounds[3]))};ctx.previewBounds?.(b,'南澳大利亞州 · 全部離線地圖範圍');};\n  $('downloadSouthAustralia').onclick=()=>confirmDownload(production(),true);",1)
p.write_text(s)

# unified-ui.mjs
p=Path('unified-ui.mjs'); s=p.read_text()
s=s.replace("const APP_VERSION_FALLBACK='v4.1.9';","const APP_VERSION_FALLBACK='v4.1.10';",1)
if 'let previewOfflineBounds=' not in s:
    s=s.replace("const $ = id => document.getElementById(id);","const $ = id => document.getElementById(id);\nlet previewOfflineBounds=(bounds,name)=>{};",1)
marker="const state=row.querySelector('.region-state'),meta=[...row.children].find(el=>el.tagName==='SPAN'&&!el.classList.contains('region-state'));"
if marker not in s: raise SystemExit('park marker missing')
s=s.replace(marker,marker+"\n  let preview=row.querySelector('.region-preview');if(!preview){preview=document.createElement('button');preview.className='region-preview';preview.textContent='預覽';preview.type='button';action.before(preview);}preview.onclick=event=>{event.preventDefault();event.stopImmediatePropagation();previewOfflineBounds(region.bounds,region.name);};",1)
s=s.replace("export function setupUnifiedUI(ctx) {\n applyVisibleVersion(APP_VERSION_FALLBACK);","export function setupUnifiedUI(ctx) {\n previewOfflineBounds=ctx.previewBounds||previewOfflineBounds;\n applyVisibleVersion(APP_VERSION_FALLBACK);",1)
p.write_text(s)

# unified-ui.css
p=Path('unified-ui.css'); s=p.read_text()
if 'v4.1.10 offline package / park bounds preview' not in s:
    s += '''\n\n/* v4.1.10 offline package / park bounds preview */\n.package-title-actions{display:flex;gap:8px;align-items:center}.package-preview,.region-preview{border:1px solid var(--border)!important;background:#fff!important;color:var(--ink)!important;min-height:38px!important;padding:7px 11px!important;font-size:12px!important}.package-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.region-preview{grid-column:3;grid-row:1/3}.region-row>button:not(.region-preview){grid-column:4;grid-row:1/3}\n.preview-bounds-frame{position:absolute;z-index:8;border:3px solid #1b7650;border-radius:12px;background:rgba(184,238,146,.10);box-shadow:0 0 0 9999px rgba(25,63,50,.06);pointer-events:none}.preview-bounds-frame>span{position:absolute;left:8px;top:8px;max-width:calc(100% - 16px);padding:6px 9px;border-radius:9px;background:rgba(25,63,50,.92);color:#fff;font-size:11px;font-weight:750;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.preview-bounds-frame>button{position:absolute;right:8px;bottom:8px;pointer-events:auto;border:0;background:#fff;color:#193f32;min-height:36px;padding:7px 10px;font-size:11px;box-shadow:0 3px 12px rgba(25,63,50,.18)}\n@media(max-width:600px){.package-title-actions{width:100%;justify-content:flex-end}.package-title{flex-wrap:wrap}.region-row{grid-template-columns:34px minmax(0,1fr) auto auto}.region-preview{grid-column:3}.region-row>button:not(.region-preview){grid-column:4}.preview-bounds-frame>span{font-size:10px}}\n'''
p.write_text(s)

# service worker
p=Path('sw.js'); s=p.read_text()
if '"v4.1.9"' not in s: raise SystemExit('sw version pattern missing')
p.write_text(s.replace('"v4.1.9"','"v4.1.10"',1))
