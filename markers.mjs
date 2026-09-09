import * as store from "./storage.mjs";

const $ = (id) => document.getElementById(id);
const markerLabel = (type) => ({ parking: "泊車位", junction: "路口", note: "備忘點" })[type] || "標記";

export function setupMarkers(ctx) {
  let items = [];
  const view = document.createElement("section");
  view.id = "markersView";
  view.className = "view hide marker-view";
  view.innerHTML = `<div class="marker-actions"><button id="addMarker" class="primary">標記目前位置</button><p>使用最新 GPS 儲存泊車位或重要路口；資料只留在此裝置及完整備份。</p></div><div id="markerList" class="marker-list"></div><p id="markerEmpty" class="muted">未有位置標記。</p>`;
  document.querySelector("main").append(view);
  const dialog = document.createElement("dialog");
  dialog.id = "markerDialog";
  dialog.innerHTML = `<h2>標記目前位置</h2><p id="markerGpsStatus"></p><label>類型<select id="markerType"><option value="parking">泊車位</option><option value="junction">路口</option><option value="note">備忘點</option></select></label><label>名稱<input id="markerName" maxlength="100" placeholder="例如：車輛位置／回程分岔口"></label><div class="row"><button id="saveMarker" class="primary">儲存標記</button><button id="cancelMarker">取消</button></div>`;
  document.body.append(dialog);

  function validFix() {
    const fix = ctx.getFix(), age = fix ? Date.now() - fix.timestamp : Infinity;
    return fix && age <= 20000 && fix.coords.accuracy <= 50 ? fix : null;
  }
  function open() {
    const fix = validFix();
    $("markerGpsStatus").textContent = fix
      ? `GPS 已就緒 · 精度 ±${Math.round(fix.coords.accuracy)} m`
      : "需要 20 秒內、精度 50 m 或更佳的 GPS 位置。請先到設定開啟 GPS。";
    $("saveMarker").disabled = !fix;
    $("markerName").value = "";
    dialog.showModal();
  }
  async function save() {
    const fix = validFix();
    if (!fix) return ctx.toast("GPS 位置太舊或精度不足，未有儲存標記。");
    const type = $("markerType").value,
      item = {
        id: "marker:" + crypto.randomUUID(),
        type,
        name: $("markerName").value.trim() || markerLabel(type),
        point: [fix.coords.longitude, fix.coords.latitude],
        accuracy: Math.round(fix.coords.accuracy),
        created: Date.now(),
      };
    await store.put("markers", item);
    dialog.close();
    await refresh();
    ctx.toast(`${markerLabel(type)}已儲存。`);
  }
  async function remove(item) {
    await store.transaction(["markers"], "readwrite", (t) => t.objectStore("markers").delete(item.id));
    await refresh();
  }
  function render() {
    $("markerList").replaceChildren();
    $("markerEmpty").classList.toggle("hide", items.length > 0);
    for (const item of items) {
      const row = document.createElement("article");
      row.className = "marker-row";
      row.innerHTML = `<span class="marker-symbol ${item.type}">${item.type === "parking" ? "P" : item.type === "junction" ? "Y" : "•"}</span><div><h3></h3><p></p></div><button class="marker-show">地圖</button><button class="marker-delete" aria-label="刪除標記">刪除</button>`;
      row.querySelector("h3").textContent = item.name;
      row.querySelector("p").textContent = `${markerLabel(item.type)} · ±${item.accuracy || "?"} m · ${new Date(item.created).toLocaleString()}`;
      row.querySelector(".marker-show").onclick = () => { ctx.nav("map"); ctx.map.focus(item.point); };
      row.querySelector(".marker-delete").onclick = () => remove(item).catch((e) => ctx.toast(ctx.failure(e)));
      $("markerList").append(row);
    }
    ctx.map.setMarkers(items);
  }
  async function refresh() {
    if (!ctx.isReady()) return;
    items = (await store.getAll("markers")).sort((a, b) => b.created - a.created);
    render();
  }
  $("addMarker").onclick = open;
  $("saveMarker").onclick = () => save().catch((e) => ctx.toast(ctx.failure(e)));
  $("cancelMarker").onclick = () => dialog.close();
  return { init: refresh, refresh, open };
}
