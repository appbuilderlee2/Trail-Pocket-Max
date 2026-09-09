export const BACKUP_FORMAT = "trail-pocket-backup",
  BACKUP_VERSION = 2,
  MAX_BACKUP_BYTES = 300 * 1024 * 1024;
const stores = ["routes", "maps", "areas", "activities", "settings", "geopdfs", "markers"];
const personalStores = ["routes", "activities", "settings", "markers"];
const jsonSize = (value) => new Blob([JSON.stringify(value)]).size;
function records(value, name) {
  if (!Array.isArray(value)) throw Error(`備份的 ${name} 格式不正確。`);
  for (const item of value)
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.id !== "string" ||
      !item.id ||
      item.id.length > 240
    )
      throw Error(`備份的 ${name} 含無效記錄。`);
  return value;
}
function cleanStores(data, names) {
  const clean = {};
  for (const name of names)
    clean[name] = records(data[name] || [], name).filter(
      (item) => name !== "settings" || item.id !== "active-activity",
    );
  return clean;
}
function mapReferences(data) {
  return [...(data.maps || []), ...(data.areas || [])].map(({id,name,bounds,size,packageVersion}) => ({id,name,bounds,size,packageVersion}));
}
export function createBackup(data, now = Date.now(), options = {}) {
  const clean = cleanStores(data, personalStores);
  clean.maps = [];
  clean.areas = [];
  clean.geopdfs = options.includeGeoPdfs === false ? [] : records(data.geopdfs || [], "geopdfs");
  const backup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    created: new Date(now).toISOString(),
    appVersion: "4.0.0-beta.7",
    data: clean,
    offline: {
      packages: records(options.packages || [], "packages").map(({id,version,name,bounds}) => ({id,version,name,bounds})),
      legacyMaps: mapReferences(data),
      note: "官方地圖檔不在備份內；還原後可按清單重新下載。",
    },
  };
  if (jsonSize(backup) > MAX_BACKUP_BYTES)
    throw Error("備份超過 300 MB；請關閉 GeoPDF 備份或先刪除不需要的 GeoPDF。");
  return backup;
}
export function validateBackup(value) {
  if (
    !value ||
    value.format !== BACKUP_FORMAT ||
    ![1, BACKUP_VERSION].includes(value.version) ||
    !value.data
  )
    throw Error("不是受支援的 Trail Pocket 備份。");
  const clean = cleanStores(value.data, stores);
  const result = { ...value, data: clean, offline: value.version === 1 ? {packages:[],legacyMaps:[]} : {
    packages: records(value.offline?.packages || [], "packages"),
    legacyMaps: records(value.offline?.legacyMaps || [], "legacyMaps"),
    note: value.offline?.note || "",
  } };
  if (jsonSize(result) > MAX_BACKUP_BYTES)
    throw Error("備份超過 300 MB，為保護裝置記憶體已停止。");
  return result;
}
export function backupCounts(backup) {
  return Object.fromEntries(
    stores.map((name) => [name, backup.data[name].length]),
  );
}
