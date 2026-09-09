import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, PDFName, PDFString } from "../vendor/pdf-lib.min.mjs";
import {
  selectPrimaryViewport,
  createGeoTransform,
  geoToPage,
  pageToGeo,
  pointInFootprint,
  accuracyPixels,
} from "../geopdf-core.mjs";
import { parseGeoPdf } from "../geopdf-parser.mjs";

const main = {
  bbox: [20, 780, 433, 23],
  gpts: [
    -34.72754, 138.80417, -34.65048, 138.8062, -34.65139, 138.8571, -34.72845,
    138.85511,
  ],
  lpts: [0, 1, 0, 0, 1, 0, 1, 1],
  pageWidth: 595,
  pageHeight: 842,
  wkt: "GDA_1994_MGA_Zone_54",
};
const inset = { ...main, bbox: [450, 180, 560, 50] };

test("largest valid GeoPDF viewport is selected instead of an inset locator map", () => {
  assert.equal(selectPrimaryViewport([inset, main]).bbox[2], 433);
  assert.throws(
    () => selectPrimaryViewport([{ bbox: [0, 0, 1, 1], gpts: [], lpts: [] }]),
    /地理定位/,
  );
});

test("GeoPDF homography places Para Wirra coordinates and GPS accuracy on the page", () => {
  const transform = createGeoTransform(main),
    devils = [138.82, -34.68],
    page = geoToPage(transform, devils);
  assert.ok(page[0] > 0.1 && page[0] < 0.4);
  assert.ok(page[1] > 0.25 && page[1] < 0.65);
  const restored = pageToGeo(transform, page);
  assert.ok(Math.abs(restored[0] - devils[0]) < 1e-8);
  assert.ok(Math.abs(restored[1] - devils[1]) < 1e-8);
  assert.equal(pointInFootprint(transform, devils), true);
  assert.equal(pointInFootprint(transform, [151.21, -33.87]), false);
  assert.ok(accuracyPixels(transform, devils, 20, 3000, 4096) > 0);
});

test("parser reads embedded VP Measure GPTS and LPTS data from a PDF", async () => {
  const pdf = await PDFDocument.create(),
    page = pdf.addPage([595, 842]),
    ctx = pdf.context;
  const measure = ctx.obj({
    Subtype: "GEO",
    GPTS: main.gpts,
    LPTS: main.lpts,
    GCS: { WKT: PDFString.of(main.wkt) },
  });
  const vp = ctx.obj({ Type: "Viewport", BBox: main.bbox, Measure: measure });
  page.node.set(PDFName.of("VP"), ctx.obj([vp]));
  const parsed = await parseGeoPdf(await pdf.save());
  assert.equal(parsed.pageNumber, 1);
  assert.equal(parsed.viewportCount, 1);
  assert.match(parsed.wkt, /MGA_Zone_54/);
  assert.equal(pointInFootprint(parsed.transform, [138.82, -34.68]), true);
});

test("rotated GeoPDF pages fail safely instead of displaying a misplaced GPS point", async () => {
  const pdf = await PDFDocument.create(),
    page = pdf.addPage([595, 842]),
    ctx = pdf.context;
  page.setRotation({ type: "degrees", angle: 90 });
  page.node.set(
    PDFName.of("VP"),
    ctx.obj([
      ctx.obj({
        BBox: main.bbox,
        Measure: ctx.obj({
          GPTS: main.gpts,
          LPTS: main.lpts,
          GCS: { WKT: PDFString.of(main.wkt) },
        }),
      }),
    ]),
  );
  await assert.rejects(parseGeoPdf(await pdf.save()), /旋轉頁面/);
});
