import { areaKm2, project, validCoordinate } from "./core.mjs";
import {
  validateArea,
  overlaps,
  contains,
  placeSearchURL,
  parsePlaceResults,
} from "./explore-core.mjs";
import { OnlineMap } from "./online-map.mjs";
import { VectorBaseMap } from "./vector-map.mjs";
import * as store from "./storage.mjs";
import { downloadContours } from "./terrain.mjs";
import {
  downloadOsmInChunks,
  assertStorageRoom,
  PACKAGE_LIMIT_BYTES,
  MAX_AREA_KM2,
} from "./offline-download.mjs";
import { buildOfflinePackage } from "./offline-package.mjs";
import { searchOffline } from "./offline-search.mjs";
import { createIntegrityManifest, verifyOfflineRecord } from "./reliability-core.mjs";
import { OFFLINE_REGIONS, filterRegions } from "./offline-regions.mjs";

export function setupExplore(ctx) {
  const $ = (id) => document.getElementById(id),
    map = ctx.map;
  let mode = "auto",
    effectiveMode = "online",
    geoOverlay = false,
    geoOpacity = 0.68,
    selectedGeoPdf = null,
    selecting = false,
    ready = false,
    areas = [],
    routeMaps = [],
    timer,
    serial = 0,
    job = null,
    lockedBounds = null,
    tileState = {},
    loadedKey = null,
    lastSearch = 0,
    searchJob = null;
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const button = (text, fn) => {
    const b = el("button", text);
    b.onclick = fn;
    return b;
  };
  document
    .querySelector(".trail-tools")
    .insertAdjacentHTML(
      "beforebegin",
      `<div class="explore-tools"><label class="legacy-base">底圖 <select id="baseMode"><option value="auto">自動（離線優先）</option><option value="online">線上 OSM</option><option value="offline">已下載離線地圖</option><option value="geopdf">官方 GeoPDF</option></select></label><button id="jumpPlace">搜尋／目前位置</button><button id="selectArea" class="primary">選擇離線範圍</button></div><div id="exploreStatus" class="muted" role="status">正在選擇最可靠地圖來源。</div><div id="areaControls" class="area-controls hide"><label>區域名稱 <input id="areaName" maxlength="100" placeholder="例如 Para Wirra 北部"></label><p id="areaSize" role="status"></p><div class="row"><button id="saveArea" class="primary">下載離線地圖</button><button id="cancelArea">取消選取</button><button id="abortArea" class="hide">取消下載</button></div><p class="fineprint">快速包包含 OSM 道路、步道、水域、林地、建築物、設施、地名、離線搜尋及步道路網。需要等高線可先到設定開啟；大型範圍較慢，建議分成多張地區圖，地圖會自動組合。</p></div>`,
    );
  document
    .querySelector(".map-wrap")
    .insertAdjacentHTML(
      "beforeend",
      '<div id="areaFrame" class="area-frame hide"><span>離線下載範圍</span></div>',
    );
  document
    .querySelector(".map-wrap")
    .insertAdjacentHTML(
      "beforeend",
      `<div class="map-quick-tools"><button id="mapSourceButton" class="map-source-button" aria-label="選擇地圖來源"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 7 9-4 9 4-9 4-9-4Zm0 5 9 4 9-4M3 17l9 4 9-4"/></svg><span><b>地圖來源</b><small id="mapSourceSummary">自動 · 離線優先</small></span><svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m8 10 4 4 4-4"/></svg></button></div>`,
    );
  $("offlineView")
    .querySelector(".heading")
    .insertAdjacentHTML(
      "afterend",
      '<section class="area-library"><div class="row"><h2>我的離線區域</h2><button id="chooseFromOffline">＋ 地圖選區</button></div><div id="areaList"></div><p id="areaEmpty">未有獨立區域。毋須 GPX／KML，可直接喺地圖揀位置下載。</p></section><h2>路線附近底圖</h2>',
    );
  $("offlineView").insertAdjacentHTML("afterbegin", `<section class="region-library"><div class="region-title"><div><button id="regionBack" aria-label="返回">‹</button><h2>南澳大利亞州</h2></div><button id="regionCustom">自訂範圍</button></div><label class="region-search"><span>⌕</span><input id="regionSearch" type="search" placeholder="搜尋地區或路線" aria-label="搜尋離線地區包"></label><div id="regionList" class="region-list"></div><p class="fineprint">地區包是適合手機下載的行山範圍；多個已下載地區會自動拼合。整個州級預製地圖需要日後 PMTiles 版本。</p></section>`);
  document.body.insertAdjacentHTML(
    "beforeend",
    `<dialog id="jumpDialog"><h2>搜尋及選擇地圖位置</h2><p>優先搜尋已下載地圖，完全離線及不傳送關鍵字。需要其他地區時才按網上搜尋。</p><label for="placeSearch">地名、山峰或設施</label><input id="placeSearch" maxlength="120" autocomplete="off" placeholder="例如 Morialta、Toilets、Mount Lofty"><div class="row jump-actions"><button id="searchPlace" class="primary">搜尋已下載地圖</button><button id="searchOnline">搜尋網上</button><button id="jumpCurrent">◎ 使用目前位置</button></div><p id="placeStatus" class="muted" role="status"></p><div id="searchResults" class="search-results"></div><details><summary>常用地區或經緯度</summary><div id="placeChoices" class="row"></div><label>緯度<input id="jumpLat" type="number" min="-85" max="85" step="any" placeholder="例如 -34.68"></label><label>經度<input id="jumpLon" type="number" min="-180" max="180" step="any" placeholder="例如 138.82"></label><button id="jumpCoordinates">前往座標並框選</button></details><p class="fineprint">本機搜尋只讀取已下載地圖。按「搜尋網上」先會把文字傳送至 OpenStreetMap Nominatim；GPS 位置不會放入搜尋。新下載範圍會把矩形座標傳送至 Overpass。</p><button id="closeJump" class="primary">關閉</button></dialog>`,
  );
  document.body.insertAdjacentHTML(
    "beforeend",
    `<dialog id="sourceDialog" class="source-sheet"><div class="sheet-handle"></div><div class="source-head"><div><h2>地圖來源</h2><p>途中可以隨時轉換，設定只保存在此裝置。</p></div><button id="closeSource" aria-label="關閉地圖來源">×</button></div><div class="source-options"><label class="source-row"><input type="radio" name="mapSource" value="auto"><span class="source-icon">⌁</span><span><b>自動（建議）</b><small>有離線地圖時優先使用，沒有才用線上地圖</small></span></label><label class="source-row"><input type="radio" name="mapSource" value="online"><span class="source-icon">◎</span><span><b>線上 OSM</b><small>資料最即時，需要網絡</small></span></label><label class="source-row"><input type="radio" name="mapSource" value="offline"><span class="source-icon">↓</span><span><b>已下載離線地圖</b><small>道路、步道、建築物、等高線及離線搜尋</small></span></label><label class="source-row"><input type="radio" name="mapSource" value="geopdf"><span class="source-icon">PDF</span><span><b>官方 GeoPDF</b><small>使用已匯入的公園地圖及 GPS 藍點</small></span></label></div><label class="geo-choice">使用 GeoPDF<select id="sourceGeoPdf"></select></label><div class="overlay-control"><label class="toggle-row"><span><b>重疊 GeoPDF</b><small>在目前底圖上半透明顯示</small></span><input id="geoOverlay" type="checkbox" role="switch"></label><label class="opacity-row"><span>透明度 <b id="opacityValue">68%</b></span><input id="geoOpacity" type="range" min="20" max="90" value="68"></label></div><p id="sourceCoverage" class="source-coverage" role="status"></p><button id="sourceDone" class="primary">完成</button></dialog>`,
  );
  const quickTools = document.querySelector(".map-quick-tools");
  quickTools.append($("jumpPlace"), $("selectArea"));
  for (const [name, p, units] of [
    ["阿德萊德", [138.6, -34.93], 40],
    ["Para Wirra", [138.82, -34.68], 15],
    ["Belair", [138.65, -35.0], 15],
    ["香港", [114.17, 22.3], 40],
  ])
    $("placeChoices").append(button(name, () => choose(p, name, units)));
  function jump(p, units) {
    ctx.pauseFollow();
    ctx.nav("map");
    map.center = project(p);
    map.units = units;
    if (units === 30000)
      map.fitBounds({ west: -179.9, east: 179.9, south: -85, north: 85 });
    else map.draw();
    $("jumpDialog").close();
  }
  function choose(p, name, units = 20) {
    jump(p, units);
    startSelection(name);
  }
  $("jumpPlace").textContent = "搜尋／目前位置";
  $("jumpPlace").onclick = () => {
    $("placeStatus").textContent = "";
    $("searchResults").replaceChildren();
    $("jumpDialog").showModal();
  };
  $("closeJump").onclick = () => $("jumpDialog").close();
  $("jumpCoordinates").onclick = () => {
    const la = $("jumpLat").value,
      lo = $("jumpLon").value,
      p = [Number(lo), Number(la)];
    if (!la.trim() || !lo.trim() || !validCoordinate(p)) {
      ctx.toast("請輸入有效經緯度（緯度 ±85°）。");
      return;
    }
    choose(p, "自選位置", 10);
  };
  $("jumpCurrent").onclick = () => {
    if (!isSecureContext || !navigator.geolocation) {
      $("placeStatus").textContent = "此瀏覽器未能使用目前位置。";
      return;
    }
    $("placeStatus").textContent = "正在取得目前位置…";
    $("jumpCurrent").disabled = true;
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const point = [p.coords.longitude, p.coords.latitude];
        $("jumpCurrent").disabled = false;
        choose(point, "目前位置", 15);
      },
      (e) => {
        $("jumpCurrent").disabled = false;
        $("placeStatus").textContent =
          e.code === 1
            ? "未獲定位授權，請到瀏覽器設定允許定位。"
            : "暫時未能取得位置，請到空曠位置再試。";
      },
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 20000 },
    );
  };
  $("placeSearch").onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      $("searchPlace").click();
    }
  };
  $("searchPlace").onclick = async () => {
    try {
      const records = [
          ...(await store.getAll("areas")),
          ...(await store.getAll("maps")),
        ],
        indexes = records
          .filter((r) => Array.isArray(r.searchIndex))
          .map((r) => ({ name: r.name || "路線底圖", index: r.searchIndex })),
        legacyResults = searchOffline(
          indexes,
          $("placeSearch").value,
          map.centerPoint(),
        ),
        packageResults = await ctx.getPackages?.()?.search($("placeSearch").value,map.centerPoint()) || [],
        results = [...packageResults,...legacyResults].slice(0,30);
      renderSearch(results, true);
      if (!indexes.length && !packageResults.length)
        $("placeStatus").textContent =
          "已下載地圖屬舊版或未有搜尋索引，請重新下載。";
    } catch (e) {
      $("placeStatus").textContent = ctx.failure(e);
    }
  };
  $("searchOnline").onclick = async () => {
    if (searchJob) return;
    if (!navigator.onLine) {
      $("placeStatus").textContent = "目前離線，只能搜尋已下載地圖。";
      return;
    }
    let url;
    try {
      url = placeSearchURL($("placeSearch").value);
    } catch (e) {
      $("placeStatus").textContent = ctx.failure(e);
      return;
    }
    const cacheKey = "place:" + url.searchParams.get("q").toLocaleLowerCase(),
      cached = readSearchCache(cacheKey);
    if (cached) {
      renderSearch(cached, false);
      return;
    }
    const wait = 1000 - (Date.now() - lastSearch);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const controller = new AbortController(),
      timeout = setTimeout(() => controller.abort(), 12000);
    searchJob = controller;
    lastSearch = Date.now();
    $("searchOnline").disabled = true;
    $("placeStatus").textContent = "正在搜尋網上地名…";
    try {
      const response = await fetch(url, {
        credentials: "omit",
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw Error("搜尋服務回應 " + response.status);
      const results = parsePlaceResults(await response.json());
      writeSearchCache(cacheKey, results);
      renderSearch(results, false);
    } catch (e) {
      $("placeStatus").textContent =
        e.name === "AbortError"
          ? "搜尋逾時，請稍後重試。"
          : "搜尋失敗：" + ctx.failure(e);
    } finally {
      clearTimeout(timeout);
      searchJob = null;
      $("searchOnline").disabled = false;
    }
  };
  function renderSearch(results, local = false) {
    $("searchResults").replaceChildren();
    $("placeStatus").textContent = results.length
      ? local
        ? `本機找到 ${results.length} 項；沒有傳送搜尋文字：`
        : "網上搜尋結果："
      : local
        ? "已下載地圖內找不到；可改按「搜尋網上」。"
        : "找不到地點，請加入城市、州或國家名稱再試。";
    for (const r of results) {
      const label = local
          ? `${r.name} · ${r.kind} · ${r.source}${Number.isFinite(r.metres) ? " · " + (r.metres < 1000 ? Math.round(r.metres) + " m" : (r.metres / 1000).toFixed(1) + " km") : ""}`
          : r.name,
        b = button(label, () => choose(r.point, r.name.split(",")[0], 20));
      b.className = "place-result";
      $("searchResults").append(b);
    }
  }
  function readSearchCache(key) {
    try {
      const cache = JSON.parse(
          localStorage.getItem("trail-pocket-place-search") || "{}",
        ),
        item = cache[key];
      return item && Date.now() - item.saved < 2592000000
        ? parsePlaceResults(
            item.results.map((x) => ({
              display_name: x.name,
              lon: x.point[0],
              lat: x.point[1],
            })),
          )
        : null;
    } catch {
      return null;
    }
  }
  function writeSearchCache(key, results) {
    try {
      const cache = JSON.parse(
        localStorage.getItem("trail-pocket-place-search") || "{}",
      );
      cache[key] = { saved: Date.now(), results };
      for (const k of Object.keys(cache)
        .sort((a, b) => cache[b].saved - cache[a].saved)
        .slice(20))
        delete cache[k];
      localStorage.setItem("trail-pocket-place-search", JSON.stringify(cache));
    } catch {}
  }
  map.online = new OnlineMap(
    () => map.draw(),
    (s) => {
      tileState = s;
      status();
    },
  );
  map.vector = new VectorBaseMap($("vectorMap"), (s) => {
    tileState = s;
    if (s.failed && !map.vector?.supported && effectiveMode === "online") {
      map.online.setEnabled(navigator.onLine);
      map.draw();
    }
    status();
  });
  map.onViewChange = () => {
    updateSelection();
    clearTimeout(timer);
    timer = setTimeout(
      () => loadVisible().catch((e) => ctx.toast(ctx.failure(e))),
      250,
    );
  };
  const sourceLabels = {
    auto: "自動 · 離線優先",
    online: "線上 OSM",
    offline: "已下載離線地圖",
    geopdf: "官方 GeoPDF",
  };
  const geoApi = () => ctx.getGeoPdf?.();
  const pdfItems = () => geoApi()?.items?.() || [];
  const selectedPdf = () => {
    const items = pdfItems();
    return items.find((item) => item.id === selectedGeoPdf) || items[0] || null;
  };
  function updateGeoSelect() {
    const select = $("sourceGeoPdf"),
      items = pdfItems();
    select.replaceChildren();
    if (!items.length) {
      const option = el("option", "未有已匯入 GeoPDF");
      option.value = "";
      select.append(option);
      select.disabled = true;
      selectedGeoPdf = null;
    } else {
      select.disabled = false;
      if (!items.some((item) => item.id === selectedGeoPdf))
        selectedGeoPdf = items[0].id;
      for (const item of items) {
        const option = el("option", item.name || "GeoPDF");
        option.value = item.id;
        option.selected = item.id === selectedGeoPdf;
        select.append(option);
      }
    }
    const pdfRadio = document.querySelector(
      'input[name="mapSource"][value="geopdf"]',
    );
    pdfRadio.disabled = !items.length;
    pdfRadio.closest(".source-row").classList.toggle("disabled", !items.length);
    $("geoOverlay").disabled = !items.length || mode === "geopdf";
    $("geoOpacity").disabled =
      !items.length || !geoOverlay || mode === "geopdf";
  }
  function updateSourceUI() {
    updateGeoSelect();
    for (const radio of document.querySelectorAll('input[name="mapSource"]'))
      radio.checked = radio.value === mode;
    $("baseMode").value = mode;
    $("geoOverlay").checked = geoOverlay;
    $("geoOpacity").value = Math.round(geoOpacity * 100);
    $("opacityValue").textContent = Math.round(geoOpacity * 100) + "%";
    const bounds = map.viewBounds(),
      near = [...areas, ...routeMaps].filter((item) =>
        overlaps(item.bounds, bounds),
      ),
      vectorPackages = ctx.getPackages?.()?.covering(bounds) || [],
      offlineCount = near.length + vectorPackages.length,
      pdf = selectedPdf();
    $("mapSourceSummary").textContent =
      (effectiveMode === "offline" && mode !== "geopdf" ? `離線組合 · ${offlineCount} 個範圍` : sourceLabels[mode]) +
      (geoOverlay && mode !== "geopdf" ? " + GeoPDF" : "");
    $("sourceCoverage").textContent =
      mode === "geopdf"
        ? pdf
          ? `正在使用「${pdf.name}」；PDF、路線和 GPS 藍點均可離線顯示。`
          : "請先到離線下載匯入 GeoPDF。"
        : `${effectiveMode === "offline" ? "目前使用離線地圖" : "目前使用線上地圖"} · 畫面有 ${offlineCount} 個已下載範圍` +
          (geoOverlay && pdf ? ` · 疊加「${pdf.name}」` : "");
  }
  async function saveSourceSettings() {
    await Promise.all([
      store.put("settings", { id: "mapSourceMode", value: mode }),
      store.put("settings", { id: "geoOverlay", value: geoOverlay }),
      store.put("settings", { id: "geoOpacity", value: geoOpacity }),
      store.put("settings", { id: "geoPdfId", value: selectedGeoPdf }),
    ]);
  }
  async function setSource(next) {
    mode = next;
    if (mode === "geopdf") geoOverlay = false;
    loadedKey = null;
    updateSourceUI();
    await saveSourceSettings();
    await syncMode();
  }
  $("mapSourceButton").onclick = () => {
    updateSourceUI();
    $("sourceDialog").showModal();
  };
  $("closeSource").onclick = $("sourceDone").onclick = () =>
    $("sourceDialog").close();
  for (const radio of document.querySelectorAll('input[name="mapSource"]'))
    radio.onchange = () =>
      setSource(radio.value).catch((error) => ctx.toast(ctx.failure(error)));
  $("sourceGeoPdf").onchange = async () => {
    selectedGeoPdf = $("sourceGeoPdf").value || null;
    loadedKey = null;
    await saveSourceSettings();
    await syncMode();
  };
  $("geoOverlay").onchange = async () => {
    geoOverlay = $("geoOverlay").checked;
    loadedKey = null;
    await saveSourceSettings();
    await syncMode();
  };
  $("geoOpacity").oninput = () => {
    geoOpacity = Number($("geoOpacity").value) / 100;
    $("opacityValue").textContent = Math.round(geoOpacity * 100) + "%";
    geoApi()?.setOpacity?.(geoOpacity);
  };
  $("geoOpacity").onchange = () =>
    saveSourceSettings().catch((error) => ctx.toast(ctx.failure(error)));
  function status() {
    if (mode === "geopdf") {
      const pdf = selectedPdf();
      $("exploreStatus").textContent = pdf
        ? `GeoPDF 離線顯示 · ${pdf.name} · GPS 藍點按地理校正位置顯示。`
        : "未有可用 GeoPDF，請先匯入官方地圖。";
      $("retryTiles").classList.add("hide");
      updateSourceUI();
      return;
    }
    const online = effectiveMode === "online" && navigator.onLine;
    if (online) {
      const s = tileState;
      $("exploreStatus").textContent = s.failed
        ? `部分在線底圖未載入（${s.failed} 張）。可按「重試底圖」，或切換已下載底圖。`
        : `在線地圖${s.total ? ` · ${s.loaded}/${s.total} 張已載入` : ""} · 可自由拖動、縮放；瀏覽不等於離線下載。`;
      $("retryTiles").classList.toggle("hide", !s.failed);
    } else {
      const b = map.viewBounds(),
        near = [...areas, ...routeMaps].filter((m) => overlaps(m.bounds, b)),
        vectorPackages = ctx.getPackages?.()?.covering(b) || [],
        nearCount = near.length + vectorPackages.length,
        old = near.some((m) => m.packageVersion < 3 || !m.integrity),
        noContours = near.some((m) => !m.terrain),
        fast = near.some((m) => m.terrain?.optional);
      $("exploreStatus").textContent =
        (navigator.onLine ? "離線優先" : "目前離線") +
        ` · 畫面涵蓋 ${nearCount} 個已下載範圍。` +
        (near.some((m) => contains(m.bounds, b)) || vectorPackages.some((m) => contains({west:m.bounds[0],south:m.bounds[1],east:m.bounds[2],north:m.bounds[3]}, b))
          ? ""
          : "範圍外可能留白；可到「離線下載」開啟已儲存區域。") +
        (near.length
          ? old
            ? " 其中有舊版地圖，請重新下載以加入完整圖層、搜尋及導航路網。"
            : noContours
              ? " 其中有舊底圖未含等高線；重新下載即可加入。"
              : ` 已包含完整圖層、本機搜尋及步道路網${fast ? "；快速包未下載等高線。" : "及等高線。"}`
          : vectorPackages.length
            ? map.vector.enabled
              ? " 已包含 PMTiles 向量圖、本機搜尋及步道路網。"
              : " PMTiles 已下載，但此瀏覽器未能啟動向量引擎；GPS、路線及活動軌跡仍可顯示，底圖需改用支援 WebGL 的裝置。"
            : "");
      $("retryTiles").classList.add("hide");
    }
    updateSourceUI();
  }
  const retry = button("重試底圖", () => map.online.retry());
  retry.id = "retryTiles";
  retry.className = "hide";
  $("exploreStatus").after(retry);
  async function syncMode() {
    if (!ready) return;
    await loadVisible();
    status();
  }
  $("baseMode").onchange = async () => {
    try {
      await setSource($("baseMode").value);
    } catch (e) {
      ctx.toast(ctx.failure(e));
    }
  };
  for (const event of ["online", "offline"])
    window.addEventListener(event, () =>
      syncMode().catch((error) => ctx.toast(ctx.failure(error))),
    );
  async function refresh() {
    if (!ctx.isReady()) return;
    areas = (await store.listMapMeta("areas")).sort(
      (a, b) => b.downloaded - a.downloaded,
    );
    routeMaps = await store.listMapMeta();
    loadedKey = null;
    renderAreas();
    renderRegions();
    await loadVisible();
    status();
  }
  async function loadVisible() {
    if (!ready || ctx.getView() !== "map") return;
    const current = ++serial;
    const api = geoApi();
    if (mode === "geopdf") {
      effectiveMode = "geopdf";
      map.online.setEnabled(false);
      map.vector.setEnabled(false);
      const pdf = selectedPdf();
      if (!pdf) {
        mode = "auto";
        geoOverlay = false;
        loadedKey = null;
        ctx.toast("未有已匯入 GeoPDF，已切回自動地圖。");
        await saveSourceSettings();
        return loadVisible();
      }
      if (loadedKey !== `geopdf:${pdf.id}`) {
        map.setRegions([]);
        await api.open(pdf.id, {
          overlay: false,
          opacity: geoOpacity,
          notify: false,
        });
        loadedKey = `geopdf:${pdf.id}`;
      }
      return;
    }
    if (api?.isOpen?.() && !api.isOverlay?.()) api.close(false, false);
    const b = map.viewBounds(),
      records = [
        ...areas.map((a) => ({ ...a, store: "areas" })),
        ...routeMaps.map((a) => ({ ...a, store: "maps" })),
      ].filter((m) => overlaps(m.bounds, b)),
      vectorPackages = ctx.getPackages?.()?.covering(b) || [];
    const useOffline =
        mode === "offline" ||
        !navigator.onLine ||
        (mode === "auto" && (records.length > 0 || vectorPackages.length > 0)),
      pdf = geoOverlay ? selectedPdf() : null,
      key =
        `${useOffline ? "offline" : "online"}:view:${ctx.getView()}:` +
        records
          .map((m) => m.store + ":" + m.id + ":" + m.downloaded)
          .join("|") +
        vectorPackages.map(m => `:pmtiles:${m.id}:${m.version}`).join("") +
        (pdf ? `:pdf:${pdf.id}:${geoOpacity}` : "");
    if (key === loadedKey) return;
    effectiveMode = useOffline ? "offline" : "online";
    const wantsOnline = !useOffline && navigator.onLine && ctx.getView() === "map";
    let vectorEnabled = false;
    if (wantsOnline) vectorEnabled = map.vector.setEnabled(true);
    else if (vectorPackages.length) vectorEnabled = await map.vector.setOfflinePackages(vectorPackages, ctx.getPackages().files());
    else map.vector.setEnabled(false);
    map.online.setEnabled(wantsOnline && !vectorEnabled);
    if (useOffline) {
      const data = await Promise.all(
        records.map((m) => store.get(m.store, m.id)),
      );
      if (current !== serial) return;
      map.setRegions(vectorEnabled ? [] : data.filter(Boolean));
    } else map.setRegions([]);
    if (pdf)
      await api.open(pdf.id, {
        overlay: true,
        opacity: geoOpacity,
        notify: false,
      });
    else if (api?.isOverlay?.()) api.close(false, false);
    loadedKey = key;
    status();
  }
  function updateSelection() {
    if (!selecting) return;
    const b = lockedBounds || map.viewBounds(0.15);
    let valid = true;
    const frame = $("areaFrame");
    if (lockedBounds) {
      const a = map.screen(project([b.west, b.north])),
        z = map.screen(project([b.east, b.south]));
      frame.style.inset = "auto";
      frame.style.left = a[0] + "px";
      frame.style.top = a[1] + "px";
      frame.style.width = z[0] - a[0] + "px";
      frame.style.height = z[1] - a[1] + "px";
    } else frame.removeAttribute("style");
    try {
      const size = validateArea(b);
      $("areaSize").textContent =
        `框內 ${size.toFixed(2)} km²${size > 150 ? " · 大型範圍下載較慢，建議分成數張地圖" : " · 適合快速下載"} · ${b.south.toFixed(4)}, ${b.west.toFixed(4)} 至 ${b.north.toFixed(4)}, ${b.east.toFixed(4)}`;
    } catch (e) {
      valid = false;
      $("areaSize").textContent = ctx.failure(e);
    }
    $("saveArea").disabled = !valid || Boolean(job) || !navigator.onLine;
  }
  function startSelection(suggestedName = "", presetBounds = null) {
    if (job) {
      ctx.toast("請先等目前區域下載完成，或取消下載。");
      return;
    }
    if (!ctx.isReady()) {
      ctx.toast("本機儲存未就緒。");
      return;
    }
    if (ctx.isEditing()) {
      ctx.toast("請先完成自訂路線編輯。");
      return;
    }
    ctx.pauseFollow();
    ctx.nav("map");
    map.resize();
    selecting = true;
    lockedBounds = presetBounds ? structuredClone(presetBounds) : null;
    if (presetBounds) map.fitBounds(presetBounds);
    else if (areaKm2(map.viewBounds(0.15)) > 150)
      map.zoom(Math.sqrt(120 / areaKm2(map.viewBounds(0.15))));
    $("areaControls").classList.remove("hide");
    $("areaFrame").classList.remove("hide");
    $("areaProgress").textContent = "";
    $("areaName").value =
      typeof suggestedName === "string" && suggestedName.trim()
        ? suggestedName.trim()
        : "離線區域 " + (areas.length + 1);
    updateSelection();
  }
  $("selectArea").onclick = $("chooseFromOffline").onclick = () =>
    startSelection();
  $("regionCustom").onclick = () => startSelection();
  $("regionBack").onclick = () => ctx.nav("routes");
  $("regionSearch").oninput = () => renderRegions();
  function cancelSelection() {
    if (job) return;
    selecting = false;
    lockedBounds = null;
    $("areaControls").classList.add("hide");
    $("areaFrame").classList.add("hide");
  }
  $("cancelArea").onclick = cancelSelection;
  $("abortArea").onclick = () => job?.abort();
  const progress = el("p", "", "muted");
  progress.id = "areaProgress";
  progress.setAttribute("role", "status");
  $("areaSize").after(progress);
  $("saveArea").onclick = async () => {
    if (job || ctx.jobs.size) {
      ctx.toast("請等目前下載完成，或先取消。");
      return;
    }
    if (!navigator.onLine) {
      ctx.toast("請連線後下載。");
      return;
    }
    let bounds, name;
    try {
      bounds = structuredClone(lockedBounds || map.viewBounds(0.15));
      validateArea(bounds);
      name = $("areaName").value.trim();
      if (!name) throw Error("請為離線區域命名。");
    } catch (e) {
      ctx.toast(ctx.failure(e));
      return;
    }
    const id = "area:" + crypto.randomUUID(),
      controller = new AbortController();
    job = controller;
    lockedBounds = bounds;
    ctx.jobs.set(id, controller);
    $("areaProgress").textContent = "正在取得框內地圖…";
    $("abortArea").classList.remove("hide");
    $("cancelArea").disabled = true;
    $("areaName").disabled = true;
    $("selectArea").disabled = true;
    updateSelection();
    const timeout = setTimeout(() => controller.abort("timeout"), 600000);
    try {
      const osm = await downloadOsmInChunks(bounds, {
          signal: controller.signal,
          onProgress: (p) =>
            ($("areaProgress").textContent =
              `正在下載地圖分區 ${p.index}/${p.total}${p.endpoint > 1 ? "（備用服務）" : ""} · ${ctx.formatSize(p.transferred)}…`),
        }),
        data = osm.data;
      if (controller.signal.aborted) throw Error("下載已取消。");
      $("areaProgress").textContent = "正在建立離線搜尋及步道路網…";
      const extra = buildOfflinePackage(data);
      const includeContours = ctx.includeTerrain();
      $("areaProgress").textContent = includeContours ? "正在下載及產生 20 m 等高線…" : "正在完成快速離線包…";
      const terrainResult = includeContours
        ? await downloadContours(bounds, {
            signal: controller.signal,
            onProgress: (p) => ($("areaProgress").textContent = `正在下載高程 ${p.done}/${p.total}…`),
          })
        : { contours: [], terrain: { source: "快速離線包", optional: true, interval: null } },
        record = {
          id,
          name,
          bounds,
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
      $("areaProgress").textContent = "正在安全儲存…";
      $("areaProgress").textContent = "正在讀回並核對完整性…";
      await store.putVerified("areas", record, (saved) => verifyOfflineRecord(saved).ok);
      await refresh();
      selecting = false;
      lockedBounds = null;
      $("areaControls").classList.add("hide");
      $("areaFrame").classList.add("hide");
      mode = "offline";
      loadedKey = null;
      map.fitBounds(record.bounds);
      await saveSourceSettings();
      await syncMode();
      ctx.toast(
        "「" +
          name +
          `」${includeContours ? "底圖及等高線" : "快速離線地圖"}已儲存，現正預覽組合離線地圖。出發前請用飛行模式重開測試。`,
      );
    } catch (e) {
      $("areaProgress").textContent = controller.signal.aborted
        ? controller.signal.reason === "timeout"
          ? "下載超過 10 分鐘，未儲存新區域。"
          : "已取消，未儲存新區域。"
        : "下載失敗：" + ctx.failure(e) + "。既有區域不受影響。";
    } finally {
      clearTimeout(timeout);
      ctx.jobs.delete(id);
      job = null;
      lockedBounds = null;
      $("abortArea").classList.add("hide");
      $("cancelArea").disabled = false;
      $("areaName").disabled = false;
      $("selectArea").disabled = false;
      updateSelection();
      ctx.storageInfo();
    }
  };
  function renderAreas() {
    $("areaList").replaceChildren();
    $("areaEmpty").classList.toggle("hide", areas.length > 0);
    for (const a of areas) {
      const card = el("article", undefined, "download-card"),
        detail =
          a.packageVersion >= 3 && a.integrity
            ? `已驗證完整圖層 · ${a.stats?.searchEntries || 0} 搜尋項 · ${a.stats?.routingNodes || 0} 路網點 · ${a.terrain?.optional ? "快速包" : "20 m 等高線"}`
            : "舊版地圖；重新下載可加入搜尋及路網";
      card.append(
        el("h3", a.name),
        el(
          "p",
          `${areaKm2(a.bounds).toFixed(2)} km² · ${ctx.formatSize(a.size)} · ${detail} · ${new Date(a.downloaded).toLocaleString()}`,
        ),
      );
      const row = el("div", undefined, "row");
      row.append(
        button("開啟離線區域", async () => {
          if (ctx.isEditing()) {
            ctx.toast("請先完成自訂路線編輯。");
            return;
          }
          ctx.pauseFollow();
          ctx.nav("map");
          map.resize();
          mode = "offline";
          map.fitBounds(a.bounds);
          loadedKey = null;
          await saveSourceSettings();
          await syncMode();
        }),
        button("刪除區域", async () => {
          if (
            !(await ctx.ask(
              "刪除此離線區域？",
              "「" +
                a.name +
                "」會從此裝置移除，可重新下載。GPX／KML 路線不受影響。",
            ))
          )
            return;
          try {
            await store.removeArea(a.id);
            await refresh();
            ctx.storageInfo();
            ctx.toast("離線區域已刪除，可重新下載。");
          } catch (e) {
            ctx.toast(ctx.failure(e));
          }
        }),
      );
      card.append(row);
      $("areaList").append(card);
    }
  }
  function renderRegions() {
    const list = $("regionList"),
      regions = filterRegions(OFFLINE_REGIONS, $("regionSearch").value);
    list.replaceChildren();
    for (const region of regions) {
      const saved = areas.find((a) => contains(a.bounds, region.bounds)),
        row = el("article", undefined, "region-row"),
        icon = el("span", saved ? "✓" : "↓", `region-state${saved ? " saved" : ""}`),
        text = el("div"),
        meta = el("span", saved ? ctx.formatSize(saved.size) : `約 ${areaKm2(region.bounds).toFixed(0)} km²`),
        action = button(saved ? "開啟" : "下載", () => {
          if (saved) {
            ctx.nav("map");
            mode = "offline";
            map.fitBounds(region.bounds);
            loadedKey = null;
            saveSourceSettings().then(syncMode).catch((e) => ctx.toast(ctx.failure(e)));
          } else startSelection(region.name, region.bounds);
        });
      text.append(el("h3", region.name), el("p", region.places));
      row.append(icon, text, meta, action);
      list.append(row);
    }
    if (!regions.length) list.append(el("p", "找不到符合的地區包。", "muted"));
  }
  async function init() {
    ready = true;
    const [saved, legacy, overlay, opacity, pdfId] = await Promise.all([
      store.get("settings", "mapSourceMode"),
      store.get("settings", "baseMode"),
      store.get("settings", "geoOverlay"),
      store.get("settings", "geoOpacity"),
      store.get("settings", "geoPdfId"),
    ]);
    if (["auto", "online", "offline", "geopdf"].includes(saved?.value))
      mode = saved.value;
    else if (["online", "offline"].includes(legacy?.value)) mode = legacy.value;
    geoOverlay = overlay?.value === true;
    if (Number(opacity?.value) >= 0.2 && Number(opacity?.value) <= 0.9)
      geoOpacity = Number(opacity.value);
    selectedGeoPdf = pdfId?.value || null;
    await refresh();
    await syncMode();
  }
  function viewChanged() {
    syncMode().catch((error) => ctx.toast(ctx.failure(error)));
    if (ctx.getView() !== "map" && !job) cancelSelection();
  }
  async function geoPdfChanged(change) {
    if (change?.id) selectedGeoPdf = change.id;
    if (change?.type === "open") {
      if (change.overlay) geoOverlay = true;
      else {
        mode = "geopdf";
        geoOverlay = false;
      }
    } else if (change?.type === "close" && mode === "geopdf") mode = "auto";
    loadedKey = null;
    updateSourceUI();
    await saveSourceSettings();
    if (change?.type === "close") await syncMode();
  }
  return {
    init,
    refresh,
    viewChanged,
    geoPdfChanged,
    isSelecting: () => selecting,
    coverageRecords: () => [...areas, ...routeMaps, ...(ctx.getPackages?.()?.listInstalled() || []).map(item=>({id:item.id,bounds:{west:item.bounds[0],south:item.bounds[1],east:item.bounds[2],north:item.bounds[3]}}))],
    usesOffline: () => effectiveMode === "offline" || mode === "geopdf",
  };
}
