import { unproject } from './core.mjs';
import * as maplibregl from './vendor/maplibre-gl.mjs';
import { offlineOutdoorStyle } from './outdoor-style.mjs';
import { registerOfflineArchives } from './pmtiles-opfs.mjs';

const WORLD = 40075016.68557849;
export const OPENFREEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

export function tuneOutdoorStyle(map) {
  for (const layer of map.getStyle().layers || []) {
    const id = layer.id.toLowerCase();
    try {
      if (layer.type === 'background') map.setPaintProperty(layer.id, 'background-color', '#eef0e7');
      if (layer.type === 'fill' && /(park|wood|forest|grass|nature|reserve)/.test(id)) map.setPaintProperty(layer.id, 'fill-color', '#dce9cf');
      if (layer.type === 'fill' && /(water|ocean|lake|river)/.test(id)) map.setPaintProperty(layer.id, 'fill-color', '#b9dce4');
      if (layer.type === 'fill' && /building/.test(id)) map.setPaintProperty(layer.id, 'fill-color', '#d9d5ca');
      if (layer.type === 'line' && /(path|track|footway|trail)/.test(id)) {
        map.setPaintProperty(layer.id, 'line-color', '#8b684a');
        map.setPaintProperty(layer.id, 'line-opacity', 0.92);
      }
      if (layer.type === 'symbol') {
        map.setPaintProperty(layer.id, 'text-color', '#26382f');
        map.setPaintProperty(layer.id, 'text-halo-color', '#f8f9f3');
        map.setPaintProperty(layer.id, 'text-halo-width', 1.2);
      }
    } catch {}
  }
}

export class VectorBaseMap {
  constructor(container, status = () => {}) {
    this.container = container; this.status = status;
    // MapLibre GL JS 6 removed the old `supported()` helper from its ESM
    // exports. create() is the real capability check and already falls back
    // safely when WebGL/GPU initialization fails.
    this.supported = Boolean(container && maplibregl.Map); this.enabled = false;
  }
  create() {
    if (this.map || !this.supported) return Boolean(this.map);
    try {
      this.map = new maplibregl.Map({container:this.container,style:OPENFREEMAP_STYLE,center:[138.82,-34.682],zoom:11,interactive:false,attributionControl:false,fadeDuration:0});
      this.timeout = setTimeout(() => { if (!this.ready) this.fail(Error('向量底圖載入逾時')); }, 12000);
      this.map.once('style.load', () => { clearTimeout(this.timeout); this.ready = true; tuneOutdoorStyle(this.map); this.status({engine:'vector',loaded:1,total:1,failed:0}); });
      this.map.on('error', event => this.status({engine:'vector',loaded:this.ready?1:0,total:1,failed:1,error:event.error?.message || '向量底圖錯誤'}));
      return true;
    } catch (error) { this.fail(error); return false; }
  }
  fail(error) {
    clearTimeout(this.timeout); this.supported = false; this.enabled = false; this.container?.classList.add('hide');
    this.status({engine:'vector',loaded:0,total:1,failed:1,error:error.message});
  }
  setEnabled(value) {
    const next = Boolean(value) && this.create(); this.enabled = Boolean(next); this.container?.classList.toggle('hide', !this.enabled);
    if (this.enabled) {
      if (this.offline) {
        this.offline = false; this.ready = false; this.map.setStyle(OPENFREEMAP_STYLE, {diff:false});
        this.map.once('style.load', () => { this.ready=true; tuneOutdoorStyle(this.map); this.status({engine:'vector',loaded:1,total:1,failed:0}); });
      }
      requestAnimationFrame(() => this.map.resize()); this.status({engine:'vector',loaded:this.ready?1:0,total:1,failed:0});
    }
    return this.enabled;
  }
  sync(center, units) {
    if (!this.enabled || !this.map) return;
    const zoom = Math.max(0, Math.min(22, Math.log2(WORLD / (512 * units))));
    this.map.jumpTo({center:unproject(center),zoom,bearing:0,pitch:0});
  }
  resize() { if (this.enabled) this.map?.resize(); }
  async setOfflinePackages(installed, files) {
    if (!installed?.length || !globalThis.pmtiles) return false;
    const archives = registerOfflineArchives(maplibregl, globalThis.pmtiles, files, installed);
    if (!this.create()) return false;
    this.map.setStyle(offlineOutdoorStyle(archives), {diff:false});
    this.offline = true; this.enabled = true; this.container.classList.remove('hide');
    this.status({engine:'pmtiles',loaded:archives.length,total:archives.length,failed:0});
    return true;
  }
}
