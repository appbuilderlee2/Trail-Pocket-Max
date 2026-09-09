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

  for (const source of [html, ui, worker]) assert.match(source, /v4\.2\.1/);
});
