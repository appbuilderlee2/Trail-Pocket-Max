import { setupUnifiedUI } from "./unified-ui.mjs";
import { compassReading, chooseHeading } from "./heading.mjs";
import {
  parseRoute,
  routeLength,
  bufferedBounds,
  areaKm2,
  validateMap,
  nearestDistance,
  project,
} from "./core.mjs";
import * as store from "./storage.mjs";
import { TrailMap } from "./map.mjs";
import { setupAdventure } from "./adventure.mjs";
import { setupActivity } from "./activity.mjs";
import { setupExplore } from "./explore.mjs";
import { setupGeoPdf } from "./geopdf.mjs";
import { downloadContours } from "./terrain.mjs";
import {
  downloadOsmInChunks,
  assertStorageRoom,
  PACKAGE_LIMIT_BYTES,
} from "./offline-download.mjs";
import {
  createBackup,
  validateBackup,
  backupCounts,
  MAX_BACKUP_BYTES,
} from "./backup.mjs";
import { buildOfflinePackage } from "./offline-package.mjs";
import {
  createIntegrityManifest,
  verifyOfflineRecord,
  coverageStatus,
  routeCoverage,
  gpsQuality,
  gpsAltitude,
} from "./reliability-core.mjs";
import { setupMarkers } from "./markers.mjs";
import { setupPackageManager } from "./package-manager.mjs";
const $ = (id) => document.getElementById(id),
  BASE = new URL("./", import.meta.url),
  jobs = new Map(),
  messages = new Map();
let routes = [],
  metas = new Map(),
  selected = null,
  selectedMap = null,
  currentView = "routes",
  currentTab = "saved",
  shellReady = false,
  reg = null,
  toastTimer,
  watch = null,
  fix = null,
  follow = true,
  storeOK = false,
  selectSerial = 0,
  lastCoverageState = "none",
  trackingState = "";
const map = new TrailMap($("map"), () => {
  follow = false;
  $("follow").classList.remove("selected");
});
function node(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
function button(label, cls, fn) {
  const b = node("button", cls, label);
  b.onclick = fn;
  return b;
}
function formatSize(n) {
  return n >= 1048576
    ? (n / 1048576).toFixed(1) + " MB"
    : Math.max(1, Math.round(n / 1024)) + " KB";
}
function mapDetail(m) {
  if (m?.packageVersion >= 3 && m.integrity)
    return `已驗證完整圖層、${m.stats?.searchEntries || 0} 個搜尋項目及步道路網${m.terrain?.optional ? "；快速包不含等高線" : "及等高線"}`;
  if (m?.packageVersion >= 2)
    return "舊版完整包；請重新下載以加入儲存完整性核對";
  if (m?.terrain) return "舊版建築物、地標及等高線；重載可加入搜尋及步道路網";
  if (m?.detailLevel === "建築物及地標") return "建築物及地標；無等高線";
  return "舊版基本地形；請重新下載";
}
function toast(t) {
  clearTimeout(toastTimer);
  $("toast").textContent = t;
  $("toast").classList.remove("hide");
  toastTimer = setTimeout(() => $("toast").classList.add("hide"), 6000);
}
function failure(e) {
  return e?.name === "QuotaExceededError"
    ? "裝置空間不足，未能儲存。請刪除唔需要嘅離線底圖。"
    : e?.message || "操作未能完成，請重試。";
}
function setBanner(t) {
  $("banner").textContent = t;
  $("banner").classList.toggle("hide", !t);
}
function network() {
  $("network").textContent = navigator.onLine ? "● 目前在線" : "○ 目前離線";
  if (currentView === "map") mapBadge();
}
function nav(name, tab = name === "routes" ? "saved" : name === "map" ? "explore" : name) {
  if (adventure.isEditing() && name !== "map") {
    toast("請先儲存或取消自訂路線編輯。");
    return;
  }
  if (name !== "map" && map.previewBounds) {
    map.setPreviewBounds(null);
    $("previewBoundsFrame")?.classList.add("hide");
  }
  currentView = name;
  currentTab = ["routes", "offline", "history", "markers"].includes(name) ? "saved" : tab;
  for (const n of ["routes", "map", "offline", "history", "markers", "settings"])
    $(n + "View").classList.toggle("hide", n !== name);
  document
    .querySelectorAll("nav button")
    .forEach((b) => b.classList.toggle("active", b.dataset.tab === currentTab));
  if (name === "map") {
    requestAnimationFrame(() => {
      map.resize();
      mapBadge();
    });
  }
  if (name === "offline" || name === "settings") storageInfo();
  window.dispatchEvent(new CustomEvent("trail:view", {detail:name}));
  explore.viewChanged();
  window.scrollTo({ top: 0 });
}
function clearOfflineBoundsPreview() {
  map.setPreviewBounds?.(null);
  $("previewBoundsFrame")?.classList.add("hide");
}
function previewOfflineBounds(rawBounds, name = "離線地圖範圍") {
  const bounds = Array.isArray(rawBounds)
    ? { west: rawBounds[0], south: rawBounds[1], east: rawBounds[2], north: rawBounds[3] }
    : rawBounds;
  if (!bounds || ![bounds.west,bounds.south,bounds.east,bounds.north].every(Number.isFinite)) {
    toast("未能讀取呢個離線地圖範圍。");
    return;
  }
  follow = false;
  $("follow").classList.remove("selected");
  nav("map");
  requestAnimationFrame(() => {
    map.resize();
    map.setPreviewBounds(bounds, name);
    map.fitBounds(bounds);
    let bar = $("previewBoundsFrame");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "previewBoundsFrame";
      bar.className = "preview-bounds-toolbar";
      bar.innerHTML = '<span><b>離線範圍預覽</b><small id="previewBoundsLabel"></small></span><button id="closeBoundsPreview">返回離線下載</button>';
      document.querySelector(".map-wrap")?.append(bar);
      $("closeBoundsPreview").onclick = () => { clearOfflineBoundsPreview(); nav("offline"); };
    }
    $("previewBoundsLabel").textContent = `${name} · 綠框內先係實際可離線範圍`;
    bar.classList.remove("hide");
    $("mapTitle").textContent = name;
    $("mapMeta").textContent = "綠框跟隨真實經緯度 · 可拖動及縮放地圖查看";
    $("mapBadge").classList.add("hide");
  });
}
function mini(route) {
  const box = node("div", "mini"),
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 340 145");
  svg.setAttribute("aria-hidden", "true");
  const ps = route.segments.map((s) => s.map(project));
  let minx = Infinity,
    miny = Infinity,
    maxx = -Infinity,
    maxy = -Infinity;
  for (const p of ps.flat()) {
    minx = Math.min(minx, p[0]);
    maxx = Math.max(maxx, p[0]);
    miny = Math.min(miny, p[1]);
    maxy = Math.max(maxy, p[1]);
  }
  const scale = Math.min(
      275 / Math.max(1, maxx - minx),
      108 / Math.max(1, maxy - miny),
    ),
    cx = (minx + maxx) / 2,
    cy = (miny + maxy) / 2;
  for (const s of ps) {
    const d = s
      .map(
        (p, i) =>
          (i ? "L" : "M") +
          (170 + (p[0] - cx) * scale).toFixed(2) +
          "," +
          (72 + (p[1] - cy) * scale).toFixed(2),
      )
      .join(" ");
    for (const [color, w] of [
      ["white", 7],
      ["#4e875d", 3.5],
    ]) {
      const path = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      for (const [k, v] of Object.entries({
        d,
        fill: "none",
        stroke: color,
        "stroke-width": w,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      }))
        path.setAttribute(k, v);
      svg.append(path);
    }
  }
  box.append(svg, node("span", "chip", route.count.toLocaleString() + " 點"));
  return box;
}
function renderRoutes() {
  $("routeList").replaceChildren();
  $("empty").classList.toggle("hide", routes.length > 0);
  const query = $("routeSearch").value.trim().toLocaleLowerCase();
  const matching = routes.filter(r => r.name.toLocaleLowerCase().includes(query));
  matching.sort((a,b) => $("routeSort").value === "distance" ? a.length-b.length : $("routeSort").value === "offline" ? Number(metas.has(b.id))-Number(metas.has(a.id)) || a.name.localeCompare(b.name) : a.name.localeCompare(b.name));
  $("routeSearchEmpty").classList.toggle("hide", !routes.length || matching.length > 0);
  for (const r of matching) {
    const card = node("article", "route-card");
    card.append(mini(r));
    const body = node("div", "route-body");
    body.append(node("h2", "", r.name));
    const facts = node("div", "facts");
    facts.append(
      node("b", "", (r.length / 1000).toFixed(2)),
      document.createTextNode(" km 軌跡 · " + r.segments.length + " 段"),
    );
    body.append(facts);
    const meta = node("div", "route-meta"),
      m = metas.get(r.id);
    meta.append(
      node(
        "span",
        "status-pill" + (m ? "" : " pending"),
        m ? "↓ 底圖已下載" : "只有路線 · 未下載底圖",
      ),
    );
    if (m) meta.append(node("small", "muted", formatSize(m.size)));
    body.append(meta);
    const actions = node("div", "card-actions");
    actions.append(
      button("開啟地圖", "primary", () => selectRoute(r.id)),
      button("離線設定", "", () => {
        nav("offline");
        document
          .getElementById("dl-" + r.id)
          ?.scrollIntoView({ block: "center" });
      }),
    );
    const del = button("×", "small", () => deleteRoute(r));
    del.setAttribute("aria-label", "刪除 " + r.name);
    del.disabled = jobs.has(r.id);
    actions.append(del);
    const more = document.createElement("details");
    more.className = "row-more";
    const summary = document.createElement("summary");
    summary.textContent = "更多";
    more.append(summary);
    const options = document.createElement("div");
    for (const b of [...actions.children].slice(1)) options.append(b);
    more.append(options); actions.append(more);
    body.append(actions);
    card.append(body);
    $("routeList").append(card);
  }
}
function renderDownloads() {
  $("downloadList").replaceChildren();
  $("downloadEmpty").classList.toggle("hide", routes.length > 0);
  for (const r of routes) {
    const card = node("article", "download-card");
    card.id = "dl-" + r.id;
    card.append(node("h2", "", r.name));
    const m = metas.get(r.id);
    card.append(
      node(
        "p",
        "muted",
        m
          ? "已儲存 " +
              formatSize(m.size) +
              " · " +
              new Date(m.downloaded).toLocaleDateString() +
              " · 周邊 " +
              m.buffer / 1000 +
              " km · " +
              mapDetail(m)
          : "GPX／KML 已儲存，底圖尚未下載。",
      ),
    );
    const row = node("div", "row"),
      label = node("label", "", "周邊範圍 "),
      select = node("select");
    select.setAttribute("aria-label", r.name + " 下載範圍");
    for (const [v, t] of [
      [500, "500 m"],
      [1000, "1 km"],
      [2000, "2 km"],
      [5000, "5 km"],
    ]) {
      const o = node("option", "", t);
      o.value = v;
      o.selected = (r.buffer || 1000) === v;
      select.append(o);
    }
    select.disabled = jobs.has(r.id);
    select.onchange = async () => {
      const old = r.buffer;
      r.buffer = Number(select.value);
      try {
        await store.put("routes", r);
        renderDownloads();
      } catch (e) {
        r.buffer = old;
        select.value = old;
        toast(failure(e));
      }
    };
    label.append(select);
    row.append(label);
    if (jobs.has(r.id))
      row.append(button("取消下載", "", () => jobs.get(r.id)?.abort()));
    else
      row.append(
        button(m ? "重新下載" : "下載底圖", "primary", () => download(r)),
      );
    if (m) {
      const del = button("刪除底圖", "", () => deleteMap(r));
      del.disabled = jobs.has(r.id);
      row.append(del);
    }
    card.append(row);
    const status = node("div", "dlstatus");
    status.id = "status-" + r.id;
    const area = areaKm2(bufferedBounds(r.segments, r.buffer || 1000));
    status.textContent =
      messages.get(r.id) ||
      (m
        ? (shellReady
            ? "✓ 路線、底圖及已下載圖層可離線使用"
            : "底圖已儲存；App 離線安裝仍需確認") +
          (m.buffer !== (r.buffer || 1000) ? "。新選擇範圍尚未下載。" : "")
        : "預計涵蓋 " +
          area.toFixed(1) +
          ` km²；快速包包括建築物、地標、搜尋及步道路網${$("downloadContours").checked ? "，並加入 20 m 等高線" : ""}。`);
    if (status.textContent.startsWith("下載失敗"))
      status.classList.add("error");
    card.append(status);
    $("downloadList").append(card);
  }
}
async function refresh() {
  routes = (await store.getAll("routes")).sort((a, b) => b.created - a.created);
  metas = new Map((await store.listMapMeta()).map((m) => [m.id, m]));
  renderRoutes();
  renderDownloads();
  storageInfo();
  await explore.refresh();
}
function mapBadge() {
  if (geoPdf.isOpen() && !geoPdf.isOverlay()) return;
  $("mapTitle").textContent = selected?.name || "瀏覽地圖";
  $("mapMeta").textContent = selected
    ? (selected.length / 1000).toFixed(2) +
      " km 檔案軌跡 · " +
      selected.count +
      " 點"
    : "毋須路線 · 自由瀏覽及框選離線地區";
  $("mapBadge").classList.toggle("hide", !selected);
  const coverage = selected ? routeCoverage(selected.segments, explore?.coverageRecords?.() || []) : null;
  $("mapBadge").textContent = selected
    ? "實線：目前路線 · " +
      (coverage?.covered ? "全程在已下載範圍" : metas.has(selected.id) ? "部分軌跡可能超出離線範圍" : "路線底圖未下載")
    : " ";
  for (const b of document.querySelectorAll("[data-route-required]"))
    b.disabled = !selected;
  $("mapOptions").disabled = !selected;
}
async function selectRoute(id) {
  const serial = ++selectSerial;
  try {
    const r = await store.get("routes", id);
    if (!r) return;
    const b = await store.get("maps", id);
    if (serial !== selectSerial) return;
    selected = r;
    selectedMap = b || null;
    adventure.routeChanged();
    nav("map");
    requestAnimationFrame(() => {
      map.resize();
      map.setRoute(r, b);
      mapBadge();
      gpsStatus();
    });
  } catch (e) {
    toast(failure(e));
  }
}
async function importFiles(files) {
  if (!storeOK) {
    toast("本機儲存未就緒，請先處理頁面頂部提示。");
    return;
  }
  let success = 0,
    errors = [];
  for (const f of files) {
    try {
      if (f.size > 25 * 1024 * 1024) throw Error("檔案超過 25 MB。");
      if (!/\.(gpx|kml)$/i.test(f.name)) throw Error("請使用 GPX 或 KML。");
      const r = parseRoute(await f.text(), f.name);
      if (/^Devils-Nose-Hike-updated-2018\.(gpx|kml)$/i.test(f.name))
        r.note =
          "已知原始網頁列出 4.4 km 來回，但此檔案軌跡約 2.95 km，兩者不一致。請確認實際起點及回程。";
      await store.put("routes", r);
      success++;
    } catch (e) {
      errors.push(f.name + "：" + failure(e));
    }
  }
  await refresh();
  nav("routes");
  toast(
    "已匯入 " +
      success +
      " 條路線。" +
      (errors.length ? " " + errors.join("；") : ""),
  );
}
async function demo() {
  $("demo").disabled = true;
  try {
    if (!storeOK) throw Error("本機儲存未就緒。");
    const a = await fetch(new URL("assets/devils-route.json", BASE)),
      b = await fetch(new URL("assets/devils-base.json", BASE));
    if (!a.ok || !b.ok) throw Error("未能載入示範資料，請先連線開啟一次。");
    const original = await a.json(),
      data = validateMap(await b.json()),
      id = "demo-devils-nose",
      route = {
        ...original,
        id,
        created: Date.now(),
        length: routeLength(original.segments),
        count: original.segments.flat().length,
        buffer: 1000,
        sourceName: "Walking SA uploaded GPX / KML",
        note: "Walking SA 網頁列出 4.4 km 來回，但提供嘅 GPX／KML 軌跡約 2.95 km，兩者不一致。The Knob Lookout 是離開此軌跡嘅原檔標記。",
      },
      extra = buildOfflinePackage(data);
    const basemap = {
      id,
      data,
      ...extra,
      bounds: { west: 138.803, south: -34.705, east: 138.843, north: -34.661 },
      buffer: 1000,
      detailLevel: "完整離線圖層、搜尋及步道路網",
      downloaded: new Date("2026-09-03T00:00:00Z").getTime(),
    };
    basemap.integrity = createIntegrityManifest(basemap);
    basemap.size = new Blob([JSON.stringify(basemap)]).size;
    await store.importDemo(route, basemap);
    await refresh();
    await selectRoute(id);
    toast("示範路線及離線底圖已儲存。");
  } catch (e) {
    toast(failure(e));
  } finally {
    $("demo").disabled = false;
  }
}
function setDownloadStatus(id, t) {
  messages.set(id, t);
  const n = $("status-" + id);
  if (n) n.textContent = t;
}
async function download(route) {
  if (jobs.size) {
    toast("請等目前下載完成，或先取消。");
    return;
  }
  if (!navigator.onLine) {
    toast("目前離線。請連線後下載底圖。");
    return;
  }
  let bounds;
  try {
    bounds = bufferedBounds(route.segments, route.buffer || 1000);
  } catch (e) {
    toast(failure(e));
    return;
  }
  const controller = new AbortController();
  jobs.set(route.id, controller);
  setDownloadStatus(route.id, "正在準備分區下載…");
  renderDownloads();
  renderRoutes();
  const timer = setTimeout(() => controller.abort("timeout"), 600000);
  try {
    const osm = await downloadOsmInChunks(bounds, {
        signal: controller.signal,
        onProgress: (p) =>
          setDownloadStatus(
            route.id,
            `正在下載地圖分區 ${p.index}/${p.total}${p.endpoint > 1 ? "（備用服務）" : ""} · ${formatSize(p.transferred)}…`,
          ),
      }),
      data = osm.data;
    if (controller.signal.aborted) throw Error("已取消下載。");
    setDownloadStatus(route.id, "正在建立離線搜尋及步道路網…");
    const extra = buildOfflinePackage(data);
    const includeContours = $("downloadContours").checked;
    setDownloadStatus(route.id, includeContours ? "正在下載及產生 20 m 等高線…" : "正在完成快速離線包…");
    const terrainResult = includeContours
      ? await downloadContours(bounds, {
          signal: controller.signal,
          onProgress: (p) => setDownloadStatus(route.id, `正在下載高程 ${p.done}/${p.total}…`),
        })
      : { contours: [], terrain: { source: "快速離線包", optional: true, interval: null } },
      record = {
        id: route.id,
        bounds,
        buffer: route.buffer || 1000,
        data,
        ...extra,
        contours: terrainResult.contours,
        terrain: terrainResult.terrain,
        parts: osm.parts,
        detailLevel: "完整離線圖層、搜尋及步道路網",
        downloaded: Date.now(),
      };
    record.integrity = createIntegrityManifest(record);
    record.size = new Blob([JSON.stringify(record)]).size;
    if (record.size > PACKAGE_LIMIT_BYTES)
      throw Error("完整離線地圖連搜尋及步道路網超過 128 MB，請縮小範圍。");
    await assertStorageRoom(record.size);
    setDownloadStatus(route.id, "下載完成，正在安全寫入裝置…");
    setDownloadStatus(route.id, "正在讀回並核對完整性…");
    await store.putVerified("maps", record, (saved) => verifyOfflineRecord(saved).ok);
    messages.delete(route.id);
    if (selected?.id === route.id) {
      selectedMap = record;
      map.setBase(record);
    }
    toast("「" + route.name + `」${includeContours ? "完整" : "快速"}離線地圖、搜尋及步道路網已儲存。`);
  } catch (e) {
    const cancelled =
      controller.signal.aborted && controller.signal.reason !== "timeout";
    messages.set(
      route.id,
      cancelled
        ? "已取消下載。既有底圖（如有）仍然保留。"
        : "下載失敗：" +
            (controller.signal.reason === "timeout"
              ? "下載超過 10 分鐘，請稍後重試或縮小範圍。"
              : failure(e)) +
            (metas.has(route.id) ? " 既有底圖仍然保留。" : ""),
    );
  } finally {
    clearTimeout(timer);
    jobs.delete(route.id);
    await refresh();
    mapBadge();
  }
}
function ask(title, text, accept = "確認", danger = false) {
  return new Promise((resolve) => {
    $("confirmTitle").textContent = title;
    $("confirmText").textContent = text;
    $("acceptConfirm").textContent = accept;
    $("acceptConfirm").classList.toggle("danger", danger);
    const d = $("confirm");
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      d.close();
      d.oncancel = null;
      resolve(v);
    };
    $("cancelConfirm").onclick = () => finish(false);
    $("acceptConfirm").onclick = () => finish(true);
    d.oncancel = (e) => {
      e.preventDefault();
      finish(false);
    };
    d.showModal();
  });
}
async function deleteRoute(r) {
  if (jobs.has(r.id)) {
    toast("請先取消下載。");
    return;
  }
  if (
    !(await ask(
      "刪除呢條路線？",
      "「" +
        r.name +
        "」及其離線底圖會從呢部裝置刪除。原始 GPX／KML 檔案不受影響。",
      "刪除",
      true,
    ))
  )
    return;
  try {
    await store.removeRoute(r.id);
    if (selected?.id === r.id) {
      selected = null;
      selectedMap = null;
      map.setRoute(null, null);
      if (currentView === "map") nav("routes");
    }
    await refresh();
    toast("路線已刪除。");
  } catch (e) {
    toast(failure(e));
  }
}
async function deleteMap(r) {
  if (jobs.has(r.id)) return;
  if (
    !(await ask(
      "刪除離線底圖？",
      "保留「" + r.name + "」嘅路線。下次需要連線重新下載底圖。",
      "刪除",
      true,
    ))
  )
    return;
  try {
    await store.removeMap(r.id);
    messages.delete(r.id);
    if (selected?.id === r.id) {
      selectedMap = null;
      map.setBase(null);
    }
    await refresh();
    mapBadge();
    toast("底圖已刪除，路線已保留。");
  } catch (e) {
    toast(failure(e));
  }
}
function details() {
  if (!selected) return;
  const r = selected,
    c = $("detailsContent");
  $("detailsTitle").textContent = r.name;
  c.replaceChildren();
  const label = node("label", "", "路線名稱"),
    input = node("input");
  input.value = r.name;
  input.maxLength = 160;
  input.setAttribute("aria-label", "路線名稱");
  c.append(
    label,
    input,
    button("儲存名稱", "", async () => {
      const name = input.value.trim();
      if (!name) {
        toast("請輸入路線名稱。");
        return;
      }
      try {
        const latest = await store.get("routes", r.id);
        if (!latest) throw Error("路線已被刪除。");
        await store.put("routes", { ...latest, name });
        selected = { ...latest, name };
        await refresh();
        mapBadge();
        $("detailsTitle").textContent = name;
        toast("名稱已儲存。");
      } catch (e) {
        toast(failure(e));
      }
    }),
  );
  c.append(
    node(
      "p",
      "muted",
      (r.length / 1000).toFixed(2) + " km 檔案軌跡，未必等於完整來回行程。",
    ),
  );
  if (r.note) c.append(node("p", "notice", r.note));
  c.append(node("h3", "", "路線標記"));
  if (!r.waypoints.length) c.append(node("p", "muted", "呢個檔案冇獨立標記。"));
  r.waypoints.forEach((w, i) =>
    c.append(
      button(
        i +
          1 +
          ". " +
          w.name +
          " · " +
          w.point[1].toFixed(5) +
          ", " +
          w.point[0].toFixed(5),
        "waypoint",
        () => {
          $("details").close();
          follow = false;
          map.focus(w.point);
        },
      ),
    ),
  );
  c.append(node("p", "fineprint", "來源檔案：" + r.sourceName));
  $("details").showModal();
}
function emergencyStatus() {
  const coords = $("emergencyCoords"),
    meta = $("emergencyMeta"),
    copy = $("copyPosition");
  if (!fix) {
    coords.textContent = "等待 GPS 定位";
    meta.textContent = "不會自動聯絡救援服務";
    copy.disabled = true;
    return;
  }
  const age = Math.max(0, Math.round((Date.now() - fix.timestamp) / 1000)),
    lat = fix.coords.latitude.toFixed(5),
    lon = fix.coords.longitude.toFixed(5);
  coords.textContent = lat + ", " + lon;
  const height = gpsAltitude(fix),
    altitude = height ? ` · 海拔 ${height.metres} m（垂直 ±${height.accuracy} m）` : " · 暫未有可靠高度";
  meta.textContent = `精度 ±${Math.round(fix.coords.accuracy)} m${altitude} · ${age} 秒前更新 · 不會自動求救`;
  copy.disabled = false;
  copy.dataset.position =
    lat + ", " + lon + `（精度 ±${Math.round(fix.coords.accuracy)} m）`;
}
let compassFix = null, compassEnabled = false, compassMessage = "", lastDirection = "";
function directionStatus() {
  const heading = chooseHeading(fix, compassFix);
  const key = heading ? `${heading.source}:${heading.bearing}` : "none";
  if (key !== lastDirection) { lastDirection = key; map.draw(); }
  const quality = gpsQuality(fix, watch !== null),
    coverage = fix ? coverageStatus([fix.coords.longitude, fix.coords.latitude], explore?.coverageRecords?.() || []) : null,
    range = coverage?.state === "edge" ? ` · 離線邊界 ${coverage.distance}m` : coverage?.state === "outside" && explore?.usesOffline?.() ? " · 已離開下載範圍" : "",
    state = quality.label + range;
  const label = heading ? `${heading.source === "course" ? "行進" : "朝向"} ${Math.round(heading.bearing)}°` : "方向未確認",
    height = gpsAltitude(fix),
    altitude = height ? ` · 海拔 ${height.metres} m` : "";
  $("mapPositionStatus").textContent = state + " · " + label + altitude + (trackingState ? " · " + trackingState : "");
  $("mapPositionStatus").classList.toggle("position-warning", ["stale","poor"].includes(quality.state) || coverage?.state === "outside" || coverage?.state === "edge");
  $("compassStatus").textContent = compassMessage || (heading ? label + (heading.source === "compass" ? "（手機指南針，可能受磁場影響）" : "（GPS 行進方向，並非手機朝向）") : compassEnabled ? "等待可靠方向；請平放手機，遠離磁石。訊號過時會隱藏扇形。" : "行走時可顯示 GPS 行進方向；開啟指南針後可在停留時顯示手機朝向。");
}
function orientationChanged(event) {
  if (!compassEnabled || document.hidden) return;
  compassFix = compassReading(event, screen.orientation?.angle ?? window.orientation ?? 0);
  map.setCompass(compassFix);
  directionStatus();
}
function stopCompass() {
  compassEnabled = false; compassFix = null; compassMessage = "";
  window.removeEventListener("deviceorientation", orientationChanged);
  window.removeEventListener("deviceorientationabsolute", orientationChanged);
  map.setCompass(null);
  $("compassToggle").textContent = "開啟手機指南針";
  directionStatus();
}
async function toggleCompass() {
  if (compassEnabled) { stopCompass(); return; }
  compassMessage = "";
  const sensor = window.DeviceOrientationEvent;
  if (!sensor) { compassMessage = "此瀏覽器未提供指南針；可靠 GPS 行進方向仍可使用。"; directionStatus(); return; }
  try {
    if (typeof sensor.requestPermission === "function" && await sensor.requestPermission() !== "granted") {
      compassMessage = "未獲動作與方向權限；仍可使用 GPS 行進方向。"; directionStatus(); return;
    }
    compassEnabled = true;
    window.addEventListener("deviceorientation", orientationChanged);
    window.addEventListener("deviceorientationabsolute", orientationChanged);
    $("compassToggle").textContent = "停止手機指南針";
    directionStatus();
  } catch { compassMessage = "無法開啟指南針，請檢查瀏覽器權限。"; directionStatus(); }
}
function gpsStatus() {
  directionStatus();
  const quality = gpsQuality(fix, watch !== null);
  $("gpsStatus").dataset.quality = quality.state;
  if (!fix) {
    $("gpsStatus").textContent = quality.label;
    emergencyStatus();
    return;
  }
  const age = Math.max(0, Math.round((Date.now() - fix.timestamp) / 1000));
  const point = [fix.coords.longitude, fix.coords.latitude],
    coverage = coverageStatus(point, explore?.coverageRecords?.() || []);
  const coverageKey = explore?.usesOffline?.() ? coverage.state : "online";
  if (coverageKey !== lastCoverageState) {
    if (coverageKey === "edge") toast(`接近已下載地圖邊界，約剩 ${coverage.distance} m。`);
    if (coverageKey === "outside") toast("你已離開已下載地圖範圍；底圖及離線搜尋可能不完整。");
    lastCoverageState = coverageKey;
  }
  $("gpsStatus").textContent = quality.label +
    (age <= 20
      ?
        (selected
          ? " · 距軌跡約 " +
            Math.round(
              nearestDistance(point, selected.segments),
            ) +
            " m"
          : "") +
        (coverage.state === "edge"
          ? ` · 距離線地圖邊界約 ${coverage.distance} m`
          : coverage.state === "outside" && explore?.usesOffline?.()
            ? " · 已離開下載範圍"
            : "")
      : "");
  emergencyStatus();
  map.setFix(fix, follow && age <= 20);
  adventure.onFix(fix);
}
function stopGPS() {
  if (watch !== null) navigator.geolocation.clearWatch(watch);
  watch = null;
  fix = null;
  stopCompass();
  map.setFix(null);
  adventure.onFix(null);
  emergencyStatus();
  $("gps").textContent = "◎ 開始定位";
  $("follow").classList.remove("selected");
}
function gps() {
  if (activity.isRecording() && watch !== null) {
    toast("請先暫停或完成活動。");
    return;
  }
  if (watch !== null) {
    stopGPS();
    $("gpsStatus").textContent = "定位已停止。";
    return;
  }
  if (!isSecureContext || location.protocol === "file:") {
    $("gpsStatus").textContent = "請用 HTTPS 已部署網址開啟，再授權 GPS 定位。";
    return;
  }
  if (!navigator.geolocation) {
    $("gpsStatus").textContent = "此瀏覽器唔支援 GPS 定位。";
    return;
  }
  follow = true;
  $("follow").classList.add("selected");
  $("gps").textContent = "■ 停止定位";
  $("gpsStatus").textContent = "等候定位授權及 GPS 訊號…";
  watch = navigator.geolocation.watchPosition(
    (p) => {
      fix = p;
      gpsStatus();
      activity.onFix(p);
    },
    (e) => {
      activity.onError();
      if (e.code === 1) {
        stopGPS();
        $("gpsStatus").textContent = "未獲定位授權，請到瀏覽器設定允許定位。";
      } else
        $("gpsStatus").textContent =
          "暫時未能更新 GPS 位置，請到空曠位置再試。";
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
  );
}
async function storageInfo() {
  if (!navigator.storage?.estimate) return;
  try {
    const s = await navigator.storage.estimate();
    $("storageInfo").textContent =
      "此網站約佔 " +
      formatSize(s.usage || 0) +
      (s.quota ? "／配額 " + formatSize(s.quota) : "");
  } catch {}
}
async function offlineAudit() {
  if (!storeOK) {
    toast("本機儲存未就緒。");
    return;
  }
  $("audit").disabled = true;
  $("shellStatus").textContent = "正在讀回所有離線資料…";
  try {
    const records = [
      ...(await store.getAll("maps")),
      ...(await store.getAll("areas")),
    ];
    const geoPdfs = await store.getAll("geopdfs");
    const packageAudit = await packageManager.audit();
    if (!shellReady)
      throw Error("App 離線外殼未完整，請保持連線重新開啟一次。");
    if (!records.length && !geoPdfs.length && !packageAudit.checked)
      throw Error("未有離線地圖，請先下載需要範圍。");
    const bad = [];
    for (const record of records) {
      try {
        validateMap(record.data);
        if (
          !record.bounds ||
          !record.terrain ||
          !Array.isArray(record.contours) ||
          record.packageVersion < 3 ||
          !Array.isArray(record.searchIndex) ||
          !Array.isArray(record.routingGraph?.nodes) ||
          !Array.isArray(record.routingGraph?.edges) ||
          !verifyOfflineRecord(record).ok
        )
          throw Error();
      } catch {
        bad.push(
          record.name ||
            routes.find((r) => r.id === record.id)?.name ||
            "未命名地圖",
        );
      }
    }
    for (const item of geoPdfs) {
      if (!item.imageData || !item.transform?.matrix || !item.transform?.bounds)
        bad.push(item.name || "未命名 GeoPDF");
    }
    bad.push(...packageAudit.bad);
    if (bad.length)
      throw Error(
        "以下地圖不完整或屬舊版，請重新下載：" +
          bad.slice(0, 3).join("、") +
          (bad.length > 3 ? " 等" : "。"),
      );
    $("shellIcon").textContent = "✓";
    $("shellStatus").textContent =
      `離線自檢通過 · ${records.length + geoPdfs.length + packageAudit.checked} 張完整地圖`;
    $("storageInfo").textContent =
      "已讀回完整圖層、GeoPDF、搜尋索引及步道路網；已選擇的等高線亦已核對。仍請開飛行模式重開測試。";
    toast("離線自檢通過。出發前最後用飛行模式重開一次。");
  } catch (e) {
    $("shellIcon").textContent = "!";
    $("shellStatus").textContent = "離線自檢未通過";
    toast(failure(e));
  } finally {
    $("audit").disabled = false;
  }
}
async function downloadBackup() {
  if (!storeOK) return toast("本機儲存未就緒。");
  $("backupAll").disabled = true;
  try {
    const backup = createBackup(await store.exportAll(), Date.now(), {packages:packageManager.listInstalled(),includeGeoPdfs:$('backupGeoPdfs').checked}),
      blob = new Blob([JSON.stringify(backup)], { type: "application/json" }),
      url = URL.createObjectURL(blob),
      a = node("a");
    a.href = url;
    a.download = "trail-pocket-backup-" + backup.created.slice(0, 10) + ".json";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    toast(
      "個人資料備份已建立（" + formatSize(blob.size) + "）。官方南澳地圖包可按清單重新下載。",
    );
  } catch (e) {
    toast(failure(e));
  } finally {
    $("backupAll").disabled = false;
  }
}
async function restoreBackup(file) {
  if (!file) return;
  if (file.size > MAX_BACKUP_BYTES)
    return toast("備份超過 300 MB，為保護裝置記憶體已停止。");
  $("restoreAll").disabled = true;
  try {
    const backup = validateBackup(JSON.parse(await file.text())),
      c = backupCounts(backup),
      summary = `${c.routes} 條路線、${c.maps + c.areas} 張離線底圖、${c.geopdfs} 張 GeoPDF、${c.activities} 項活動、${c.markers} 個標記。現有同 ID 資料會更新，其他資料保留。`;
    if (!(await ask("還原 Trail Pocket 備份？", summary, "合併還原"))) return;
    await store.restoreAll(backup.data);
    await refresh();
    await geoPdf.refresh();
    await markers.refresh();
    toast("備份已還原。" + (backup.offline?.packages?.length ? `另有 ${backup.offline.packages.length} 個官方地圖包需要重新下載。` : "") + " 請再做離線自檢及飛行模式測試。");
  } catch (e) {
    toast(failure(e));
  } finally {
    $("restoreAll").disabled = false;
  }
}
function requestShellStatus(worker) {
  return new Promise((resolve) => {
    if (!worker) {
      resolve(false);
      return;
    }
    const ch = new MessageChannel(),
      t = setTimeout(() => resolve(false), 5000);
    ch.port1.onmessage = (e) => {
      clearTimeout(t);
      ch.port1.close();
      resolve(Boolean(e.data?.ready));
    };
    worker.postMessage({ type: "STATUS" }, [ch.port2]);
  });
}
async function setupOffline() {
  if (
    !("serviceWorker" in navigator) ||
    !isSecureContext ||
    location.protocol === "file:"
  ) {
    $("shellStatus").textContent = "需要 HTTPS 網址先可安裝離線 App";
    setBanner(
      "此版本需部署到 HTTPS 網址。直接開啟下載檔案，未能完成 PWA 安裝。",
    );
    return;
  }
  try {
    reg = await navigator.serviceWorker.register(new URL("sw.js", BASE), {
      scope: BASE.pathname,
    });
    if (reg.waiting) $("updates").classList.remove("hide");
    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      w?.addEventListener("statechange", () => {
        if (w.state === "installed" && navigator.serviceWorker.controller)
          $("updates").classList.remove("hide");
      });
    });
    const ready = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(Error("離線安裝未完成，請保持連線再重開。")),
          20000,
        ),
      ),
    ]);
    shellReady = await requestShellStatus(ready.active);
    $("shellStatus").textContent = shellReady
      ? "App 可離線開啟"
      : "App 離線資源未完整，請連線重開";
    $("shellIcon").textContent = shellReady ? "✓" : "○";
    renderDownloads();
    if (!shellReady) setBanner("App 離線安裝尚未完成，請保持連線再重開。");
  } catch (e) {
    $("shellStatus").textContent = "App 離線安裝未完成";
    setBanner(failure(e));
  }
}
for (const b of document.querySelectorAll("nav button"))
  b.onclick = () => {
    if (b.dataset.tab === "explore") activity.minimizePanel();
    nav(b.dataset.view, b.dataset.tab);
  };
$("import").onclick = $("firstImport").onclick = () => $("files").click();
$("files").onchange = async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  await importFiles(files);
};
$("demo").onclick = demo;
$("back").onclick = () => nav("routes");
$("zoomIn").onclick = () => map.zoom(0.7);
$("zoomOut").onclick = () => map.zoom(1.4);
$("fit").onclick = () => {
  follow = false;
  $("follow").classList.remove("selected");
  map.fit();
};
$("follow").onclick = () => {
  if (!fix) {
    toast("先開始 GPS 定位。");
    return;
  }
  follow = true;
  $("follow").classList.add("selected");
  gpsStatus();
};
$("routeSearch").oninput = renderRoutes;
$("routeSort").onchange = renderRoutes;
$("gps").onclick = gps;
$("compassToggle").onclick = toggleCompass;
$("downloadContours").onchange = () =>
  store.put("settings", { id: "download-contours", value: $("downloadContours").checked }).catch(() => {});
setInterval(() => { if (!document.hidden) { directionStatus(); if (compassFix && Date.now() - compassFix.timestamp > 3000) { compassFix = null; map.setCompass(null); } } }, 1000);
document.addEventListener("visibilitychange", () => { compassFix = null; map.setCompass(null); });
$("copyPosition").onclick = async () => {
  const value = $("copyPosition").dataset.position;
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    toast("座標已複製，可貼到訊息或求救資料。");
  } catch {
    toast("未能自動複製：" + value);
  }
};
$("mapOptions").onclick = details;
$("closeDetails").onclick = () => $("details").close();
$("backupAll").onclick = downloadBackup;
$("restoreAll").onclick = () => $("backupFile").click();
$("backupFile").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  await restoreBackup(file);
};
$("persist").onclick = async () => {
  try {
    if (!navigator.storage?.persist) {
      toast("此瀏覽器未提供持續儲存功能，出發前請檢查離線地圖。");
      return;
    }
    const ok = await navigator.storage.persist();
    toast(
      ok
        ? "已取得持續儲存資格；仍請保留原始路線檔。"
        : "瀏覽器未批出持續儲存資格，現有資料仍可使用。",
    );
  } catch (e) {
    toast(failure(e));
  }
};
$("update").onclick = () => {
  if (!reg?.waiting) {
    toast("未有待更新版本。");
    return;
  }
  navigator.serviceWorker.addEventListener(
    "controllerchange",
    () => location.reload(),
    { once: true },
  );
  reg.waiting.postMessage({ type: "UPDATE" });
};
window.addEventListener("online", network);
window.addEventListener("offline", network);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) gpsStatus();
});
setInterval(() => {
  if (fix) gpsStatus();
}, 10000);
window.addEventListener("pagehide", () => {
  if (watch !== null) navigator.geolocation.clearWatch(watch);
  watch = null;
});
window.addEventListener("pageshow", (e) => {
  if (e.persisted) {
    stopGPS();
    $("gpsStatus").textContent = "請重新開始定位。";
  }
});
const adventure = setupAdventure({
  map,
  getRoute: () => selected,
  isReady: () => storeOK,
  replaceRoute: (r) => {
    if (selected?.id === r.id) selected = r;
  },
  refresh,
  selectRoute,
  toast,
  failure,
  pauseFollow: () => {
    follow = false;
    $("follow").classList.remove("selected");
  },
  showMap: () => nav("map"),
  showRoutes: () => nav("routes"),
  getPackageGraph: (start,end) => packageManager.routingGraph(start,end),
});
const activity = setupActivity({
  map,
  nav,
  getRoute: () => selected,
  isReady: () => storeOK,
  isEditing: () => adventure.isEditing(),
  ensureGPS: () => {
    if (watch === null) gps();
  },
  stopGPS,
  trackingStatus: (value) => { trackingState = value; directionStatus(); },
  openSettings: () => nav("settings"),
  toast,
  failure,
});
const packageManager = setupPackageManager({ask,toast,failure,changed:()=>explore.refresh(),previewBounds:previewOfflineBounds});
const explore = setupExplore({
  map,
  nav,
  getView: () => currentView,
  isReady: () => storeOK,
  isEditing: () => adventure.isEditing(),
  pauseFollow: () => {
    follow = false;
    $("follow").classList.remove("selected");
  },
  jobs,
  ask,
  toast,
  failure,
  formatSize,
  storageInfo,
  getGeoPdf: () => geoPdf,
  includeTerrain: () => $("downloadContours").checked,
  getPackages: () => packageManager,
});
const markers = setupMarkers({
  map,
  nav,
  getFix: () => fix,
  isReady: () => storeOK,
  toast,
  failure,
});
const geoPdf = setupGeoPdf({
  map,
  isReady: () => storeOK,
  formatSize,
  storageInfo,
  ask,
  toast,
  failure,
  openMap: (record) => {
    nav("map");
    $("mapTitle").textContent = selected?.name || record.name;
    $("mapMeta").textContent =
      `${record.name} · 官方 GeoPDF · 第 ${record.pageNumber}/${record.pageCount} 頁 · 完全離線`;
    $("mapBadge").classList.remove("hide");
    $("mapOptions").disabled = true;
    for (const b of document.querySelectorAll("[data-route-required]"))
      b.disabled = true;
  },
  closeMap: (showMap) => {
    if (showMap) nav("map");
    mapBadge();
  },
  onChange: (change) => explore.geoPdfChanged(change),
});

$("settingsMapSource").onclick = () => $("mapSourceButton").click();
$("settingsLayers").onclick = () => $("layersDialog").showModal();
$("settingsAlerts").onclick = () => $("alertsDialog").showModal();
$("settingsActivityHistory").onclick = () => $("activityHistory").click();
async function boot() {
  $("audit").onclick = offlineAudit;
  network();
  try {
    await store.openStore();
    storeOK = true;
    await packageManager.init();
    $("downloadContours").checked = (await store.get("settings", "download-contours"))?.value === true;
    await refresh();
    await adventure.init();
    await geoPdf.init();
    await explore.init();
    await markers.init();
    await activity.init();
  } catch (e) {
    setBanner(
      "本機儲存無法使用：" + failure(e) + " 請離開私密瀏覽或檢查裝置空間。",
    );
    $("import").disabled =
      $("firstImport").disabled =
      $("demo").disabled =
        true;
  }
  nav("map");
  await setupOffline();
}
setupUnifiedUI({nav,previewBounds:previewOfflineBounds});
boot();
