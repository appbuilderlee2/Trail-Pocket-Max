import { chooseHeading, destination, drawHeadingCone } from "./heading.mjs";
import { project, unproject, joinWays, distance } from "./core.mjs";
import { WORLD, viewportBounds } from "./explore-core.mjs";
import {
  geoToPage,
  pageToGeo,
  pointInFootprint,
  accuracyPixels,
} from "./geopdf-core.mjs";
export function mapFeatures(elements = []) {
  const shapes = [],
    points = [];
  for (const e of elements) {
    const tags = e.tags || {};
    if (e.type === "node" && Number.isFinite(e.lon) && Number.isFinite(e.lat)) {
      if (tags.name) points.push({ tags, point: project([e.lon, e.lat]) });
      continue;
    }
    let raw = [];
    if (e.geometry) raw = [e.geometry];
    else if (e.members)
      raw = e.members
        .filter((m) => m.type === "way" && m.geometry)
        .map((m) => m.geometry);
    let paths = raw
      .filter(
        (p) =>
          p.length > 1 &&
          p.every((x) => x && Number.isFinite(x.lon) && Number.isFinite(x.lat)),
      )
      .map((p) => p.map((x) => [x.lon, x.lat]));
    if (e.members) paths = joinWays(paths);
    if (paths.length) {
      shapes.push({ tags, paths: paths.map((p) => p.map(project)) });
      if (tags.name && !tags.highway) {
        const flat = paths.flat(),
          point = [
            flat.reduce((n, p) => n + p[0], 0) / flat.length,
            flat.reduce((n, p) => n + p[1], 0) / flat.length,
          ];
        points.push({ tags, point: project(point) });
      }
    }
  }
  return { shapes, points };
}
function surface(tags) {
  if (tags.building)
    return { fill: "#d8d1c5", stroke: "#b6aa9c", layer: "buildings" };
  if (
    tags.natural === "water" ||
    tags.waterway === "riverbank" ||
    tags.landuse === "reservoir"
  )
    return { fill: "#b0d3d1", layer: "water" };
  if (tags.natural === "wetland") return { fill: "#c5dcd4", layer: "water" };
  if (
    ["wood", "scrub", "heath"].includes(tags.natural) ||
    ["forest", "orchard", "vineyard"].includes(tags.landuse) ||
    tags.boundary === "protected_area"
  )
    return { fill: "#d4e1c7", layer: "forest" };
  if (
    tags.natural === "grassland" ||
    ["grass", "meadow", "farmland", "farmyard"].includes(tags.landuse) ||
    ["park", "garden", "nature_reserve", "recreation_ground"].includes(
      tags.leisure,
    )
  )
    return { fill: "#e1e8cf", layer: "forest" };
  if (
    ["residential", "commercial", "retail", "industrial"].includes(tags.landuse)
  )
    return { fill: "#e7e4dc", layer: "forest" };
  if (["bare_rock", "scree", "shingle", "sand", "beach"].includes(tags.natural))
    return { fill: "#eadfca", layer: "forest" };
  return null;
}
export class TrailMap {
  constructor(canvas, onPan) {
    this.c = canvas;
    this.ctx = canvas.getContext("2d");
    this.route = null;
    this.base = null;
    this.shapes = [];
    this.center = project([138.82, -34.682]);
    this.units = 80;
    this.fix = null;
    this.pointers = new Map();
    this.gesture = null;
    this.onPan = onPan;
    new ResizeObserver(() => this.resize()).observe(canvas);
    const state = () => {
      const p = [...this.pointers.values()];
      return p.length > 1
        ? {
            x: (p[0].x + p[1].x) / 2,
            y: (p[0].y + p[1].y) / 2,
            d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y),
          }
        : p.length
          ? { ...p[0], d: 0 }
          : null;
    };
    canvas.addEventListener("pointerdown", (e) => {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      canvas.setPointerCapture(e.pointerId);
      this.gesture = state();
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const next = state(),
        last = this.gesture;
      if (last) {
        this.onPan?.();
        const exclusiveGeo = this.geoPdf && !this.geoOverlay,
          center = exclusiveGeo ? this.geoCenter : this.center,
          units = exclusiveGeo ? this.geoUnits : this.units;
        center[0] -= (next.x - last.x) * units;
        center[1] -= (next.y - last.y) * units;
        if (next.d && last.d) {
          const r = canvas.getBoundingClientRect();
          this.zoom(last.d / next.d, next.x - r.left, next.y - r.top);
        } else this.draw();
      }
      this.gesture = next;
    });
    for (const kind of ["pointerup", "pointercancel", "lostpointercapture"])
      canvas.addEventListener(kind, (e) => {
        this.pointers.delete(e.pointerId);
        this.gesture = state();
      });
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.onPan?.();
        const r = canvas.getBoundingClientRect();
        this.zoom(
          Math.exp(Math.sign(e.deltaY) * 0.16),
          e.clientX - r.left,
          e.clientY - r.top,
        );
      },
      { passive: false },
    );
    this.resize();
  }
  resize() {
    const r = this.c.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.w = r.width;
    this.h = r.height;
    const d = Math.min(3, devicePixelRatio || 1);
    this.c.width = this.w * d;
    this.c.height = this.h * d;
    this.ctx.setTransform(d, 0, 0, d, 0, 0);
    this.vector?.resize();
    this.draw();
  }
  setLayers(layers) {
    this.layers = { ...layers };
    this.draw();
  }
  setActivityTrack(segments) {
    this.activityTrack = segments;
    this.draw();
  }
  setMarkers(markers) {
    this.markers = markers || [];
    this.draw();
  }
  fitActivityTrack() {
    const points = (this.activityTrack || []).flat();
    if (!points.length) return false;
    const xs = points.map((p) => project(p)[0]), ys = points.map((p) => project(p)[1]);
    this.center = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
    this.units = Math.max(
      (Math.max(...xs) - Math.min(...xs)) / Math.max(100, this.w - 90),
      (Math.max(...ys) - Math.min(...ys)) / Math.max(100, this.h - 160),
      0.8,
    ) * 1.18;
    this.draw();
    return true;
  }
  drawMarker(c, p, item) {
    c.save();
    c.beginPath();
    c.arc(p[0], p[1], 12, 0, Math.PI * 2);
    c.fillStyle = item.type === "parking" ? "#2569b0" : item.type === "junction" ? "#b76518" : "#43564c";
    c.fill();
    c.strokeStyle = "white";
    c.lineWidth = 3;
    c.stroke();
    c.fillStyle = "white";
    c.font = "bold 11px sans-serif";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(item.type === "parking" ? "P" : item.type === "junction" ? "Y" : "•", p[0], p[1]);
    c.restore();
  }
  setDraft(segments) {
    this.draft = segments;
    this.draw();
  }
  setReroute(segments) {
    this.reroute = segments;
    this.draw();
  }
  getOfflineRecords() {
    return [this.base, ...(this.regionRecords || [])].filter(Boolean);
  }
  centerPoint() {
    return this.geoPdf && !this.geoOverlay
      ? this.geoPdf.transform.center
      : unproject(this.center);
  }
  screen(p) {
    return [
      (p[0] - this.center[0]) / this.units + this.w / 2,
      (p[1] - this.center[1]) / this.units + this.h / 2,
    ];
  }
  zoom(f, x = this.w / 2, y = this.h / 2) {
    if (this.geoPdf && !this.geoOverlay) {
      const u = Math.max(
        0.04,
        Math.min(
          Math.max(this.geoImage?.width || 1, this.geoImage?.height || 1),
          this.geoUnits * f,
        ),
      );
      this.geoCenter[0] += (x - this.w / 2) * (this.geoUnits - u);
      this.geoCenter[1] += (y - this.h / 2) * (this.geoUnits - u);
      this.geoUnits = u;
      this.draw();
      return;
    }
    const u = Math.max(0.15, Math.min(200000, this.units * f));
    this.center[0] += (x - this.w / 2) * (this.units - u);
    this.center[1] += (y - this.h / 2) * (this.units - u);
    this.units = u;
    this.draw();
  }
  setGeoPdf(record, image, { overlay = false, opacity = 0.68 } = {}) {
    this.geoPdf = record || null;
    this.geoImage = image || null;
    this.geoOverlay = Boolean(record && overlay);
    this.geoOpacity = Math.max(0.15, Math.min(0.9, Number(opacity) || 0.68));
    if (record && image && !overlay) {
      this.geoCenter = [image.width / 2, image.height / 2];
      this.geoUnits = 1;
      this.fit();
    } else {
      this.onGeoFixState?.("none");
      this.draw();
    }
  }
  setRoute(route, base, fit = true) {
    this.route = route;
    this.projected = route?.segments.map((s) => s.map(project)) || [];
    this.setBase(base);
    if (fit) this.fit();
    else this.draw();
  }
  makeLayer(base) {
    return {
      bounds: base?.bounds,
      contours: (base?.contours || []).map((group) => ({
        elevation: group.elevation,
        paths: group.paths.map((path) => path.map(project)),
      })),
      ...mapFeatures(base?.data.elements),
    };
  }
  setBase(base) {
    this.base = base;
    this.routeLayer = this.makeLayer(base);
    this.draw();
  }
  setRegions(records) {
    this.regionRecords = records;
    this.regionLayers = records.map((r) => this.makeLayer(r));
    this.draw();
  }
  setPreviewBounds(bounds, label = "可離線範圍") {
    this.previewBounds = bounds || null;
    this.previewLabel = label || "可離線範圍";
    this.draw();
  }
  drawPreviewBounds(c) {
    const b = this.previewBounds;
    if (!b || this.geoPdf && !this.geoOverlay) return;
    const a = this.screen(project([b.west, b.north]));
    const z = this.screen(project([b.east, b.south]));
    const left = Math.min(a[0], z[0]), right = Math.max(a[0], z[0]);
    const top = Math.min(a[1], z[1]), bottom = Math.max(a[1], z[1]);
    const width = right - left, height = bottom - top;
    c.save();
    c.fillStyle = "rgba(17,45,35,.18)";
    c.beginPath();
    c.rect(0,0,this.w,this.h);
    c.rect(left,top,width,height);
    c.fill("evenodd");
    c.strokeStyle = "#16845d";
    c.lineWidth = 4;
    c.setLineDash([]);
    c.strokeRect(left,top,width,height);
    const text = "可離線範圍 · " + this.previewLabel;
    c.font = "bold 12px sans-serif";
    const tw = Math.min(Math.max(120,c.measureText(text).width + 20), Math.max(120,this.w - 24));
    const tx = Math.max(12, Math.min(left + 8, this.w - tw - 12));
    const ty = Math.max(48, Math.min(top + 8, this.h - 42));
    c.fillStyle = "rgba(25,63,50,.94)";
    c.fillRect(tx,ty,tw,30);
    c.fillStyle = "#fff";
    c.textAlign = "left";
    c.textBaseline = "middle";
    c.fillText(text,tx+10,ty+15,tw-20);
    c.restore();
  }
  viewBounds(inset = 0) {
    return viewportBounds(
      this.center,
      this.units,
      this.w || 300,
      this.h || 400,
      inset,
    );
  }
  fitBounds(b) {
    const a = project([b.west, b.north]),
      z = project([b.east, b.south]);
    this.center = [(a[0] + z[0]) / 2, (a[1] + z[1]) / 2];
    this.units =
      Math.max(
        (z[0] - a[0]) / Math.max(100, this.w - 80),
        (z[1] - a[1]) / Math.max(100, this.h - 100),
        0.8,
      ) * 1.15;
    this.draw();
  }
  fit() {
    if (this.geoPdf && this.geoImage && !this.geoOverlay) {
      this.geoCenter = [this.geoImage.width / 2, this.geoImage.height / 2];
      this.geoUnits =
        Math.max(
          this.geoImage.width / Math.max(100, this.w - 28),
          this.geoImage.height / Math.max(100, this.h - 28),
          0.04,
        ) * 1.02;
      this.draw();
      return;
    }
    if (!this.route) return;
    const pts = [
      ...this.projected.flat(),
      ...this.route.waypoints.map((w) => project(w.point)),
    ];
    let minx = Infinity,
      miny = Infinity,
      maxx = -Infinity,
      maxy = -Infinity;
    for (const p of pts) {
      minx = Math.min(minx, p[0]);
      maxx = Math.max(maxx, p[0]);
      miny = Math.min(miny, p[1]);
      maxy = Math.max(maxy, p[1]);
    }
    this.center = [(minx + maxx) / 2, (miny + maxy) / 2];
    this.units =
      Math.max(
        (maxx - minx) / Math.max(100, this.w - 120),
        (maxy - miny) / Math.max(100, this.h - 180),
        0.8,
      ) * 1.1;
    this.draw();
  }
  focus(point) {
    if (this.geoPdf && !this.geoOverlay) {
      const p = geoToPage(this.geoPdf.transform, point);
      this.geoCenter = [
        p[0] * this.geoImage.width,
        p[1] * this.geoImage.height,
      ];
      this.geoUnits = Math.min(0.8, this.geoUnits);
      this.draw();
      return;
    }
    this.center = project(point);
    this.units = Math.min(2, this.units);
    this.draw();
  }
  setCompass(reading) {
    this.compass = reading;
    this.draw();
  }
  drawDirection(c, p, point, screen) {
    const direction = chooseHeading(this.fix, this.compass);
    if (direction) drawHeadingCone(c, p, screen(destination(point, direction.bearing)));
  }
  setFix(fix, follow = false) {
    this.fix = fix;
    if (follow && fix) {
      if (this.geoPdf && !this.geoOverlay) {
        const point = [fix.coords.longitude, fix.coords.latitude];
        if (pointInFootprint(this.geoPdf.transform, point)) {
          const p = geoToPage(this.geoPdf.transform, point);
          this.geoCenter = [
            p[0] * this.geoImage.width,
            p[1] * this.geoImage.height,
          ];
        }
      } else this.center = project([fix.coords.longitude, fix.coords.latitude]);
    }
    this.draw();
  }
  geoScreen(point) {
    const p = geoToPage(this.geoPdf.transform, point);
    return [
      (p[0] * this.geoImage.width - this.geoCenter[0]) / this.geoUnits +
        this.w / 2,
      (p[1] * this.geoImage.height - this.geoCenter[1]) / this.geoUnits +
        this.h / 2,
    ];
  }
  drawGeoRoute(c) {
    for (const segment of this.route?.segments || []) {
      const points = segment
        .filter((p) => pointInFootprint(this.geoPdf.transform, p))
        .map((p) => this.geoScreen(p));
      if (points.length < 2) continue;
      for (const [color, width] of [
        ["#fff", 8],
        ["#16845d", 4.5],
      ]) {
        c.beginPath();
        points.forEach((p, i) => (i ? c.lineTo(...p) : c.moveTo(...p)));
        c.strokeStyle = color;
        c.lineWidth = width;
        c.stroke();
      }
    }
  }
  drawGeoOverlay(c) {
    if (!this.geoPdf || !this.geoImage || !this.geoOverlay) return;
    const cols = 10,
      rows = 10,
      width = this.geoImage.width,
      height = this.geoImage.height,
      point = (u, v) => {
        const geo = pageToGeo(this.geoPdf.transform, [u, v]);
        return geo ? this.screen(project(geo)) : null;
      },
      drawTriangle = (source, target) => {
        if (target.some((p) => !p)) return;
        const [s0, s1, s2] = source,
          [d0, d1, d2] = target,
          determinant =
            s0[0] * (s1[1] - s2[1]) +
            s1[0] * (s2[1] - s0[1]) +
            s2[0] * (s0[1] - s1[1]);
        if (Math.abs(determinant) < 1e-8) return;
        const coefficient = (v0, v1, v2) => [
            (v0 * (s1[1] - s2[1]) +
              v1 * (s2[1] - s0[1]) +
              v2 * (s0[1] - s1[1])) /
              determinant,
            (v0 * (s2[0] - s1[0]) +
              v1 * (s0[0] - s2[0]) +
              v2 * (s1[0] - s0[0])) /
              determinant,
            (v0 * (s1[0] * s2[1] - s2[0] * s1[1]) +
              v1 * (s2[0] * s0[1] - s0[0] * s2[1]) +
              v2 * (s0[0] * s1[1] - s1[0] * s0[1])) /
              determinant,
          ],
          x = coefficient(d0[0], d1[0], d2[0]),
          y = coefficient(d0[1], d1[1], d2[1]);
        c.save();
        c.beginPath();
        c.moveTo(...d0);
        c.lineTo(...d1);
        c.lineTo(...d2);
        c.closePath();
        c.clip();
        c.transform(x[0], y[0], x[1], y[1], x[2], y[2]);
        c.drawImage(this.geoImage, 0, 0);
        c.restore();
      };
    c.save();
    c.globalAlpha = this.geoOpacity;
    for (let row = 0; row < rows; row++)
      for (let col = 0; col < cols; col++) {
        const u0 = col / cols,
          u1 = (col + 1) / cols,
          v0 = row / rows,
          v1 = (row + 1) / rows,
          source = [
            [u0 * width, v0 * height],
            [u1 * width, v0 * height],
            [u1 * width, v1 * height],
            [u0 * width, v1 * height],
          ],
          target = [point(u0, v0), point(u1, v0), point(u1, v1), point(u0, v1)];
        drawTriangle(
          [source[0], source[1], source[2]],
          [target[0], target[1], target[2]],
        );
        drawTriangle(
          [source[0], source[2], source[3]],
          [target[0], target[2], target[3]],
        );
      }
    c.restore();
  }
  drawGeo(c) {
    c.clearRect(0, 0, this.w, this.h);
    c.fillStyle = "#e9e7df";
    c.fillRect(0, 0, this.w, this.h);
    const x = this.w / 2 - this.geoCenter[0] / this.geoUnits,
      y = this.h / 2 - this.geoCenter[1] / this.geoUnits,
      w = this.geoImage.width / this.geoUnits,
      h = this.geoImage.height / this.geoUnits;
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = "high";
    c.drawImage(this.geoImage, x, y, w, h);
    c.strokeStyle = "#5b665a";
    c.lineWidth = 1;
    c.strokeRect(x, y, w, h);
    this.drawGeoRoute(c);
    for (const segment of this.activityTrack || []) {
      let run = [];
      const flush = () => {
        if (run.length > 1) {
          c.beginPath();
          run.forEach((p, i) => (i ? c.lineTo(...p) : c.moveTo(...p)));
          c.strokeStyle = "#fff";
          c.lineWidth = 7;
          c.stroke();
          c.strokeStyle = "#d27237";
          c.lineWidth = 4;
          c.stroke();
        }
        run = [];
      };
      for (const p of segment) {
        if (pointInFootprint(this.geoPdf.transform, p))
          run.push(this.geoScreen(p));
        else flush();
      }
      flush();
    }
    for (const item of this.markers || [])
      if (pointInFootprint(this.geoPdf.transform, item.point))
        this.drawMarker(c, this.geoScreen(item.point), item);
    let state = "waiting";
    if (this.fix) {
      const f = this.fix,
        point = [f.coords.longitude, f.coords.latitude];
      if (pointInFootprint(this.geoPdf.transform, point)) {
        state = "inside";
        const p = this.geoScreen(point),
          stale = Date.now() - f.timestamp > 20000,
          color = stale ? "#8a8a83" : "#258bdb",
          r = Math.min(
            160,
            accuracyPixels(
              this.geoPdf.transform,
              point,
              f.coords.accuracy,
              this.geoImage.width,
              this.geoImage.height,
            ) / this.geoUnits,
          );
        c.beginPath();
        c.arc(p[0], p[1], Math.max(4, r), 0, Math.PI * 2);
        c.fillStyle = stale ? "#88888822" : "#258bdb22";
        c.fill();
        c.beginPath();
        this.drawDirection(c, p, point, q => this.geoScreen(q));
        c.beginPath();
        c.arc(p[0], p[1], 7, 0, Math.PI * 2);
        c.fillStyle = color;
        c.fill();
        c.strokeStyle = "#fff";
        c.lineWidth = 3;
        c.stroke();
      } else state = "outside";
    }
    this.onGeoFixState?.(state);
    const center = this.geoPdf.transform.center,
      px100 =
        accuracyPixels(
          this.geoPdf.transform,
          center,
          100,
          this.geoImage.width,
          this.geoImage.height,
        ) / this.geoUnits,
      mpp = 100 / Math.max(0.01, px100),
      target = 85 * mpp,
      pow = 10 ** Math.floor(Math.log10(target)),
      len =
        [1, 2, 5, 10]
          .map((n) => n * pow)
          .filter((n) => n <= target)
          .pop() || pow;
    c.fillStyle = "#fffffff0";
    c.fillRect(14, this.h - 53, 110, 39);
    c.font = "10px sans-serif";
    c.textAlign = "left";
    c.textBaseline = "alphabetic";
    c.fillStyle = "#294b3b";
    c.fillText(len >= 1000 ? len / 1000 + " km" : len + " m", 24, this.h - 35);
    c.beginPath();
    c.moveTo(24, this.h - 27);
    c.lineTo(24, this.h - 23);
    c.lineTo(24 + len / mpp, this.h - 23);
    c.lineTo(24 + len / mpp, this.h - 27);
    c.strokeStyle = "#294b3b";
    c.lineWidth = 1.5;
    c.stroke();
  }
  line(points, color, width, dash = []) {
    const ctx = this.ctx;
    ctx.beginPath();
    points.forEach((p, i) => {
      const [x, y] = this.screen(p);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  draw() {
    const c = this.ctx;
    if (!c || !this.w) return;
    if (this.geoPdf && this.geoImage && !this.geoOverlay) {
      this.drawGeo(c);
      return;
    }
    this.center[0] = Math.max(-WORLD / 2, Math.min(WORLD / 2, this.center[0]));
    const limit = Math.abs(project([0, 85])[1]);
    this.center[1] = Math.max(-limit, Math.min(limit, this.center[1]));
    const viewKey = [...this.center, this.units, this.w, this.h].join(",");
    if (viewKey !== this.viewKey) {
      this.viewKey = viewKey;
      this.onViewChange?.();
    }
    const layers = {
      forest: true,
      water: true,
      roads: true,
      buildings: true,
      pois: true,
      labels: true,
      contours: true,
      waypoints: true,
      slope: false,
      ...this.layers,
    };
    c.clearRect(0, 0, this.w, this.h);
    const vector = Boolean(this.vector?.enabled);
    if (vector) this.vector.sync(this.center, this.units);
    else {
      c.fillStyle = "#f0f0e8";
      c.fillRect(0, 0, this.w, this.h);
    }
    c.lineCap = "round";
    c.lineJoin = "round";
    const raster = vector || this.online?.draw(
        c,
        this.center,
        this.units,
        this.w,
        this.h,
      ),
      offlineLayers = [...(this.regionLayers || []), this.routeLayer].filter(
        Boolean,
      );
    if (!raster)
      for (const layer of offlineLayers) {
        const b = layer.bounds;
        if (!b) continue;
        const a = this.screen(project([b.west, b.north])),
          z = this.screen(project([b.east, b.south]));
        c.save();
        c.beginPath();
        c.rect(a[0], a[1], z[0] - a[0], z[1] - a[1]);
        c.clip();
        c.fillStyle = "#e8eddf";
        c.fillRect(0, 0, this.w, this.h);
        c.restore();
      }
    for (const layer of offlineLayers) {
      const b = layer.bounds;
      if (!b || raster) continue;
      const a = this.screen(project([b.west, b.north])),
        z = this.screen(project([b.east, b.south]));
      c.save();
      c.beginPath();
      c.rect(a[0], a[1], z[0] - a[0], z[1] - a[1]);
      c.clip();
      for (const s of layer.shapes) {
        const style = surface(s.tags);
        if (style && layers[style.layer]) {
          c.beginPath();
          for (const p of s.paths) {
            p.forEach((v, i) => {
              const [x, y] = this.screen(v);
              if (i) c.lineTo(x, y);
              else c.moveTo(x, y);
            });
            if (p.length > 2) c.closePath();
          }
          c.fillStyle = style.fill;
          c.fill("evenodd");
          if (style.stroke) {
            c.strokeStyle = style.stroke;
            c.lineWidth = 1;
            c.stroke();
          }
        }
      }
      for (const s of layer.shapes) {
        const t = s.tags;
        if (layers.water && t.waterway && t.waterway !== "riverbank")
          for (const p of s.paths) this.line(p, "#9cbdc1", 1.3);
      }
      if (layers.contours)
        for (const group of layer.contours || []) {
          const index = group.elevation % 100 === 0;
          c.beginPath();
          for (const p of group.paths) {
            p.forEach((v, i) => {
              const [x, y] = this.screen(v);
              if (i) c.lineTo(x, y);
              else c.moveTo(x, y);
            });
          }
          c.strokeStyle = index ? "#987357" : "#b79b80";
          c.globalAlpha = raster ? 0.78 : 0.7;
          c.lineWidth = index ? 1.25 : 0.65;
          c.stroke();
          c.globalAlpha = 1;
          if (index && layers.labels && this.units < 8) {
            const path = group.paths.reduce(
              (a, p) => (p.length > a.length ? p : a),
              [],
            );
            if (path.length) {
              const [x, y] = this.screen(path[Math.floor(path.length / 2)]);
              if (x > 35 && x < this.w - 35 && y > 35 && y < this.h - 35) {
                c.font = "9px sans-serif";
                c.textAlign = "center";
                c.lineWidth = 3;
                c.strokeStyle = "#f6f8f0";
                c.strokeText(group.elevation + " m", x, y);
                c.fillStyle = "#795b47";
                c.fillText(group.elevation + " m", x, y);
              }
            }
          }
        }
      const labels = new Set();
      for (const s of layer.shapes) {
        const t = s.tags;
        if (!t.highway || !layers.roads) continue;
        const trail = [
            "path",
            "footway",
            "track",
            "steps",
            "bridleway",
            "cycleway",
          ].includes(t.highway),
          major = ["motorway", "trunk", "primary", "secondary"].includes(
            t.highway,
          ),
          minor = [
            "service",
            "residential",
            "living_street",
            "unclassified",
            "tertiary",
          ].includes(t.highway);
        for (const p of s.paths) {
          if (!trail)
            this.line(
              p,
              major ? "#b9b7ae" : "#c8c7bf",
              major ? 7 : minor ? 5 : 3,
            );
          this.line(
            p,
            trail
              ? t.highway === "track"
                ? "#9b856b"
                : "#839b73"
              : major
                ? "#fff4d6"
                : "#fffef5",
            trail ? 1.7 : major ? 4.5 : minor ? 3 : 2,
            trail ? [5, 4] : [],
          );
          if (
            layers.labels &&
            t.name &&
            !labels.has(t.name) &&
            this.units < 6
          ) {
            const v = this.screen(p[Math.floor(p.length / 2)]);
            if (
              v[0] > 40 &&
              v[0] < this.w - 100 &&
              v[1] > 75 &&
              v[1] < this.h - 60
            ) {
              labels.add(t.name);
              c.font = (major ? "bold " : "") + "10px sans-serif";
              c.textAlign = "center";
              c.lineWidth = 3;
              c.strokeStyle = "#f6f8f0";
              c.strokeText(t.name, v[0], v[1]);
              c.fillStyle = "#59675c";
              c.fillText(t.name, v[0], v[1]);
            }
          }
        }
      }
      if (layers.pois && layers.labels && this.units < 8)
        for (const item of layer.points || []) {
          if (labels.has(item.tags.name)) continue;
          const [x, y] = this.screen(item.point);
          if (x < 45 || x > this.w - 90 || y < 40 || y > this.h - 55) continue;
          labels.add(item.tags.name);
          const important =
            item.tags.natural === "peak" ||
            item.tags.amenity ||
            item.tags.tourism ||
            item.tags.place;
          c.beginPath();
          c.arc(x, y, important ? 3.5 : 2.5, 0, Math.PI * 2);
          c.fillStyle = item.tags.natural === "peak" ? "#6e4e3b" : "#805b39";
          c.fill();
          c.font = (important ? "bold " : "") + "10px sans-serif";
          c.textAlign = "left";
          c.lineWidth = 3;
          c.strokeStyle = "#f6f8f0";
          c.strokeText(item.tags.name, x + 6, y + 3);
          c.fillStyle = "#4f554d";
          c.fillText(item.tags.name, x + 6, y + 3);
        }
      c.restore();
      c.strokeStyle = "#b6c2ad";
      c.lineWidth = 1;
      c.setLineDash([5, 5]);
      c.strokeRect(a[0], a[1], z[0] - a[0], z[1] - a[1]);
      c.setLineDash([]);
    }
    this.drawGeoOverlay(c);
    for (const [si, s] of (this.projected || []).entries()) {
      this.line(s, "#fcfff9", 8);
      if (!layers.slope) this.line(s, "#288561", 4.5);
      else
        for (let i = 1; i < s.length; i++) {
          const a = this.route.segments[si][i - 1],
            b = this.route.segments[si][i],
            d = distance(a, b),
            known = Number.isFinite(a[2]) && Number.isFinite(b[2]) && d > 1,
            g = known ? Math.abs(b[2] - a[2]) / d : 0;
          this.line(
            [s[i - 1], s[i]],
            !known
              ? "#868b92"
              : g < 0.05
                ? "#288561"
                : g < 0.15
                  ? "#d68b21"
                  : "#bd493c",
            5,
          );
        }
    }
    if (this.route) {
      const markers = [
        { point: this.route.segments[0][0], label: "S" },
        ...(layers.waypoints
          ? this.route.waypoints.map((w, i) => ({
              point: w.point,
              label: String(i + 1),
            }))
          : []),
      ];
      for (const m of markers) {
        const [x, y] = this.screen(project(m.point));
        c.beginPath();
        c.arc(x, y, 10, 0, Math.PI * 2);
        c.fillStyle = "#fcfff8";
        c.fill();
        c.strokeStyle = "#265640";
        c.lineWidth = 2;
        c.stroke();
        c.fillStyle = "#265640";
        c.font = "bold 10px sans-serif";
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillText(m.label, x, y);
      }
    }
    if (this.reroute)
      for (const s of this.reroute) {
        this.line(s.map(project), "#fff", 8);
        this.line(s.map(project), "#1577c8", 4, [8, 4]);
      }
    if (this.draft) {
      for (const s of this.draft) {
        this.line(s.map(project), "#fff", 7);
        this.line(s.map(project), "#8057b8", 4, [6, 4]);
        for (const p of s) {
          const [x, y] = this.screen(project(p));
          c.beginPath();
          c.arc(x, y, 4, 0, Math.PI * 2);
          c.fillStyle = "#8057b8";
          c.fill();
        }
      }
      const x = this.w / 2,
        y = this.h / 2;
      c.strokeStyle = "#59318e";
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(x - 12, y);
      c.lineTo(x + 12, y);
      c.moveTo(x, y - 12);
      c.lineTo(x, y + 12);
      c.stroke();
    }
    for (const segment of this.activityTrack || []) {
      this.line(segment.map(project), "#fff", 7);
      this.line(segment.map(project), "#d27237", 4);
    }
    for (const item of this.markers || [])
      this.drawMarker(c, this.screen(project(item.point)), item);
    if (this.fix) {
      const f = this.fix,
        pt = [f.coords.longitude, f.coords.latitude],
        p = this.screen(project(pt)),
        stale = Date.now() - f.timestamp > 20000,
        color = stale ? "#8a8a83" : "#258bdb",
        acc =
          f.coords.accuracy /
          Math.max(0.01, Math.cos((pt[1] * Math.PI) / 180)) /
          this.units;
      c.beginPath();
      c.arc(p[0], p[1], Math.min(10000, acc), 0, Math.PI * 2);
      c.fillStyle = stale ? "#88888822" : "#258bdb22";
      c.fill();
      c.beginPath();
      this.drawDirection(c, p, pt, q => this.screen(project(q)));
      c.beginPath();
      c.arc(p[0], p[1], 7, 0, Math.PI * 2);
      c.fillStyle = color;
      c.fill();
      c.strokeStyle = "white";
      c.lineWidth = 3;
      c.stroke();
    }
    this.drawPreviewBounds(c);
    const lat = unproject(this.center)[1],
      mpp = this.units * Math.cos((lat * Math.PI) / 180),
      target = 85 * mpp,
      pow = 10 ** Math.floor(Math.log10(target)),
      len =
        [1, 2, 5, 10]
          .map((x) => x * pow)
          .filter((x) => x <= target)
          .pop() || pow;
    c.fillStyle = "#fffffff0";
    c.fillRect(14, this.h - 53, 110, 39);
    c.font = "10px sans-serif";
    c.textAlign = "left";
    c.textBaseline = "alphabetic";
    c.fillStyle = "#294b3b";
    c.fillText(len >= 1000 ? len / 1000 + " km" : len + " m", 24, this.h - 35);
    c.beginPath();
    c.moveTo(24, this.h - 27);
    c.lineTo(24, this.h - 23);
    c.lineTo(24 + len / mpp, this.h - 23);
    c.lineTo(24 + len / mpp, this.h - 27);
    c.strokeStyle = "#294b3b";
    c.lineWidth = 1.5;
    c.stroke();
  }
}
