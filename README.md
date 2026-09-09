# Trail Pocket PWA v4.2.4

Trail Pocket is an offline-first hiking PWA designed for iPhone and modern browsers, with a strong focus on reliable South Australia hiking maps.

> **Current status:** the v4 production package infrastructure is live and the seven South Australia regions are available through the production catalog. Real-iPhone field testing remains recommended before relying on the app for a remote hike.

## v4.2.4

- Rebuilt Settings with a clearer mobile-first hierarchy.
- Added an at-a-glance offline shell and storage summary.
- Grouped location, offline maps, map/activity preferences, and app/data tools into distinct sections.
- Kept detailed safety and storage guidance available in compact expandable panels.
- Preserved all existing setting IDs and workflows for GPS, compass, map layers, alerts, backups, restore, storage persistence, integrity audit, update checks, and safe legacy-map cleanup.
- Keeps the combined location card title stable after the legacy compass controls initialise.
- Removes the redundant Settings and My page titles to free more vertical space on phones.
- Keeps all three expandable Settings help rows in one consistently spaced group.
- Removes duplicated iPhone safe-area padding from the floating bottom navigation and lowers the idle activity card to match its compact height.

## v4.0.0-beta.7

The current `main` branch uses the new v4 vector/offline-package architecture.

### Map engine

- MapLibre GL JS vector-map engine.
- OpenFreeMap for online vector browsing.
- Outdoor-oriented map styling inspired by the clarity of Organic Maps.
- GPX/KML route overlays and GPS/activity display remain part of the app.

### Large offline maps

- PMTiles is the primary v4 offline map format.
- Large package files are stored in OPFS where supported.
- IndexedDB stores package metadata, download state and app records.
- PMTiles can be read directly from local storage by the MapLibre map layer.

### Reliable downloads

- Resumable HTTP Range downloads.
- Download progress and pause/resume state.
- Storage/capacity checks before large downloads.
- SHA-256 integrity verification.
- Corrupted package detection and repair/re-download support.
- Download state survives interruption rather than silently marking incomplete data as installed.
- Already completed production regions are skipped by **Download All** when the installed version matches the current catalog.

## South Australia offline package system

Trail Pocket v4 divides South Australia into seven production regions:

1. Adelaide & Mount Lofty Ranges
2. Fleurieu Peninsula & Kangaroo Island
3. Yorke Peninsula & Mid North
4. Eyre Peninsula
5. Flinders Ranges & Far North
6. Murraylands & Riverland
7. Limestone Coast

The Offline Maps screen includes **South Australia / Download All**. This downloads all seven production regions, which together provide the complete South Australia offline catalog used by Trail Pocket.

The current production package set is approximately **522.7 MiB (about 548 MB)** before browser/device storage overhead.

Each production region contains:

- `*-map.pmtiles` — vector map package
- `*-search.index` — offline place/POI search index
- `*-routing.graph` — offline walking/trail graph
- `*-manifest.json` — file metadata, sizes and SHA-256 hashes

A combined `sa-index.json` describes the full seven-region downloadable catalog.

### Production delivery

The canonical packages are built and published to the `maps-v4-current` GitHub Release.

For browser/PWA downloads, the GitHub Pages deployment mirrors the current verified package files to the same origin under `/packages/`. This avoids browser CORS restrictions on direct GitHub Release asset downloads while preserving HTTP Range support for resumable downloads.

The live deployment has been verified to return:

- HTTP `206 Partial Content`
- `Accept-Ranges: bytes`
- correct `Content-Range`
- correct partial response size
- browser-compatible CORS headers

This is the production path used by the iPhone PWA downloader.

## South Australia build pipeline

GitHub Actions builds the South Australia packages from the current Geofabrik South Australia OSM extract.

Production builds:

- extract each configured region with `osmium`
- generate PMTiles with Planetiler
- create the offline search index
- create the walking/trail routing graph
- calculate file sizes and SHA-256 hashes
- publish package assets to the `maps-v4-current` release
- generate the combined seven-region `sa-index.json`
- mirror verified package files into the GitHub Pages deployment
- validate live HTTP Range delivery after deployment

The workflow validates that all **7 production manifests** exist before publishing the final production index.

A smaller **Para Wirra** pilot package remains available for explicit smoke testing and development validation.

## Production validation status

The current production deployment has passed:

- **102 / 102 automated reliability tests**
- all seven production package manifests present
- all 21 production data files verified by file size and SHA-256
- all seven `search.index` files parsed successfully
- all seven `routing.graph` files parsed successfully
- non-empty real walking graphs for every production region
- same-origin GitHub Pages package delivery
- live HTTP Range / resume-path validation

Current production search and walking graph data includes approximately:

| Region | Search entries | Walking graph nodes |
| --- | ---: | ---: |
| Adelaide & Mount Lofty Ranges | 132,697 | 827,207 |
| Fleurieu Peninsula & Kangaroo Island | 72,565 | 459,324 |
| Yorke Peninsula & Mid North | 24,007 | 354,192 |
| Eyre Peninsula | 12,332 | 367,835 |
| Flinders Ranges & Far North | 9,170 | 349,163 |
| Murraylands & Riverland | 20,513 | 294,707 |
| Limestone Coast | 11,317 | 116,100 |

## Offline search and walking network

Installed v4 packages can provide:

- offline place and POI search
- offline trail/road search data
- walking graph data for routing
- graph merging across overlapping installed regions

Routing is constrained by the downloaded walking graph. Trail Pocket must not invent a valid walking route where downloaded graph data does not support one.

## GPS and activity recording

Trail Pocket includes:

- current GPS position and accuracy
- activity recording
- distance tracking
- elevation data when iOS supplies usable altitude accuracy
- GPS quality filtering and jump rejection
- gap reporting when recording is interrupted
- route and breadcrumb display

### Important iPhone PWA limitation

iOS does not guarantee continuous background GPS for a Home Screen PWA. Screen lock, app switching or browser suspension can interrupt JavaScript and location updates. Trail Pocket records/report gaps rather than pretending missing GPS samples were continuous movement.

A future native iPhone version may be needed if guaranteed background tracking becomes a core requirement.

## GPX / KML and GeoPDF

Existing Trail Pocket functions include:

- import multiple GPX/KML routes
- preserve multi-segment tracks
- route storage and management
- GPX export
- official geospatial PDF import where supported geographic metadata is present
- offline GeoPDF display with GPS overlay

## Backup and migration

v4 introduces a newer backup/storage architecture while preserving the goal of safe migration from existing Trail Pocket data.

The design principles are:

- never silently overwrite a known-good offline package with an incomplete one
- validate new package data before marking it ready
- preserve existing routes and user records during schema upgrades
- retain a recovery path when migrating old data

## PWA deployment

GitHub Pages:

`https://appbuilderlee2.github.io/Trail-Pocket/`

The app is deployed as a static PWA through GitHub Actions.

On iPhone:

1. Open the GitHub Pages site in Safari.
2. Tap **Share**.
3. Tap **Add to Home Screen**.
4. Open Trail Pocket from the Home Screen.
5. Open the offline package manager.
6. Download an individual region or choose **South Australia / Download All**.
7. Keep enough free storage available; the current seven-region package data is about 548 MB before local storage overhead.
8. Test the downloaded map in Airplane Mode before relying on it outdoors.

Do not open `index.html` directly from the Files app; Service Worker, modules, OPFS/IndexedDB and PWA behaviour require a proper HTTPS origin.

## Remaining beta validation before v4.0 stable

The production package infrastructure is complete. The remaining beta work is primarily real-device validation:

- full **South Australia / Download All** on a real iPhone
- pause, close/reopen and resume during a real large download
- insufficient-storage behaviour on iOS
- deliberate corruption / repair flow on-device
- cold restart in Airplane Mode
- PMTiles reopening from OPFS after app restart
- offline search with no network
- walking route across regional overlap/boundaries
- real iPhone GPS recording
- screen-lock/app-switch gap behaviour
- long-distance outdoor comparison walk

## Development

Node.js 20 or later:

```bash
npm install
npm test
```

For local static testing:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000/` in a browser. Production PWA behaviour on iPhone still requires HTTPS.

When changing public app resources, keep the visible version and the Service Worker cache version synchronized so installed PWAs can receive the update correctly.

## Data and attribution

- Online vector-map rendering uses OpenFreeMap/OpenStreetMap-derived data according to the applicable provider terms and attribution requirements.
- Offline South Australia packages are generated from OpenStreetMap data. © OpenStreetMap contributors, ODbL 1.0.
- Weather features use Open-Meteo where enabled.
- Existing elevation/terrain features may use Mapzen Terrain Tiles / AWS Open Data and their underlying attribution requirements.

Trail Pocket is a hiking aid, not an authoritative source for closures, hazards or emergency navigation. Current park alerts, official signage and emergency advice take priority.

## Version history

The Git history contains the detailed v2.x/v3.x development record, including GeoPDF, offline Overpass maps, contours, activity recording, GPS reliability, map-first mobile UI and earlier offline-download architecture.

Current application version: **v4.0.0-beta.7**.
