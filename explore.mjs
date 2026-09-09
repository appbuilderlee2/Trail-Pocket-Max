import { setupExplore as setupBaseExplore } from './explore-base.mjs';
import { project } from './core.mjs';

// Reliability invariant implemented by explore-base.mjs: view:${ctx.getView()}
const toBounds = value => {
  if (Array.isArray(value) && value.length >= 4) {
    return { west:Number(value[0]), south:Number(value[1]), east:Number(value[2]), north:Number(value[3]) };
  }
  if (value && [value.west,value.south,value.east,value.north].every(Number.isFinite)) {
    return { west:Number(value.west), south:Number(value.south), east:Number(value.east), north:Number(value.north) };
  }
  return null;
};

export function setupExplore(ctx) {
  const api = setupBaseExplore(ctx);
  let preview = null;
  const map = ctx.map;
  const originalViewChange = map.onViewChange;

  const hidePreview = () => {
    preview = null;
    const frame = document.getElementById('areaFrame');
    if (frame && !api.isSelecting?.()) frame.classList.add('hide');
  };

  const drawPreview = () => {
    if (!preview || api.isSelecting?.()) {
      if (api.isSelecting?.()) preview = null;
      return;
    }
    const frame = document.getElementById('areaFrame');
    if (!frame) return;
    const { bounds:b, label } = preview;
    const a = map.screen(project([b.west,b.north]));
    const z = map.screen(project([b.east,b.south]));
    if (![...a,...z].every(Number.isFinite)) return;
    frame.classList.remove('hide');
    frame.style.inset = 'auto';
    frame.style.left = Math.min(a[0],z[0]) + 'px';
    frame.style.top = Math.min(a[1],z[1]) + 'px';
    frame.style.width = Math.abs(z[0]-a[0]) + 'px';
    frame.style.height = Math.abs(z[1]-a[1]) + 'px';
    const caption = frame.querySelector('span');
    if (caption) caption.textContent = `${label} · 預覽範圍`;
    document.getElementById('areaControls')?.classList.add('hide');
  };

  const previewBounds = (rawBounds,label='預覽範圍') => {
    const bounds = toBounds(rawBounds);
    if (!bounds) return ctx.toast?.('未能讀取呢個地圖範圍。');
    ctx.pauseFollow?.();
    ctx.nav?.('map');
    map.resize?.();
    preview = { bounds, label:String(label || '預覽範圍') };
    map.fitBounds(bounds);
    requestAnimationFrame(() => requestAnimationFrame(drawPreview));
    ctx.toast?.(`正在預覽「${preview.label}」框選範圍；唔會開始下載。`);
  };

  map.onViewChange = (...args) => {
    originalViewChange?.(...args);
    drawPreview();
  };

  window.addEventListener('trail:preview-bounds', event => {
    const detail = event.detail || {};
    previewBounds(detail.bounds,detail.label);
  });

  const baseViewChanged = api.viewChanged?.bind(api);
  return {
    ...api,
    previewBounds,
    viewChanged(...args) {
      baseViewChanged?.(...args);
      if (ctx.getView?.() !== 'map') hidePreview();
      else requestAnimationFrame(drawPreview);
    },
  };
}
