import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DOMParser } from "@xmldom/xmldom";
import { routeLength, parseRoute } from "../core.mjs";
import {
  elevationStats,
  planRoute,
  createCustomRoute,
  toGPX,
  advanceDeviation,
  weatherURL,
  weatherPoint,
  validateWeather,
} from "../adventure-core.mjs";
const segments = [
  [
    [138, -34, 100],
    [138.01, -34, 160],
    [138.02, -34, 130],
  ],
];
test("planner includes pace, rests and complete elevation allowance", () => {
  const p = planRoute(segments, 3, 20, 1);
  assert.equal(p.elevation.ascent, 60);
  assert.equal(p.elevation.descent, 30);
  assert.ok(p.elevation.complete);
  assert.ok(
    Math.abs(p.minutes - ((routeLength(segments) / 3000) * 60 + 6 + 20)) < 1e-7,
  );
  assert.equal(p.stages.length, 2);
});
test("missing elevation is not interpolated into a full climb", () => {
  const s = [
      [
        [138, -34, 100],
        [138.01, -34],
        [138.02, -34, 300],
      ],
    ],
    p = planRoute(s, 3, 0, 1);
  assert.equal(p.elevation.coverage, 0);
  assert.equal(p.elevation.complete, false);
  assert.equal(p.minutes, (routeLength(s) / 3000) * 60);
  assert.equal(
    elevationStats([
      [
        [0, 0, 0],
        [0, 0.01, 0],
      ],
    ]).ascent,
    0,
  );
});
test("stages and midpoint never create a bridge between track segments", () => {
  const s = [
    [
      [0, 0],
      [0, 0.01],
    ],
    [
      [10, 10],
      [10, 10.01],
    ],
  ];
  const p = planRoute(s, 3, 0, 1.5);
  assert.equal(p.stages[0].point[0], 10);
  const point = weatherPoint({ segments: s, length: routeLength(s) });
  assert.ok(point[0] === 0 || point[0] === 10);
});
test("planner bounds input and limits stage expansion", () => {
  for (const args of [
    [0, 0, 2],
    [NaN, 20, 2],
    [3, -1, 2],
    [3, 20, 0],
  ])
    assert.throws(() => planRoute(segments, ...args));
  assert.throws(() =>
    planRoute(
      [
        [
          [0, 0],
          [170, 0],
        ],
      ],
      3,
      0,
      0.5,
    ),
  );
});
test("custom routes validate name/geometry and do not mutate source", () => {
  const r = createCustomRoute("Test", segments);
  r.segments[0][0][0] = 1;
  assert.equal(segments[0][0][0], 138);
  for (const s of [
    [],
    [[[0, 0]]],
    [
      [
        [0, 0],
        [NaN, 1],
      ],
    ],
    [
      [
        [0, 0],
        [0, 0],
      ],
    ],
    [
      [
        [179, 0],
        [-179, 0],
      ],
    ],
  ])
    assert.throws(() => createCustomRoute("Test", s));
  assert.throws(() => createCustomRoute("", segments));
});
test("GPX export is escaped and preserves segments and missing elevation", () => {
  const r = createCustomRoute(
    "A < B & C",
    [
      ...segments,
      [
        [140, -35],
        [140.01, -35],
      ],
    ],
    [{ name: "A & B", point: [138, -34] }],
  );
  const xml = toGPX(r);
  assert.match(xml, /A &lt; B &amp; C/);
  const d = new DOMParser().parseFromString(xml, "application/xml");
  assert.equal(d.getElementsByTagName("trkseg").length, 2);
  assert.equal(d.getElementsByTagName("ele").length, 3);
  assert.equal(d.getElementsByTagName("wpt").length, 1);
});
const at = (s, t, d = 150, a = 10, threshold = 100) =>
  advanceDeviation(s, { distance: d, accuracy: a, timestamp: t }, threshold, t);
test("deviation requires 3 unique fixes over 10 seconds", () => {
  let s = at({}, 100000);
  assert.equal(s.active, false);
  s = at(s, 105000);
  assert.equal(s.active, false);
  s = at(s, 110000);
  assert.equal(s.active, true);
  assert.equal(s.notify, true);
});
test("duplicate callbacks cannot count as multiple GPS observations", () => {
  let s = at({}, 100000);
  for (let i = 0; i < 5; i++) s = at(s, 100000);
  assert.equal(s.count, 1);
  assert.equal(s.active, false);
});
test("low accuracy, stale and missing fixes suspend deviation judgment", () => {
  for (const sample of [
    { distance: 300, accuracy: 100, timestamp: 100000 },
    { distance: 300, accuracy: 10, timestamp: 1 },
    { distance: NaN, accuracy: 10, timestamp: 100000 },
  ]) {
    const s = advanceDeviation({ count: 2, since: 90000 }, sample, 100, 100000);
    assert.equal(s.status, "uncertain");
    assert.equal(s.notify, false);
    assert.equal(s.count, 0);
  }
});
test("GPS uncertainty near threshold avoids false alarms", () => {
  let s = {};
  for (const t of [100000, 105000, 110000]) s = at(s, t, 120, 30);
  assert.equal(s.active, false);
});
test("return to route clears alert with hysteresis and sound has a cooldown", () => {
  let s = {};
  for (const t of [100000, 105000, 110000]) s = at(s, t);
  s = at(s, 115000);
  assert.equal(s.notify, false);
  s = at(s, 175000);
  assert.equal(s.notify, true);
  s = at(s, 180000, 20, 10);
  assert.equal(s.active, false);
  assert.equal(s.status, "on-route");
});
test("long GPS gap restarts the confirmation window", () => {
  let s = at({}, 100000);
  s = at(s, 105000);
  s = at(s, 140000);
  assert.equal(s.count, 1);
  assert.equal(s.active, false);
});
test("deviation monitoring waits until the hiker reaches the route", () => {
  let s = at({ armed: false }, 100000, 26714);
  assert.equal(s.status, "not-started");
  assert.equal(s.active, false);
  s = at(s, 105000, 250);
  assert.equal(s.armed, true);
  for (const t of [110000, 115000, 120000]) s = at(s, t, 500);
  assert.equal(s.active, true);
});
test("weather request sends only rounded route midpoint and requested variables", () => {
  const u = weatherURL([138.123456, -34.987654]);
  assert.equal(u.searchParams.get("longitude"), "138.1235");
  assert.equal(u.searchParams.get("latitude"), "-34.9877");
  assert.equal(u.searchParams.get("forecast_days"), "3");
  assert.match(u.searchParams.get("hourly"), /snow_depth/);
  assert.equal(u.searchParams.has("gpx"), false);
});
test("partial weather payload is rejected before persistence", () => {
  assert.throws(() => validateWeather({}));
  assert.throws(() =>
    validateWeather({
      current: { time: "2026-09-03T12:00" },
      daily: { time: ["2026-09-03"] },
    }),
  );
  const daily = { time: ["2026-09-03"] };
  for (const k of [
    "temperature_2m_max",
    "temperature_2m_min",
    "precipitation_probability_max",
    "precipitation_sum",
    "wind_speed_10m_max",
    "sunrise",
    "sunset",
  ])
    daily[k] = [null];
  assert.equal(
    validateWeather({ current: { time: "2026-09-03T12:00" }, daily }).daily.time
      .length,
    1,
  );
});
test("workflow deploys every locally referenced new offline asset", async () => {
  const sw = await readFile(new URL("../sw.js", import.meta.url), "utf8"),
    workflow = await readFile(
      new URL("../.github/workflows/pages.yml", import.meta.url),
      "utf8",
    );
  for (const asset of [
    "adventure.mjs",
    "adventure-core.mjs",
    "routing-client.mjs",
    "route-worker.mjs",
    "adventure.css",
  ]) {
    assert.ok(
      sw.includes("'./" + asset + "'") || sw.includes('"./' + asset + '"'),
    );
    assert.ok(workflow.includes(asset));
  }
});
