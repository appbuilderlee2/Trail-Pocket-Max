import * as store from "./storage.mjs";
import {
  newActivity,
  resume,
  pause,
  checkpoint,
  metrics,
  addFix,
  clock,
} from "./activity-core.mjs";
import { toGPX } from "./adventure-core.mjs";
import { distance, project } from "./core.mjs";
import { createWakeLock } from "./wake-lock.mjs";
const $ = (id) => document.getElementById(id),
  el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
export function setupActivity(ctx) {
  let active = null,
    viewed = null,
    message = "",
    busy = false,
    chain = Promise.resolve(),
    releaseLock = null,
    saveError = false,
    lastSave = 0,
    expanded = false;
  const wake = createWakeLock();
  const host = el("section", undefined, "activity-panel");
  host.innerHTML = `<button id="activitySheetToggle" class="activity-sheet-toggle" aria-label="展開活動面板" aria-expanded="false"><span></span><b>⌃</b></button><div class="activity-heading"><div><small>YOUR ACTIVITY</small><h2 id="activityTitle">開始你嘅行程</h2></div><button id="activityHistory">活動紀錄</button></div><div class="activity-stats">${[
    ["Time", "時間"],
    ["Distance", "距離 km"],
    ["Gain", "爬升 m"],
    ["Remaining", "剩餘 km"],
    ["Pace", "配速 /km"],
    ["Speed", "速度 km/h"],
  ]
    .map(
      ([id, label]) =>
        `<div><strong id="activity${id}">—</strong><span>${label}</span></div>`,
    )
    .join(
      "",
    )}</div><button id="startActivity" class="primary">▶ 開始活動</button><div id="activityBody" class="hide"><div id="activityProfile"></div><div class="activity-tools"><button id="showBreadcrumb"><span>↶</span>查看來時軌跡 <b>›</b></button><button id="activityDetailsShortcut"><span>⌁</span>活動紀錄 <b>›</b></button><button id="activityGpsShortcut"><span>◎</span>GPS 及緊急位置 <b>›</b></button><button id="activityMinimize"><span>↙</span>縮小活動面板 <b>›</b></button></div><div class="activity-settings"><label>活動名稱<input id="activityName" maxlength="160" aria-label="活動名稱"></label></div><div class="activity-actions"><button id="pauseActivity" class="activity-go">暫停</button><button id="resumeActivity" class="activity-go">繼續</button><button id="finishActivity">完成</button></div></div><p id="activityStatus" role="status">開始後會要求 GPS 定位，活動只儲存在此裝置。</p><p class="fineprint">橙線是實際來時軌跡，可用來辨認回程方向。保持亮屏可在「設定」更改。切換 App／真正熄屏仍可能自動暫停。GPS 不佳或中斷不會補畫直線。</p>`;
  document.querySelector("#mapView .map-wrap").after(host);
  const history = el("section");
  history.className = "view hide";
  history.id = "historyView";
  history.innerHTML =
    '<h2>活動紀錄</h2><div id="activityHistoryList"></div><button id="closeActivityHistory">關閉</button>';
  const detail = el("dialog");
  detail.id = "activityDetailDialog";
  detail.innerHTML =
    '<h2 id="savedActivityName"></h2><div id="savedActivityDetails"></div><div id="savedActivityProfile"></div><div class="row"><button id="exportActivity">匯出活動 GPX</button><button id="closeActivityDetail">關閉</button></div>';
  document.querySelector("main").append(history);
  document.body.append(detail);
  const entry = el("button", "活動紀錄");
  document.querySelector("#routesView .heading").append(entry);
  entry.onclick = showHistory;
  async function lock() {
    if (releaseLock) return true;
    if (!navigator.locks) {
      ctx.toast("此瀏覽器未支援多視窗保護，請只用一個視窗記錄。");
      return true;
    }
    return new Promise((resolve) =>
      navigator.locks.request(
        "trail-pocket-activity:" + location.pathname,
        { ifAvailable: true },
        (l) => {
          if (!l) {
            resolve(false);
            return;
          }
          return new Promise((done) => {
            releaseLock = done;
            resolve(true);
          });
        },
      ),
    );
  }
  function unlock() {
    releaseLock?.();
    releaseLock = null;
  }
  async function syncWake() {
    if (!active || active.status !== "recording" || !$("keepAwake").checked) {
      await wake.release();
      return true;
    }
    const ok = await wake.request();
    if (!ok) {
      message = "活動進行中；此瀏覽器未能保持螢幕亮著，請留意螢幕及 GPS。";
      render();
    }
    return ok;
  }
  function save() {
    if (!active) return chain;
    const snapshot = checkpoint(active);
    lastSave = Date.now();
    chain = chain
      .catch(() => {})
      .then(() =>
        store.put("settings", { id: "active-activity", value: snapshot }),
      );
    chain.then(
      () => {
        saveError = false;
      },
      () => {
        saveError = true;
        message = "未能儲存活動！請保留此頁並釋放裝置空間。";
        if (active?.status === "recording") {
          pause(active);
          ctx.stopGPS();
        }
        render();
      },
    );
    return chain;
  }
  function profile(a, target) {
    target.replaceChildren();
    let x = 0,
      previous = null,
      values = [];
    for (const segment of a.segments) {
      previous = null;
      for (const p of segment) {
        if (previous) x += distance(previous, p);
        values.push([x, p[2], previous !== null]);
        previous = p;
      }
    }
    const heights = values.filter((p) => Number.isFinite(p[1]));
    if (heights.length < 2) {
      target.append(el("p", "實際高度曲線：等候有效 GPS 高度資料。", "muted"));
      return;
    }
    const low = Math.min(...heights.map((p) => p[1])),
      high = Math.max(...heights.map((p) => p[1])),
      ns = "http://www.w3.org/2000/svg",
      svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 600 140");
    svg.setAttribute("aria-label", "實際記錄高度曲線");
    svg.setAttribute("role", "img");
    let d = "",
      connected = false;
    for (const [m, h, linked] of values) {
      if (!Number.isFinite(h)) {
        connected = false;
        continue;
      }
      d +=
        (connected && linked ? "L" : "M") +
        (10 + (m / Math.max(x, 1)) * 580) +
        "," +
        (120 - ((h - low) / Math.max(10, high - low)) * 105);
      connected = true;
    }
    const path = document.createElementNS(ns, "path");
    for (const [k, v] of Object.entries({
      d,
      fill: "none",
      stroke: "#28684e",
      "stroke-width": 3,
    }))
      path.setAttribute(k, v);
    svg.append(path);
    target.append(
      svg,
      el(
        "p",
        `實際高度 ${Math.round(low)}–${Math.round(high)} m · 已記錄 ${(a.distance / 1000).toFixed(2)} km`,
        "muted",
      ),
    );
  }
  function render() {
    const running = active?.status === "recording";
    ctx.trackingStatus?.(!active ? "" : running ? (message.startsWith("GPS 曾中斷") ? message.replace("；該段未計距離", "") : "活動記錄中") : "活動已暫停");
    host.classList.toggle("is-expanded", expanded);
    host.classList.toggle("has-activity", !!active);
    $("activitySheetToggle").setAttribute("aria-expanded", String(expanded));
    $("activitySheetToggle").setAttribute(
      "aria-label",
      expanded ? "縮小活動面板" : "展開活動面板",
    );
    $("activitySheetToggle").querySelector("b").textContent = expanded ? "⌄" : "⌃";
    $("startActivity").classList.toggle("hide", !!active);
    $("startActivity").disabled = busy;
    $("activityBody").classList.toggle("hide", !active);
    $("activityTitle").textContent = active
      ? running
        ? "活動進行中"
        : "活動已暫停"
      : "開始你嘅行程";
    $("activityStatus").textContent =
      (message || "開始後會要求 GPS 定位，活動只儲存在此裝置。") +
      (active?.gpsGapSeconds ? ` 累計有 ${active.gpsGapCount || 1} 次 GPS 中斷、約 ${active.gpsGapSeconds} 秒沒有計算距離。` : "");
    $("gps").disabled = !!running;
    for (const id of ["pauseActivity", "resumeActivity", "finishActivity"])
      $(id).disabled = busy;
    $("pauseActivity").classList.toggle("hide", !running);
    $("resumeActivity").classList.toggle("hide", !!running);
    if (!active) {
      $("activityTime").textContent = "00:00";
      $("activityDistance").textContent = "0.00";
      $("activityGain").textContent = "0";
      $("activityRemaining").textContent =
        ctx.getRoute()?.stats?.km?.toFixed?.(2) || "—";
      $("activityPace").textContent = "—";
      $("activitySpeed").textContent = "0.0";
      return;
    }
    const m = metrics(active);
    $("activityTime").textContent = clock(m.ms);
    $("activityDistance").textContent = m.km < 1 ? m.km.toFixed(3) : m.km.toFixed(2);
    $("activityGain").textContent =
      m.ascent === null ? "—" : Math.round(m.ascent);
    $("activityRemaining").textContent =
      m.remaining === null ? "—" : m.remaining.toFixed(2);
    $("activityPace").textContent =
      m.pace === null ? "—" : clock(m.pace * 1000);
    $("activitySpeed").textContent = m.speed.toFixed(1);
  }
  async function start() {
    if (busy || active) return;
    if (!ctx.isReady()) return ctx.toast("本機儲存未就緒。");
    if (ctx.isEditing()) return ctx.toast("請先完成路線編輯。");
    busy = true;
    render();
    try {
      if (!(await lock())) throw Error("另一個視窗正在記錄活動。");
      const draft = await store.get("settings", "active-activity");
      if (draft?.value) {
        active = draft.value;
        pause(active, active.savedAt);
        message = "已找回未完成活動，請按繼續。";
      } else {
        active = newActivity(ctx.getRoute());
        message = "活動已建立，等候定位。";
      }
      // Enter the compact map-first tracker. Full details remain one tap away.
      expanded = false;
      $("activityName").value = active.name;
      await save();
      if (!draft?.value) {
        resume(active);
        await save();
        ctx.ensureGPS();
        await syncWake();
      }
      profile(active, $("activityProfile"));
    } catch (e) {
      ctx.toast(ctx.failure(e));
      if (!active) unlock();
    } finally {
      busy = false;
      render();
    }
  }
  async function suspend(reason) {
    if (!active || active.status !== "recording") return;
    if (reason && /切換 App|熄屏|離開頁面/.test(reason)) active.interruptedAt = Date.now();
    pause(active);
    ctx.stopGPS();
    await wake.release();
    message = reason || "已暫停；休息時間及移動不會計入。";
    render();
    try {
      await save();
    } catch {}
  }
  async function continueActivity() {
    if (busy || !active) return;
    busy = true;
    render();
    try {
      if (!(await lock())) throw Error("另一個視窗正在使用活動紀錄。");
      const now = Date.now(), interrupted = active.interruptedAt ? Math.max(0,Math.round((now-active.interruptedAt)/1000)) : 0;
      if(interrupted){active.gpsGapSeconds=(active.gpsGapSeconds||0)+interrupted;active.gpsGapCount=(active.gpsGapCount||0)+1;active.interruptedAt=null;}
      resume(active,now);
      message = interrupted ? `已重新記錄；中斷 ${interrupted} 秒期間未計距離。` : "等候新 GPS 訊號…";
      await save();
      ctx.ensureGPS();
      await syncWake();
    } catch (e) {
      pause(active);
      await wake.release();
      ctx.toast(ctx.failure(e));
    } finally {
      busy = false;
      render();
    }
  }
  async function finish() {
    if (busy || !active) return;
    busy = true;
    await suspend("正在儲存活動…");
    render();
    try {
      active.name = $("activityName").value.trim() || active.name;
      await save();
      await store.finishActivity({
        ...checkpoint(active),
        status: "completed",
        ended: Date.now(),
        started: null,
      });
      active = null;
      ctx.map.setActivityTrack([]);
      unlock();
      message = "活動已儲存，可到「活動紀錄」查看或匯出。";
      ctx.toast(message);
    } catch (e) {
      message = "儲存失敗，活動仍保留，請重試。";
      ctx.toast(ctx.failure(e));
    } finally {
      busy = false;
      render();
    }
  }
  async function showHistory() {
    try {
      const items = (await store.getAll("activities")).sort(
          (a, b) => b.created - a.created,
        ),
        list = $("activityHistoryList");
      list.replaceChildren();
      if (!items.length) list.append(el("p", "未有已完成活動。"));
      for (const a of items) {
        const card = el("article", undefined, "activity-record"),
          m = metrics(a);
        card.append(
          el("h3", a.name),
          el("p", new Date(a.created).toLocaleString()),
          el("strong", m.km.toFixed(2) + " km · " + clock(m.ms)),
        );
        const b = el("button", "查看活動");
        b.onclick = () => showDetail(a);
        card.append(b);
        list.append(card);
      }
      ctx.nav("history");
    } catch (e) {
      ctx.toast(ctx.failure(e));
    }
  }
  function showDetail(a) {
    viewed = a;
    $("savedActivityName").textContent = a.name;
    const m = metrics(a);
    const gps=a.gpsStats, accepted=gps?.accepted||0;
    $("savedActivityDetails").replaceChildren(
      el(
        "p",
        `${m.km.toFixed(2)} km · ${clock(m.ms)} · 平均 ${m.speed.toFixed(1)} km/h`,
      ),
      el(
        "p",
        `累計爬升 ${m.ascent === null ? "—" : Math.round(m.ascent) + " m"} · 平均配速 ${m.pace === null ? "—" : clock(m.pace * 1000) + "/km"}`,
      ),
      ...(a.gpsGapSeconds ? [el("p", `GPS 曾中斷 ${a.gpsGapCount || 1} 次、約 ${a.gpsGapSeconds} 秒；中斷期間沒有估算或補畫距離。`, "position-warning")] : []),
      ...(gps ? [el("p", `GPS 診斷：收到 ${gps.received} 點、接受 ${accepted} 點、精度不足 ${gps.poor} 點、漂移 ${gps.drift} 點、跳點 ${gps.jumps} 點${accepted ? `、平均水平精度 ±${Math.round(gps.accuracyTotal/accepted)} m` : ""}。`, "muted")] : []),
    );
    profile(a, $("savedActivityProfile"));
    $("exportActivity").disabled = !a.segments.some((s) => s.length > 1);
    detail.showModal();
  }
  $("startActivity").onclick = start;
  $("activitySheetToggle").onclick = () => {
    expanded = !expanded;
    render();
  };
  $("activityMinimize").onclick = () => {
    expanded = false;
    render();
  };
  $("activityDetailsShortcut").onclick = () => $("activityHistory").click();
  $("showBreadcrumb").onclick = () => {
    if (!ctx.map.fitActivityTrack()) return ctx.toast("未有足夠 GPS 軌跡可顯示。");
    expanded = false;
    render();
    ctx.toast("已顯示完整來時軌跡；橙線由起點連到目前位置。");
  };
  $("activityGpsShortcut").onclick = () => ctx.openSettings();
  $("pauseActivity").onclick = () => suspend();
  $("resumeActivity").onclick = continueActivity;
  $("finishActivity").onclick = finish;
  $("activityHistory").onclick = showHistory;
  $("closeActivityHistory").onclick = () => ctx.nav("routes");
  $("closeActivityDetail").onclick = () => detail.close();
  $("activityName").onchange = () => {
    if (active) {
      active.name = $("activityName").value.trim() || active.name;
      save().catch(() => {});
    }
  };
  $("keepAwake").onchange = async () => {
    store
      .put("settings", { id: "keep-awake", value: $("keepAwake").checked })
      .catch(() => {});
    await syncWake();
  };
  $("exportActivity").onclick = () => {
    if (!viewed) return;
    const url = URL.createObjectURL(
        new Blob([toGPX({ ...viewed, waypoints: [] })], {
          type: "application/gpx+xml",
        }),
      ),
      a = el("a");
    a.href = url;
    a.download =
      viewed.name.replace(/[^\p{L}\p{N}_-]/gu, "_") + "-activity.gpx";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) suspend("切換 App／熄屏後已暫停，請按繼續活動。");
  });
  window.addEventListener("pagehide", () => {
    suspend("離開頁面後已暫停。");
  });
  setInterval(() => {
    if (active) {
      render();
      if (active.status === "recording" && Date.now() - lastSave >= 5000)
        save().catch(() => {});
    }
  }, 1000);
  return {
    openPanel() {
      expanded = true;
      render();
      host.scrollIntoView({ block: "end", behavior: "smooth" });
    },
    minimizePanel() {
      expanded = false;
      render();
    },
    isRecording: () => active?.status === "recording",
    onError: () => suspend("定位未能使用，活動已暫停；請確認定位權限後繼續。"),
    onFix(fix) {
      if (!active || active.status !== "recording") return;
      message = addFix(active, fix);
      ctx.map.setActivityTrack(active.segments);
      profile(active, $("activityProfile"));
      if (active.status === "paused") ctx.stopGPS();
      render();
      save().catch(() => {});
    },
    async init() {
      if (!(await lock())) {
        message = "另一個視窗正在記錄活動。";
        render();
        return;
      }
      const [draft, pref] = await Promise.all([
        store.get("settings", "active-activity"),
        store.get("settings", "keep-awake"),
      ]);
      $("keepAwake").checked = pref?.value !== false;
      if (draft?.value) {
        active = draft.value;
        pause(active, active.savedAt);
        $("activityName").value = active.name;
        const points = active.segments.reduce((n, s) => n + s.length, 0),
          saved = active.savedAt ? new Date(active.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "上次儲存";
        message = `已恢復未完成活動（${points} 個 GPS 點，${saved} 儲存），目前已暫停；中斷期間未計入。`;
        ctx.map.setActivityTrack(active.segments);
        profile(active, $("activityProfile"));
        await save();
      } else unlock();
      render();
    },
  };
}
