import { distance } from "./core.mjs";

const count = (value) => (Array.isArray(value) ? value.length : -1);
const roundedBounds = (b = {}) =>
  [b.west, b.south, b.east, b.north]
    .map((v) => (Number.isFinite(v) ? Number(v).toFixed(6) : "?"))
    .join("|");

export function createIntegrityManifest(record) {
  const manifest = {
    version: 1,
    packageVersion: record.packageVersion,
    bounds: roundedBounds(record.bounds),
    elements: count(record.data?.elements),
    contours: count(record.contours),
    searchEntries: count(record.searchIndex),
    routingNodes: count(record.routingGraph?.nodes),
    routingEdges: count(record.routingGraph?.edges),
    parts: Number.isFinite(record.parts) ? record.parts : 0,
  };
  manifest.signature = Object.values(manifest).join(":");
  return manifest;
}

export function verifyOfflineRecord(record) {
  if (!record?.bounds || record.packageVersion < 3 || !record.integrity)
    return { ok: false, reason: "舊版或缺少完整性資料" };
  const actual = createIntegrityManifest(record);
  if (actual.signature !== record.integrity.signature)
    return { ok: false, reason: "下載內容與完整性清單不一致" };
  if (actual.elements < 0 || actual.contours < 0 || actual.searchEntries < 0)
    return { ok: false, reason: "離線圖層或搜尋索引缺失" };
  if (actual.routingNodes < 0 || actual.routingEdges < 0)
    return { ok: false, reason: "步道路網缺失" };
  return { ok: true, manifest: actual };
}

export function pointInBounds(point, bounds) {
  return Boolean(
    bounds &&
      point &&
      point[0] >= bounds.west &&
      point[0] <= bounds.east &&
      point[1] >= bounds.south &&
      point[1] <= bounds.north,
  );
}

export function coverageStatus(point, records = [], warningMetres = 250) {
  const containing = records.filter((r) => pointInBounds(point, r.bounds));
  if (!containing.length) return { state: "outside", distance: 0 };
  let best = 0;
  for (const { bounds: b } of containing) {
    const edge = Math.min(
      distance(point, [b.west, point[1]]),
      distance(point, [b.east, point[1]]),
      distance(point, [point[0], b.south]),
      distance(point, [point[0], b.north]),
    );
    best = Math.max(best, edge);
  }
  return {
    state: best <= warningMetres ? "edge" : "inside",
    distance: Math.round(best),
  };
}

export function routeCoverage(segments = [], records = []) {
  const points = segments.flat();
  if (!points.length) return { covered: false, missing: 0, total: 0 };
  const missing = points.filter((point) => !records.some((r) => pointInBounds(point, r.bounds))).length;
  return { covered: missing === 0, missing, total: points.length };
}

export function gpsQuality(fix, active, now = Date.now()) {
  if (!active) return { state: "off", label: "GPS 已停止" };
  if (!fix) return { state: "waiting", label: "正在等候 GPS" };
  const age = Math.max(0, Math.round((now - fix.timestamp) / 1000));
  if (age > 20) return { state: "stale", age, label: `位置已過時 · ${age} 秒前` };
  const accuracy = Math.round(fix.coords.accuracy);
  if (accuracy > 50)
    return { state: "poor", age, accuracy, label: `GPS 較弱 · ±${accuracy} m` };
  if (accuracy > 20)
    return { state: "fair", age, accuracy, label: `GPS 一般 · ±${accuracy} m` };
  return { state: "good", age, accuracy, label: `GPS 良好 · ±${accuracy} m` };
}

export function gpsAltitude(fix, maxAccuracy = 30) {
  const altitude = fix?.coords?.altitude,
    accuracy = fix?.coords?.altitudeAccuracy;
  if (!Number.isFinite(altitude) || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > maxAccuracy)
    return null;
  return { metres: Math.round(altitude), accuracy: Math.round(accuracy) };
}
