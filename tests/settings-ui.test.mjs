import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('settings redesign keeps every existing functional control unique', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  const ids = [
    'gps', 'compassToggle', 'gpsStatus', 'emergencyCoords', 'emergencyMeta',
    'copyPosition', 'settingsOfflineMaps', 'settingsMapSource', 'settingsLayers',
    'settingsAlerts', 'downloadContours', 'keepAwake', 'checkAppUpdate', 'audit',
    'backupAll', 'restoreAll', 'persist', 'cleanupLegacyMaps', 'backupGeoPdfs',
    'backupFile', 'shellIcon', 'shellStatus', 'storageInfo',
  ];

  for (const id of ids) {
    const matches = html.match(new RegExp(`id=["']${id}["']`, 'g')) || [];
    assert.equal(matches.length, 1, `${id} must exist exactly once`);
  }
});

test('settings release version stays aligned with the service worker', async () => {
  const [html, ui, worker] = await Promise.all([
    readFile(new URL('index.html', root), 'utf8'),
    readFile(new URL('unified-ui.mjs', root), 'utf8'),
    readFile(new URL('sw.js', root), 'utf8'),
  ]);

  for (const source of [html, ui, worker]) assert.match(source, /v4\.2\.7/);
});

test('mobile navigation counts the iPhone safe area only once', async () => {
  const css = await readFile(new URL('unified-ui.css', root), 'utf8');
  const fix = css.match(/v4\.2\.7:[\s\S]*$/)?.[0] || '';
  assert.match(fix, /bottom:max\(6px,env\(safe-area-inset-bottom\)\)/);
  assert.match(fix, /padding:5px 6px/);
  assert.doesNotMatch(fix, /padding[^;]*safe-area-inset-bottom/);
  assert.match(fix, /bottom:calc\(76px \+ env\(safe-area-inset-bottom\)\)!important/);
});

test('all expandable settings guides share the same spacing container', async () => {
  const ui = await readFile(new URL('unified-ui.mjs', root), 'utf8');
  assert.match(ui, /querySelector\('#settingsView \.settings-help-group'\)[^;]*\.append\(downloadGuide\)/);
});

test('bottom navigation labels are not repeated as page-top titles', async () => {
  const [html, ui] = await Promise.all([
    readFile(new URL('index.html', root), 'utf8'),
    readFile(new URL('unified-ui.mjs', root), 'utf8'),
  ]);

  const settings = html.match(/<section id="settingsView"[\s\S]*?<\/section>\s*<\/main>/)?.[0] || '';
  assert.doesNotMatch(settings, /<h1>設定<\/h1>/);
  assert.doesNotMatch(ui, /library-header[^;]*<h1>我的<\/h1>/);
});


test('saved activities can be deleted and the mobile activity sheet stays compact', async () => {
  const [ui, storage, css] = await Promise.all([
    readFile(new URL('activity.mjs', root), 'utf8'),
    readFile(new URL('storage.mjs', root), 'utf8'),
    readFile(new URL('activity.css', root), 'utf8'),
  ]);
  assert.match(storage, /export const removeActivity/);
  assert.match(ui, /id="deleteActivity"/);
  assert.match(ui, /deleteSavedActivity/);
  assert.match(css, /#activityProfile \{ min-height:0;padding:0; \}/);
  assert.match(css, /\.activity-actions \{\s*position:static;/);
});


test('GeoPDF overlay avoids full-image work on every mobile pointer event', async () => {
  const [map, geoPdf] = await Promise.all([
    readFile(new URL('map.mjs', root), 'utf8'),
    readFile(new URL('geopdf.mjs', root), 'utf8'),
  ]);
  assert.match(map, /const cells = this\.w <= 700 \? 6 : 8/);
  assert.match(map, /Skip cells outside the viewport/);
  assert.match(map, /drawImage\(this\.geoImage, sx, sy, sw, sh, sx, sy, sw, sh\)/);
  assert.match(map, /requestDraw\(\)/);
  assert.match(geoPdf, /cachedImageId === record\.id && cachedImage/);
});


test('production map downloads use Trail-Pocket-Max and migrate old saved URLs', async () => {
  const manager = await readFile(new URL('package-manager.mjs', root), 'utf8');
  assert.match(manager, /Trail-Pocket-Max\/releases\/download\/maps-v4-current/);
  assert.match(manager, /currentReleaseUrls\(saved\)/);
  assert.match(manager, /CURRENT_RELEASE_ROOT\+file\.url\.slice/);
  assert.doesNotMatch(manager, /RELEASE_INDEX_URL='https:\/\/github\.com\/appbuilderlee2\/Trail-Pocket\/releases\/download\/maps-v4-current/);
});
