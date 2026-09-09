const FEATURED_REGIONS = [
  { id: "para-wirra", name: "Para Wirra Conservation Park", places: "Devils Nose、South Para Grand Hike", bounds: { west: 138.78, south: -34.735, east: 138.91, north: -34.60 } },
  { id: "belair", name: "Belair National Park", places: "Waterfall Hike、Upper Waterfall", bounds: { west: 138.61, south: -35.04, east: 138.69, north: -34.975 } },
  { id: "morialta", name: "Morialta Conservation Park", places: "First Falls、Deep View Lookout", bounds: { west: 138.68, south: -35.005, east: 138.76, north: -34.88 } },
  { id: "alligator-gorge", name: "Alligator Gorge", places: "Ring Route、The Narrows", bounds: { west: 138.03, south: -32.82, east: 138.16, north: -32.66 } },
  { id: "cleland", name: "Cleland National Park", places: "Mount Lofty、Waterfall Gully", bounds: { west: 138.675, south: -35.035, east: 138.755, north: -34.93 } },
  { id: "onkaparinga", name: "Onkaparinga River National Park", places: "Punchbowl、Sundews Ridge", bounds: { west: 138.52, south: -35.19, east: 138.64, north: -35.115 } },
];

const PARK_CACHE_KEY = "trail-pocket:sa-parks:v1";
const PARKS_URL = "https://location.sa.gov.au/arcgis/rest/services/BaseMaps/Topographic_wmas/MapServer/31/query?where=1%3D1&outFields=resname%2Crestype%2Cresnametype%2Cuniqueid&returnGeometry=true&outSR=4326&resultRecordCount=1000&f=geojson";
const TYPE_NAMES = {
  NP: "National Park",
  CP: "Conservation Park",
  RP: "Recreation Park",
  RR: "Regional Reserve",
  GR: "Game Reserve",
  CR: "Conservation Reserve",
  WA: "Wilderness Protection Area",
};

function savedCatalog() {
  if (typeof localStorage === "undefined") return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(PARK_CACHE_KEY) || "null");
    return Array.isArray(parsed) && parsed.length > 100 ? parsed : null;
  } catch {
    return null;
  }
}

function storeCatalog(regions) {
  if (typeof localStorage === "undefined") return;
  try { localStorage.setItem(PARK_CACHE_KEY, JSON.stringify(regions)); } catch {}
}

function geometryBounds(geometry) {
  const box = { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity };
  const visit = value => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])) {
      box.west = Math.min(box.west, value[0]);
      box.east = Math.max(box.east, value[0]);
      box.south = Math.min(box.south, value[1]);
      box.north = Math.max(box.north, value[1]);
      return;
    }
    for (const item of value) visit(item);
  };
  visit(geometry?.coordinates);
  return Number.isFinite(box.west) ? box : null;
}

function padded(bounds) {
  const dx = Math.max(0.006, (bounds.east - bounds.west) * 0.04);
  const dy = Math.max(0.006, (bounds.north - bounds.south) * 0.04);
  return {
    west: bounds.west - dx,
    south: bounds.south - dy,
    east: bounds.east + dx,
    north: bounds.north + dy,
  };
}

function officialCatalog(geojson) {
  const grouped = new Map();
  for (const feature of geojson?.features || []) {
    const p = feature.properties || {};
    const name = String(p.resnametype || p.RESNAMETYPE || "").trim() ||
      [p.resname || p.RESNAME, TYPE_NAMES[p.restype || p.RESTYPE]].filter(Boolean).join(" ").trim();
    const b = geometryBounds(feature.geometry);
    if (!name || !b) continue;
    const key = String(p.uniqueid || p.UNIQUEID || name).toLocaleLowerCase();
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, {
        id: `sa-park-${String(p.uniqueid || p.UNIQUEID || name).toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
        name,
        places: TYPE_NAMES[p.restype || p.RESTYPE] || p.restype || p.RESTYPE || "South Australia park / reserve",
        bounds: b,
        official: true,
      });
    } else {
      current.bounds.west = Math.min(current.bounds.west, b.west);
      current.bounds.south = Math.min(current.bounds.south, b.south);
      current.bounds.east = Math.max(current.bounds.east, b.east);
      current.bounds.north = Math.max(current.bounds.north, b.north);
    }
  }
  return [...grouped.values()].map(r => ({ ...r, bounds: padded(r.bounds) })).sort((a,b) => a.name.localeCompare(b.name));
}

const initial = savedCatalog() || FEATURED_REGIONS;
export const OFFLINE_REGIONS = [...initial];
let loading = null;

export async function refreshOfflineRegions() {
  if (loading) return loading;
  if (typeof fetch === "undefined") return OFFLINE_REGIONS;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return OFFLINE_REGIONS;
  loading = (async () => {
    const aborter = new AbortController();
    const timer = setTimeout(() => aborter.abort(), 7000);
    try {
      const response = await fetch(PARKS_URL, { cache: "no-store", signal: aborter.signal });
      if (!response.ok) throw Error(`Park catalog HTTP ${response.status}`);
      const catalog = officialCatalog(await response.json());
      if (catalog.length < 100) throw Error("Official park catalog incomplete");
      const known = new Set(catalog.map(r => r.name.toLocaleLowerCase()));
      const extras = FEATURED_REGIONS.filter(r => !known.has(r.name.toLocaleLowerCase()));
      const merged = [...extras, ...catalog];
      OFFLINE_REGIONS.splice(0, OFFLINE_REGIONS.length, ...merged);
      storeCatalog(merged);
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("trail:parks-changed", { detail: { count: merged.length } }));
      return OFFLINE_REGIONS;
    } catch (error) {
      console.warn("Trail Pocket official SA park catalog unavailable", error);
      return OFFLINE_REGIONS;
    } finally {
      clearTimeout(timer);
      loading = null;
    }
  })();
  return loading;
}

if (typeof window !== "undefined") {
  setTimeout(() => refreshOfflineRegions().catch(() => {}), 0);
  window.addEventListener("online", () => refreshOfflineRegions().catch(() => {}));
}

export function filterRegions(regions, query = "") {
  const key = String(query).trim().toLocaleLowerCase();
  if (!key) return regions;
  return regions.filter((r) => `${r.name} ${r.places || ""}`.toLocaleLowerCase().includes(key));
}
