export class OpfsPmtilesSource {
  constructor(files, name, key) { this.files=files; this.name=name; this.key=key; }
  getKey() { return this.key; }
  async getBytes(offset, length, signal) {
    signal?.throwIfAborted?.();
    const data = await this.files.read(this.name, offset, length);
    signal?.throwIfAborted?.();
    return {data};
  }
}

let protocol;
export function registerOfflineArchives(maplibregl, pmtiles, files, installed) {
  if (!protocol) {
    protocol = new pmtiles.Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);
  }
  return installed.map(item => {
    const mapFile = item.files.find(file => file.name === 'map.pmtiles');
    if (!mapFile?.local) throw Error(`${item.name || item.id} 缺少已驗證向量地圖`);
    const protocolKey = `trail-pocket/${item.id}/${item.version}`;
    protocol.add(new pmtiles.PMTiles(new OpfsPmtilesSource(files, mapFile.local, protocolKey)));
    return {...item,protocolKey};
  });
}
