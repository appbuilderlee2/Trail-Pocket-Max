// Separate catalog keeps the v3 database readable by the rollback release.
export function openPackageCatalog(factory = indexedDB, scope = new URL('./', import.meta.url).pathname) {
  return new Promise((resolve, reject) => {
    const request = factory.open('trail-pocket-packages:' + scope, 2);
    request.onupgradeneeded = () => {
      for (const name of ['packages', 'downloads', 'manifests', 'metadata'])
        if (!request.result.objectStoreNames.contains(name))
          request.result.createObjectStore(name, { keyPath: 'id' });
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(Error('請關閉其他 Trail Pocket 視窗再試。'));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function packageCatalog(db) {
  const store = (name, mode = 'readonly') => db.transaction(name, mode).objectStore(name);
  return {
    get: (name, id) => requestResult(store(name).get(id)),
    list: (name) => requestResult(store(name).getAll()),
    put: (name, value) => requestResult(store(name, 'readwrite').put(value)),
    remove: (name, id) => requestResult(store(name, 'readwrite').delete(id)),
  };
}

export async function recordPackageMigration(catalog, now = Date.now()) {
  const previous = await catalog.get('metadata', 'migration');
  const value = {
    id:'migration',schemaVersion:2,personalDatabaseVersion:5,state:'ready',
    startedAt:previous?.startedAt || now,completedAt:now,
    rollback:'v3.8 personal data remains in the original database',
  };
  await catalog.put('metadata', value);
  return value;
}

function safeName(name) {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(name))
    throw Error('地圖檔案名稱無效');
  return name;
}

// No implicit deletion or promotion: callers must verify a completed download
// before switching the active catalog pointer to its immutable filename.
export async function openPackageFiles(storage = navigator.storage) {
  if (!storage?.getDirectory) throw Error('此瀏覽器未支援大型離線地圖儲存。');
  const root = await storage.getDirectory();
  const directory = await root.getDirectoryHandle('trail-pocket-v4', { create: true });
  return {
    async stat(name) {
      safeName(name);
      try {
        const file = await (await directory.getFileHandle(name)).getFile();
        return { name, size: file.size, lastModified: file.lastModified };
      } catch (error) {
        if (error?.name === 'NotFoundError') return null;
        throw error;
      }
    },
    async read(name, offset = 0, length) {
      safeName(name);
      if (!Number.isSafeInteger(offset) || offset < 0 || (length !== undefined && (!Number.isSafeInteger(length) || length < 0)))
        throw Error('讀取範圍無效');
      const file = await (await directory.getFileHandle(name)).getFile();
      return file.slice(offset, length === undefined ? file.size : offset + length).arrayBuffer();
    },
    async getFile(name) {
      safeName(name);
      return (await directory.getFileHandle(name)).getFile();
    },
    async append(name, expectedOffset, bytes) {
      safeName(name);
      if (!name.endsWith('.partial')) throw Error('只可寫入未完成地圖檔案');
      if (!Number.isSafeInteger(expectedOffset) || expectedOffset < 0) throw Error('下載位置無效');
      if (!(bytes instanceof Uint8Array)) throw Error('下載內容無效');
      const handle = await directory.getFileHandle(name, { create: true });
      const file = await handle.getFile();
      if (file.size !== expectedOffset) throw Error('下載位置不一致，請重新檢查進度');
      const writer = await handle.createWritable({ keepExistingData: true });
      try {
        await writer.write({ type: 'write', position: expectedOffset, data: bytes });
        await writer.close();
      } catch (error) {
        await writer.abort().catch(() => {});
        throw error;
      }
      return expectedOffset + bytes.byteLength;
    },
    async remove(name) {
      safeName(name);
      await directory.removeEntry(name);
    },
  };
}
