from pathlib import Path


def replace(path, old, new, count=1):
    p=Path(path); s=p.read_text()
    if old not in s:
        raise SystemExit(f'pattern missing in {path}: {old[:100]!r}')
    p.write_text(s.replace(old,new,count))

# map.mjs: preview bounds belong to the map coordinate system and redraw on every view change.
p=Path('map.mjs'); s=p.read_text()
anchor='''  setRegions(records) {\n    this.regionRecords = records;\n    this.regionLayers = records.map((r) => this.makeLayer(r));\n    this.draw();\n  }\n'''
insert='''  setRegions(records) {\n    this.regionRecords = records;\n    this.regionLayers = records.map((r) => this.makeLayer(r));\n    this.draw();\n  }\n  setPreviewBounds(bounds, label = "可離線範圍") {\n    this.previewBounds = bounds || null;\n    this.previewLabel = label || "可離線範圍";\n    this.draw();\n  }\n  drawPreviewBounds(c) {\n    const b = this.previewBounds;\n    if (!b || this.geoPdf && !this.geoOverlay) return;\n    const a = this.screen(project([b.west, b.north]));\n    const z = this.screen(project([b.east, b.south]));\n    const left = Math.min(a[0], z[0]), right = Math.max(a[0], z[0]);\n    const top = Math.min(a[1], z[1]), bottom = Math.max(a[1], z[1]);\n    const width = right - left, height = bottom - top;\n    c.save();\n    c.fillStyle = "rgba(17,45,35,.18)";\n    c.beginPath();\n    c.rect(0,0,this.w,this.h);\n    c.rect(left,top,width,height);\n    c.fill("evenodd");\n    c.strokeStyle = "#16845d";\n    c.lineWidth = 4;\n    c.setLineDash([]);\n    c.strokeRect(left,top,width,height);\n    const text = "可離線範圍 · " + this.previewLabel;\n    c.font = "bold 12px sans-serif";\n    const tw = Math.min(Math.max(120,c.measureText(text).width + 20), Math.max(120,this.w - 24));\n    const tx = Math.max(12, Math.min(left + 8, this.w - tw - 12));\n    const ty = Math.max(48, Math.min(top + 8, this.h - 42));\n    c.fillStyle = "rgba(25,63,50,.94)";\n    c.fillRect(tx,ty,tw,30);\n    c.fillStyle = "#fff";\n    c.textAlign = "left";\n    c.textBaseline = "middle";\n    c.fillText(text,tx+10,ty+15,tw-20);\n    c.restore();\n  }\n'''
if 'setPreviewBounds(bounds' not in s:
    if anchor not in s: raise SystemExit('map setRegions anchor missing')
    s=s.replace(anchor,insert,1)
end_anchor='''    if (this.fix) {\n      const f = this.fix,'''
# draw overlay after GPS/markers but before scale: insert just before scale calculation.
scale_anchor='''    const lat = unproject(this.center)[1],\n      mpp = this.units * Math.cos((lat * Math.PI) / 180),'''
if 'this.drawPreviewBounds(c);' not in s:
    if scale_anchor not in s: raise SystemExit('map scale anchor missing')
    s=s.replace(scale_anchor,'    this.drawPreviewBounds(c);\n'+scale_anchor,1)
p.write_text(s)

# app.mjs: replace one-time screen-position HTML rectangle with map-owned geographic preview.
p=Path('app.mjs'); s=p.read_text()
start=s.find('function previewOfflineBounds(')
end=s.find('function mini(route)',start)
if start<0 or end<0: raise SystemExit('previewOfflineBounds block missing')
new='''function clearOfflineBoundsPreview() {\n  map.setPreviewBounds?.(null);\n  $("previewBoundsFrame")?.classList.add("hide");\n}\nfunction previewOfflineBounds(rawBounds, name = "離線地圖範圍") {\n  const bounds = Array.isArray(rawBounds)\n    ? { west: rawBounds[0], south: rawBounds[1], east: rawBounds[2], north: rawBounds[3] }\n    : rawBounds;\n  if (!bounds || ![bounds.west,bounds.south,bounds.east,bounds.north].every(Number.isFinite)) {\n    toast("未能讀取呢個離線地圖範圍。");\n    return;\n  }\n  follow = false;\n  $("follow").classList.remove("selected");\n  nav("map");\n  requestAnimationFrame(() => {\n    map.resize();\n    map.setPreviewBounds(bounds, name);\n    map.fitBounds(bounds);\n    let bar = $("previewBoundsFrame");\n    if (!bar) {\n      bar = document.createElement("div");\n      bar.id = "previewBoundsFrame";\n      bar.className = "preview-bounds-toolbar";\n      bar.innerHTML = '<span><b>離線範圍預覽</b><small id="previewBoundsLabel"></small></span><button id="closeBoundsPreview">返回離線下載</button>';\n      document.querySelector(".map-wrap")?.append(bar);\n      $("closeBoundsPreview").onclick = () => { clearOfflineBoundsPreview(); nav("offline"); };\n    }\n    $("previewBoundsLabel").textContent = `${name} · 綠框內先係實際可離線範圍`;\n    bar.classList.remove("hide");\n    $("mapTitle").textContent = name;\n    $("mapMeta").textContent = "綠框跟隨真實經緯度 · 可拖動及縮放地圖查看";\n    $("mapBadge").classList.add("hide");\n  });\n}\n'''
s=s[:start]+new+s[end:]
# clear preview whenever leaving map via general navigation.
needle='''  currentView = name;\n  currentTab = ["routes", "offline", "history", "markers"].includes(name) ? "saved" : tab;'''
repl='''  if (name !== "map" && map.previewBounds) {\n    map.setPreviewBounds(null);\n    $("previewBoundsFrame")?.classList.add("hide");\n  }\n  currentView = name;\n  currentTab = ["routes", "offline", "history", "markers"].includes(name) ? "saved" : tab;'''
if needle not in s: raise SystemExit('nav anchor missing')
s=s.replace(needle,repl,1)
p.write_text(s)

# unified-ui.mjs version fallback.
p=Path('unified-ui.mjs'); s=p.read_text()
s=s.replace("const APP_VERSION_FALLBACK='v4.1.10';","const APP_VERSION_FALLBACK='v4.1.11';",1)
p.write_text(s)

# unified-ui.css: toolbar only; map canvas now owns the geographic border/mask.
p=Path('unified-ui.css'); s=p.read_text()
s += '''\n\n/* v4.1.11 geo-anchored offline preview */\n.preview-bounds-toolbar{position:absolute;z-index:12;left:16px;right:16px;bottom:calc(116px + env(safe-area-inset-bottom));display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border-radius:16px;background:rgba(255,255,255,.96);box-shadow:0 6px 24px rgba(25,63,50,.20);color:#193f32}.preview-bounds-toolbar span{display:flex;min-width:0;flex-direction:column;gap:2px}.preview-bounds-toolbar b{font-size:13px}.preview-bounds-toolbar small{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.preview-bounds-toolbar button{flex:0 0 auto;min-height:38px;padding:7px 11px;border:0;border-radius:11px;background:#193f32;color:#fff;font-size:11px;font-weight:750}.preview-bounds-frame{display:none!important}\n@media(max-width:600px){.preview-bounds-toolbar{left:12px;right:12px;bottom:calc(108px + env(safe-area-inset-bottom));padding:9px 10px}.preview-bounds-toolbar small{max-width:48vw}}\n'''
p.write_text(s)

# sw.js bump.
p=Path('sw.js'); s=p.read_text()
if '"v4.1.10"' not in s: raise SystemExit('sw version missing')
p.write_text(s.replace('"v4.1.10"','"v4.1.11"',1))
