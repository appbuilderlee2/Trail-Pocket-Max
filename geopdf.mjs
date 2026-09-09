import * as store from "./storage.mjs";
import { parseGeoPdf } from "./geopdf-parser.mjs";
import { renderGeoPdf, MAX_GEOPDF_BYTES } from "./geopdf-render.mjs";
import { assertStorageRoom } from "./offline-download.mjs";

export function setupGeoPdf(ctx) {
  const $ = (id) => document.getElementById(id),
    map = ctx.map;
  let items = [],
    active = null,
    activeImage = null,
    activeOverlay = false,
    busy = false;
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const button = (text, fn, cls = "") => {
    const b = el("button", text, cls);
    b.onclick = fn;
    return b;
  };
  $("offlineView")
    .querySelector(".heading")
    .insertAdjacentHTML(
      "afterend",
      '<section class="geopdf-library"><div class="row"><div><h2>官方 GeoPDF 地圖</h2><p>匯入帶地理定位嘅官方 PDF，完全離線顯示 GPS 藍點。</p></div><button id="importGeoPdf" class="primary">＋ 匯入 GeoPDF</button></div><input id="geoPdfFile" type="file" accept=".pdf,application/pdf" hidden><p id="geoPdfProgress" class="muted" role="status"></p><div id="geoPdfList"></div><p id="geoPdfEmpty" class="muted">尚未匯入 GeoPDF。</p><p class="fineprint">只支援 PDF 1.7 Geospatial PDF 嘅 VP／Measure／GPTS／LPTS 地理資訊。普通 PDF、掃描圖、受密碼保護檔案及 TerraGo 專有格式可能不支援；App 不會猜測位置。匯入及 GPS 都只在本機處理。</p></section>',
    );
  $("mapView")
    .querySelector(".map-head")
    .after(
      Object.assign(el("div", undefined, "geopdf-bar hide"), {
        id: "geoPdfBar",
      }),
    );
  $("geoPdfBar").append(
    button("← 返回一般地圖", () => close(true)),
    el("span", "官方 GeoPDF · 已離線"),
  );
  document
    .querySelector(".route-tools")
    ?.append(button("▧ 匯入 GeoPDF", () => openPicker()));
  $("importGeoPdf").onclick = openPicker;
  $("geoPdfFile").onchange = (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (file) importFile(file);
  };
  function openPicker() {
    if (busy) return;
    if (!ctx.isReady()) {
      ctx.toast("本機儲存未就緒。");
      return;
    }
    $("geoPdfFile").click();
  }
  async function image(record) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(Error("未能讀取已儲存 GeoPDF 圖像。"));
      img.src = record.imageData;
    });
  }
  async function importFile(file) {
    busy = true;
    $("importGeoPdf").disabled = true;
    $("geoPdfProgress").textContent = "正在檢查 GeoPDF 地理定位…";
    try {
      if (!/\.pdf$/i.test(file.name) || file.size > MAX_GEOPDF_BYTES)
        throw Error("請選擇 30 MB 以下嘅 GeoPDF。");
      const bytes = await file.arrayBuffer(),
        geo = await parseGeoPdf(bytes),
        raster = await renderGeoPdf(bytes, geo.pageNumber, {
          onProgress: (t) => ($("geoPdfProgress").textContent = t),
        }),
        record = {
          id: "geopdf:" + crypto.randomUUID(),
          name: file.name.replace(/\.pdf$/i, "").slice(0, 160),
          sourceName: file.name,
          created: Date.now(),
          ...geo,
          ...raster,
        };
      record.size = new Blob([JSON.stringify(record)]).size;
      if (record.size > 32 * 1024 * 1024)
        throw Error("轉換後地圖超過 32 MB，未有儲存。");
      await assertStorageRoom(record.size);
      $("geoPdfProgress").textContent = "正在安全儲存離線地圖…";
      await store.put("geopdfs", record);
      await refresh();
      await open(record.id);
      ctx.storageInfo();
      ctx.toast("GeoPDF 已匯入，可在飛行模式顯示 GPS 藍點。");
    } catch (e) {
      ctx.toast(ctx.failure(e));
      $("geoPdfProgress").textContent = "匯入失敗：" + ctx.failure(e);
    } finally {
      busy = false;
      $("importGeoPdf").disabled = false;
    }
  }
  async function open(
    id,
    { overlay = false, opacity = 0.68, notify = true } = {},
  ) {
    try {
      const record =
        typeof id === "string" ? await store.get("geopdfs", id) : id;
      if (!record) throw Error("GeoPDF 已不存在。");
      $("geoPdfProgress").textContent = "正在開啟離線 GeoPDF…";
      const img =
        active?.id === record.id && activeImage
          ? activeImage
          : await image(record);
      active = record;
      activeImage = img;
      activeOverlay = overlay;
      if (!overlay) ctx.openMap(record);
      map.setGeoPdf(record, img, { overlay, opacity });
      document.body.classList.toggle("geopdf-mode", !overlay);
      $("geoPdfBar").classList.toggle("hide", overlay);
      $("geoPdfProgress").textContent = "";
      if (notify) ctx.onChange?.({ type: "open", id: record.id, overlay });
    } catch (e) {
      ctx.toast(ctx.failure(e));
    }
  }
  function setOpacity(opacity) {
    if (active && activeImage && activeOverlay)
      map.setGeoPdf(active, activeImage, { overlay: true, opacity });
  }
  function close(showMap = false, notify = true) {
    const wasExclusive = Boolean(active && !activeOverlay);
    active = null;
    activeImage = null;
    activeOverlay = false;
    map.setGeoPdf(null, null);
    document.body.classList.remove("geopdf-mode");
    $("geoPdfBar").classList.add("hide");
    if (wasExclusive) ctx.closeMap(showMap);
    if (notify) ctx.onChange?.({ type: "close" });
  }
  function render() {
    const host = $("geoPdfList");
    host.replaceChildren();
    $("geoPdfEmpty").classList.toggle("hide", items.length > 0);
    for (const item of items) {
      const card = el("article", undefined, "download-card geopdf-card");
      card.append(
        el("h2", item.name),
        el(
          "p",
          `${item.imageWidth} × ${item.imageHeight} · ${ctx.formatSize(item.size)} · 第 ${item.pageNumber}/${item.pageCount} 頁 · ${new Date(item.created).toLocaleString()}`,
          "muted",
        ),
        el(
          "p",
          `圖幅：${item.transform.bounds.south.toFixed(4)}, ${item.transform.bounds.west.toFixed(4)} 至 ${item.transform.bounds.north.toFixed(4)}, ${item.transform.bounds.east.toFixed(4)}`,
          "muted",
        ),
      );
      const row = el("div", undefined, "row");
      row.append(
        button("開啟 GeoPDF", () => open(item.id), "primary"),
        button("刪除", async () => {
          if (
            !(await ctx.ask(
              "刪除 GeoPDF？",
              `「${item.name}」會從此裝置移除；原始 PDF 不受影響。`,
              "刪除",
              true,
            ))
          )
            return;
          await store.removeGeoPdf(item.id);
          if (active?.id === item.id) close();
          await refresh();
          ctx.storageInfo();
        }),
      );
      card.append(row);
      host.append(card);
    }
  }
  async function refresh() {
    if (!ctx.isReady()) return;
    items = (await store.listGeoPdfMeta()).sort(
      (a, b) => b.created - a.created,
    );
    render();
  }
  map.onGeoFixState = (state) => {
    if (!active || activeOverlay) return;
    $("mapBadge").textContent =
      state === "inside"
        ? "GeoPDF 地理定位 · GPS 藍點在圖幅內"
        : state === "outside"
          ? "目前 GPS 在呢張 GeoPDF 圖幅之外"
          : "GeoPDF 地理定位 · 等候 GPS";
  };
  return {
    init: refresh,
    refresh,
    open,
    close,
    setOpacity,
    items: () => items.map((item) => ({ ...item })),
    activeId: () => active?.id || null,
    isOverlay: () => activeOverlay,
    isOpen: () => Boolean(active),
  };
}
