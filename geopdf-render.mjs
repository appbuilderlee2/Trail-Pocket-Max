import * as pdfjs from "./vendor/pdf.min.mjs";
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "./vendor/pdf.worker.min.mjs",
  import.meta.url,
).href;
export const MAX_GEOPDF_BYTES = 30 * 1024 * 1024,
  MAX_RASTER_BYTES = 24 * 1024 * 1024;
const toBlob = (canvas, type, quality) =>
  new Promise((resolve) => canvas.toBlob(resolve, type, quality));
const asDataURL = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
export async function renderGeoPdf(
  bytes,
  pageNumber,
  { maxDimension = 4096, onProgress = () => {} } = {},
) {
  onProgress("正在開啟 PDF 頁面…");
  const task = pdfjs.getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      useSystemFonts: true,
    }),
    doc = await task.promise;
  try {
    const page = await doc.getPage(pageNumber),
      base = page.getViewport({ scale: 1 }),
      scale = Math.min(4, maxDimension / Math.max(base.width, base.height)),
      viewport = page.getViewport({ scale }),
      canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const context = canvas.getContext("2d", { alpha: false });
    onProgress(`正在繪製 ${canvas.width} × ${canvas.height} 離線地圖…`);
    await page.render({
      canvasContext: context,
      viewport,
      background: "#ffffff",
    }).promise;
    let blob = await toBlob(canvas, "image/webp", 0.94);
    if (!blob || blob.type !== "image/webp")
      blob = await toBlob(canvas, "image/png");
    if (!blob || blob.size > MAX_RASTER_BYTES)
      throw Error("PDF 地圖影像超過 24 MB，暫時未能安全儲存。");
    return {
      imageData: await asDataURL(blob),
      imageWidth: canvas.width,
      imageHeight: canvas.height,
      imageType: blob.type,
      imageBytes: blob.size,
    };
  } finally {
    await doc.destroy();
  }
}
