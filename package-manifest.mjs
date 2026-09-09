const ID = /^[a-z0-9][a-z0-9-]{1,79}$/;
const HASH = /^[a-f0-9]{64}$/;
const FILES = ['map.pmtiles', 'search.index', 'routing.graph'];
const ENCODINGS = new Set(['gzip']);

export function validatePackageManifest(value) {
  if (!value || value.schema !== 1 || !ID.test(value.id || '') || typeof value.name !== 'string' || !value.name.trim())
    throw Error('地圖包清單格式無效');
  if (!Array.isArray(value.bounds) || value.bounds.length !== 4 || value.bounds.some(n => !Number.isFinite(n)) || value.bounds[0] < -180 || value.bounds[2] > 180 || value.bounds[1] < -85 || value.bounds[3] > 85 || value.bounds[0] >= value.bounds[2] || value.bounds[1] >= value.bounds[3])
    throw Error('地圖包覆蓋範圍無效');
  if (!value.version || !value.builtAt || !value.osmDate || !value.minAppVersion) throw Error('地圖包版本資料不完整');
  if (!Array.isArray(value.files) || value.files.length !== FILES.length) throw Error('地圖包檔案不完整');
  const names = new Set();
  for (const file of value.files) {
    if (!FILES.includes(file.name) || names.has(file.name) || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > 4 * 1024 * 1024 * 1024 || !HASH.test(file.sha256 || '') || typeof file.url !== 'string')
      throw Error('地圖包檔案資料無效');
    if (file.encoding != null && !ENCODINGS.has(file.encoding)) throw Error('地圖包壓縮格式不支援');
    if (file.name === 'map.pmtiles' && file.encoding) throw Error('PMTiles 不應再額外壓縮');
    const url = new URL(file.url, 'https://trail-pocket.invalid/');
    if (!['https:','http:'].includes(url.protocol)) throw Error('地圖包下載網址無效');
    names.add(file.name);
  }
  return structuredClone(value);
}

export const packageBytes = manifest => manifest.files.reduce((sum, file) => sum + file.size, 0);
export const localPackageFile = (manifest, file) => `${manifest.id}-${manifest.version}-${file.sha256.slice(0,12)}-${file.name}.partial`;
