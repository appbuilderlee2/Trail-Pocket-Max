const PREFIX =
  "trail-pocket-shell:" + new URL(self.registration.scope).pathname + ":";
const VERSION = PREFIX + "v4.2.6";
const ASSETS = [
  "./unified-ui.mjs",
  "./unified-ui.css",
  "./heading.mjs",
  "./reliability-core.mjs",
  "./markers.mjs",
  "./hiking-ui.css",
  "./backup.mjs",
  "./package-storage.mjs",
  "./package-manifest.mjs",
  "./package-downloader.mjs",
  "./package-manager.mjs",
  "./package-manager.css",
  "./package-manager-controls.css",
  "./config/sa-index.json",
  "./package-search.mjs",
  "./package-routing.mjs",
  "./sha256.mjs",
  "./vector-map.mjs",
  "./vector-map.css",
  "./outdoor-style.mjs",
  "./pmtiles-opfs.mjs",
  "./wake-lock.mjs",
  "./offline-download.mjs",
  "./offline-search.mjs",
  "./offline-regions.mjs",
  "./routing-core.mjs",
  "./routing-client.mjs",
  "./route-worker.mjs",
  "./offline-package.mjs",
  "./activity.mjs",
  "./activity-core.mjs",
  "./activity.css",
  "./geopdf.mjs",
  "./geopdf-core.mjs",
  "./geopdf-parser.mjs",
  "./geopdf-render.mjs",
  "./geopdf.css",
  "./map-source.css",
  "./vendor/pdf-lib.min.mjs",
  "./vendor/pdf.min.mjs",
  "./vendor/pdf.worker.min.mjs",
  "./vendor/maplibre-gl.mjs",
  "./vendor/maplibre-gl-shared.mjs",
  "./vendor/maplibre-gl-worker.mjs",
  "./vendor/maplibre-gl.css",
  "./vendor/pmtiles.js",
  "./",
  "./index.html",
  "./style.css",
  "./adventure.css",
  "./explore.css",
  "./explore-core.mjs",
  "./online-map.mjs",
  "./terrain.mjs",
  "./explore.mjs",
  "./app.mjs",
  "./core.mjs",
  "./storage.mjs",
  "./map.mjs",
  "./adventure.mjs",
  "./adventure-core.mjs",
  "./manifest.webmanifest",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/devils-route.json",
  "./assets/devils-base.json",
];
self.addEventListener("install", (e) =>
  e.waitUntil(
    caches.open(VERSION).then((c) =>
      c.addAll(
        ASSETS.map(
          (p) =>
            new Request(new URL(p, self.registration.scope), {
              cache: "reload",
            }),
        ),
      ),
    ),
  ),
);
self.addEventListener("activate", (e) =>
  e.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith(PREFIX) && key !== VERSION) await caches.delete(key);
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener("message", (e) => {
  if (e.data?.type === "UPDATE") self.skipWaiting();
  if (e.data?.type === "STATUS")
    e.waitUntil(
      (async () => {
        const c = await caches.open(VERSION);
        const ok = (
          await Promise.all(
            ASSETS.map((p) =>
              c.match(new URL(p, self.registration.scope).href),
            ),
          )
        ).every(Boolean);
        e.ports[0]?.postMessage({ ready: ok, version: VERSION });
      })(),
    );
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (
    e.request.method !== "GET" ||
    u.origin !== self.location.origin ||
    !u.href.startsWith(self.registration.scope)
  )
    return;
  const allowed = ASSETS.map(
    (p) => new URL(p, self.registration.scope).pathname,
  );
  if (!allowed.includes(u.pathname) && e.request.mode !== "navigate") return;
  e.respondWith(
    (async () => {
      const c = await caches.open(VERSION);
      const cached = await c.match(e.request, { ignoreSearch: true });
      if (cached) return cached;
      try {
        return await fetch(e.request);
      } catch (err) {
        if (e.request.mode === "navigate")
          return await c.match(
            new URL("./index.html", self.registration.scope).href,
          );
        throw err;
      }
    })(),
  );
});
