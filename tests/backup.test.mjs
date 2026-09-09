import test from "node:test";
import assert from "node:assert/strict";
import {
  createBackup,
  validateBackup,
  backupCounts,
  BACKUP_FORMAT,
} from "../backup.mjs";
const sample = {
  routes: [{ id: "r1", name: "Route" }],
  maps: [{ id: "r1", data: { elements: [] }, contours: [] }],
  areas: [{ id: "a1", name: "Area" }],
  activities: [{ id: "x1", segments: [] }],
  settings: [
    { id: "keep-awake", value: true },
    { id: "active-activity", value: { secret: "draft" } },
  ],
  geopdfs: [{ id: "geopdf:1", imageData: "data:image/webp;base64,AA==" }],
};
test("v2 backup keeps personal data, references offline maps and excludes active recording draft", () => {
  const backup = createBackup(sample, 0),
    restored = validateBackup(JSON.parse(JSON.stringify(backup)));
  assert.equal(backup.format, BACKUP_FORMAT);
  assert.equal(backup.version, 2);
  assert.equal(backup.appVersion, "4.0.0-beta.7");
  assert.equal(backup.created, "1970-01-01T00:00:00.000Z");
  assert.deepEqual(backupCounts(restored), {
    routes: 1,
    maps: 0,
    areas: 0,
    activities: 1,
    settings: 1,
    geopdfs: 1,
    markers: 0,
  });
  assert.equal(restored.data.settings[0].id, "keep-awake");
  assert.equal(restored.offline.legacyMaps[0].id, "r1");
});
test("invalid backup type, version and record IDs are rejected", () => {
  assert.throws(() => validateBackup({}), /不是受支援/);
  assert.throws(
    () => validateBackup({ format: BACKUP_FORMAT, version: 3, data: sample }),
    /不是受支援/,
  );
  const bad = createBackup(sample);
  bad.data.routes = [{ id: "" }];
  assert.throws(() => validateBackup(bad), /無效記錄/);
});
test("v1 backup remains restorable during safe migration", () => {
  const restored = validateBackup({format:BACKUP_FORMAT,version:1,created:"old",data:sample});
  assert.equal(restored.data.maps.length, 1);
  assert.deepEqual(restored.offline.packages, []);
});
