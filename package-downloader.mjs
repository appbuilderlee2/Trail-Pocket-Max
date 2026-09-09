import { packageBytes, localPackageFile, validatePackageManifest } from './package-manifest.mjs';
import { sha256File } from './sha256.mjs';

export async function assertPackageStorage(storage, required, reserve = 64 * 1024 * 1024) {
  const estimate = await storage?.estimate?.();
  if (!estimate || !Number.isFinite(estimate.quota) || !Number.isFinite(estimate.usage)) throw Error('無法確認可用儲存空間');
  const available = Math.max(0, estimate.quota - estimate.usage);
  if (available < required + reserve) throw Error(`儲存空間不足：需要至少 ${Math.ceil((required + reserve)/1048576)} MB`);
  return { available, required, reserve };
}

function parseRange(response, start, end, total) {
  if (start === 0 && response.status === 200) {
    const length = Number(response.headers.get('content-length'));
    if (Number.isFinite(length) && length !== total) throw Error('伺服器回報的檔案容量不一致');
    return;
  }
  if (response.status !== 206) throw Error('下載伺服器不支援可靠續傳');
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
  if (!match || +match[1] !== start || +match[2] !== end || +match[3] !== total) throw Error('續傳範圍驗證失敗');
}

export async function downloadPackage(rawManifest, {
  files, catalog, storage = navigator.storage, fetcher = fetch, chunkSize = 4 * 1024 * 1024,
  signal, onProgress = () => {}, now = () => Date.now(), skipStorageCheck = false,
}) {
  const manifest = validatePackageManifest(rawManifest), total = packageBytes(manifest);
  await catalog.put('manifests', { ...manifest, id: manifest.id });
  let complete = 0;
  for (const entry of manifest.files) complete += Math.min((await files.stat(localPackageFile(manifest, entry)))?.size || 0, entry.size);
  if (!skipStorageCheck) await assertPackageStorage(storage, total - complete);
  await catalog.put('downloads', { id: manifest.id, version: manifest.version, state: 'downloading', received: complete, total, updatedAt: now() });
  try {
    for (const entry of manifest.files) {
      const name = localPackageFile(manifest, entry);
      let offset = (await files.stat(name))?.size || 0;
      if (offset > entry.size) { await files.remove(name); offset = 0; }
      while (offset < entry.size) {
        if (signal?.aborted) throw signal.reason || new DOMException('已暫停下載', 'AbortError');
        const end = Math.min(entry.size - 1, offset + chunkSize - 1);
        const response = await fetcher(entry.url, { headers: { Accept: 'application/octet-stream', Range: `bytes=${offset}-${end}` }, signal, cache: 'no-store' });
        if (!response.ok) throw Error(`下載失敗（HTTP ${response.status}）`);
        parseRange(response, offset, end, entry.size);
        const bytes = new Uint8Array(await response.arrayBuffer());
        const expected = end - offset + 1;
        if (bytes.length !== expected && !(offset === 0 && response.status === 200 && bytes.length === entry.size)) throw Error('下載片段長度不一致');
        offset = await files.append(name, offset, bytes);
        complete += bytes.length;
        await catalog.put('downloads', { id: manifest.id, version: manifest.version, state: 'downloading', received: complete, total, file: entry.name, updatedAt: now() });
        onProgress({ id: manifest.id, file: entry.name, received: complete, total });
      }
      const actual = await sha256File(files, name, entry.size, chunkSize);
      if (actual !== entry.sha256) throw Error(`${entry.name} 完整性驗證失敗`);
    }
    const installed = { id: manifest.id, version: manifest.version, name: manifest.name, bounds: manifest.bounds, state: 'ready', files: manifest.files.map(entry => ({ ...entry, local: localPackageFile(manifest, entry) })), verifiedAt: now() };
    await catalog.put('packages', installed);
    await catalog.put('downloads', { id: manifest.id, version: manifest.version, state: 'ready', received: total, total, updatedAt: now() });
    return installed;
  } catch (error) {
    const paused = error?.name === 'AbortError';
    await catalog.put('downloads', { id: manifest.id, version: manifest.version, state: paused ? 'paused' : 'failed', received: complete, total, error: paused ? '' : error.message, updatedAt: now() });
    throw error;
  }
}

export async function repairPackage(manifest, dependencies) {
  const valid = validatePackageManifest(manifest);
  for (const entry of valid.files) {
    const name = localPackageFile(valid, entry), stat = await dependencies.files.stat(name);
    if (stat?.size !== entry.size || await sha256File(dependencies.files, name, entry.size) !== entry.sha256)
      if (stat) await dependencies.files.remove(name);
  }
  return downloadPackage(valid, { ...dependencies, skipStorageCheck: false });
}
