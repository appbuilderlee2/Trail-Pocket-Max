import {
  PDFDocument,
  PDFName,
  PDFArray,
  PDFDict,
  PDFNumber,
  PDFString,
  PDFHexString,
} from "./vendor/pdf-lib.min.mjs";
import { selectPrimaryViewport, createGeoTransform } from "./geopdf-core.mjs";

const name = (n) => PDFName.of(n);
function array(dict, key) {
  let value;
  try {
    value = dict.lookup(name(key), PDFArray);
  } catch {
    return null;
  }
  return Array.from({ length: value.size() }, (_, i) =>
    value.lookup(i, PDFNumber).asNumber(),
  );
}
function text(dict, key) {
  let value;
  try {
    value = dict.lookup(name(key));
  } catch {
    return "";
  }
  return value instanceof PDFString || value instanceof PDFHexString
    ? value.decodeText()
    : "";
}
export async function parseGeoPdf(bytes) {
  let pdf;
  try {
    pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    throw Error(
      /encrypt/i.test(e?.message || "")
        ? "受密碼保護嘅 PDF 暫不支援。"
        : "未能讀取 PDF 檔案。",
    );
  }
  const candidates = [];
  for (let pageIndex = 0; pageIndex < pdf.getPageCount(); pageIndex++) {
    const page = pdf.getPage(pageIndex),
      crop = page.getCropBox(),
      pageWidth = crop.width,
      pageHeight = crop.height,
      pageRotation = ((page.getRotation().angle % 360) + 360) % 360;
    let viewports;
    try {
      viewports = page.node.lookup(name("VP"), PDFArray);
    } catch {
      continue;
    }
    for (let i = 0; i < viewports.size(); i++) {
      try {
        const viewport = viewports.lookup(i, PDFDict),
          measure = viewport.lookup(name("Measure"), PDFDict),
          gcs = measure.lookup(name("GCS"), PDFDict);
        candidates.push({
          pageIndex,
          pageWidth,
          pageHeight,
          pageX: crop.x,
          pageY: crop.y,
          pageRotation,
          bbox: array(viewport, "BBox"),
          gpts: array(measure, "GPTS"),
          lpts: array(measure, "LPTS"),
          wkt: text(gcs, "WKT"),
          viewportCount: viewports.size(),
        });
      } catch {}
    }
  }
  const selected = selectPrimaryViewport(candidates),
    transform = createGeoTransform(selected);
  if (selected.pageRotation)
    throw Error("旋轉頁面嘅 GeoPDF 暫不支援，未有匯入以免 GPS 位置偏移。");
  return {
    format: "geospatial-pdf",
    pageIndex: selected.pageIndex,
    pageNumber: selected.pageIndex + 1,
    pageCount: pdf.getPageCount(),
    pageWidth: selected.pageWidth,
    pageHeight: selected.pageHeight,
    wkt: selected.wkt,
    viewportCount: selected.viewportCount,
    transform,
  };
}
