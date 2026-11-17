// Extracción de texto (PDF), OCR y corrección básica de imágenes, todo en el navegador.
// El original nunca se modifica: las copias procesadas son canvas/PNG separados.
import * as pdfjsLib from '../vendor/pdfjs/pdf.min.mjs';

const abs = p => new URL(p, document.baseURI).href;
pdfjsLib.GlobalWorkerOptions.workerSrc = abs('vendor/pdfjs/pdf.worker.min.mjs');

export const MIN_NATIVE_CHARS = 20;
export const PDF_OCR_DPI = 300;
export const MAX_SIDE = 4200;

// ---- utilidades ----
export async function sha256(buf) {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

// ---- OCR ----
let worker = null;
export async function getWorker(onStatus) {
  if (worker) return worker;
  onStatus?.('Cargando motor OCR (primera vez, unos segundos)…');
  worker = await Tesseract.createWorker(['spa', 'eng'], 1, {
    workerPath: abs('vendor/tesseract/worker.min.js'),
    corePath: abs('vendor/tesseract/core'),
    langPath: abs('vendor/tesseract/lang'),
    gzip: true,
    workerBlobURL: false,
  });
  return worker;
}
export async function ocr(canvas, onStatus) {
  const w = await getWorker(onStatus);
  const { data } = await w.recognize(canvas);
  return { text: (data.text || '').trim(), conf: data.confidence ?? 0 };
}

// ---- corrección de imagen ----
function toGray(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data, n = canvas.width * canvas.height, g = new Uint8ClampedArray(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) g[i] = (d[j] * 299 + d[j + 1] * 587 + d[j + 2] * 114) / 1000;
  return { ctx, img, g };
}
function putGray(ctx, img, g) {
  const d = img.data;
  for (let i = 0, j = 0; i < g.length; i++, j += 4) { d[j] = d[j + 1] = d[j + 2] = g[i]; d[j + 3] = 255; }
  ctx.putImageData(img, 0, 0);
}
function otsu(hist, total) {
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sB += t * hist[t];
    const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) ** 2;
    if (v > best) { best = v; thr = t; }
  }
  return thr;
}
// Inclinación por proyección horizontal: el ángulo que maximiza la nitidez de las líneas de texto.
function estimateSkew(g, w, h) {
  const step = Math.max(1, Math.floor(Math.max(w, h) / 900));
  const hist = new Uint32Array(256); let tot = 0;
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) { hist[g[y * w + x]]++; tot++; }
  const thr = otsu(hist, tot);
  const xs = [], ys = [];
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) if (g[y * w + x] < thr) { xs.push(x / step); ys.push(y / step); }
  if (xs.length < 300) return 0;
  const H = Math.ceil(h / step), W = Math.ceil(w / step), off = W, bins = new Int32Array(H + 2 * W + 4);
  const score = a => {
    bins.fill(0); const c = Math.cos(a), s = Math.sin(a);
    for (let i = 0; i < xs.length; i++) bins[Math.round(ys[i] * c - xs[i] * s) + off]++;
    let sc = 0; for (let i = 0; i < bins.length; i++) sc += bins[i] * bins[i];
    return sc;
  };
  const rad = d => d * Math.PI / 180;
  let best = 0, bs = -1;
  for (let d = -10; d <= 10; d += 0.5) { const sc = score(rad(d)); if (sc > bs) { bs = sc; best = d; } }
  for (let d = best - 0.5; d <= best + 0.5; d += 0.1) { const sc = score(rad(d)); if (sc > bs) { bs = sc; best = d; } }
  return best;
}
// Devuelve { canvas, steps:[{step,detail}] }. No se aplica nada que no quede registrado.
export function enhance(src) {
  const steps = [];
  let canvas = src;
  const side = Math.max(canvas.width, canvas.height);
  if (side < 1600) {
    const f = 1600 / side, c = mkCanvas(Math.round(canvas.width * f), Math.round(canvas.height * f));
    const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(canvas, 0, 0, c.width, c.height);
    canvas = c; steps.push({ step: 'reescalado', detail: `x${f.toFixed(2)} (lado mayor < 1600 px)` });
  }
  const { ctx, img, g } = toGray(canvas);
  const hist = new Uint32Array(256); for (let i = 0; i < g.length; i++) hist[g[i]]++;
  let acc = 0, lo = 0, hi = 255; const t1 = g.length * 0.01, t2 = g.length * 0.99;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= t1) { lo = i; break; } }
  acc = 0; for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= t2) { hi = i; break; } }
  steps.push({ step: 'escala_de_grises', detail: 'conversión a gris' });
  if (hi - lo > 20) {
    for (let i = 0; i < g.length; i++) g[i] = Math.max(0, Math.min(255, (g[i] - lo) * 255 / (hi - lo)));
    steps.push({ step: 'contraste', detail: `estirado de niveles ${lo}–${hi} → 0–255` });
  }
  putGray(ctx, img, g);
  const ang = estimateSkew(g, canvas.width, canvas.height);
  if (Math.abs(ang) >= 0.3 && Math.abs(ang) <= 10) {
    const c = mkCanvas(canvas.width, canvas.height), x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    x.translate(c.width / 2, c.height / 2); x.rotate(-ang * Math.PI / 180);
    x.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    canvas = c; steps.push({ step: 'enderezado', detail: `rotación ${(-ang).toFixed(2)}°` });
  }
  return { canvas, steps };
}

// ---- carga de imágenes (incluye TIFF multipágina) ----
export async function imageToCanvases(file, buf) {
  const ext = file.name.toLowerCase().split('.').pop();
  if (ext === 'tif' || ext === 'tiff') {
    const ifds = UTIF.decode(buf), out = [];
    for (const ifd of ifds) {
      UTIF.decodeImage(buf, ifd);
      const rgba = new Uint8ClampedArray(UTIF.toRGBA8(ifd));
      const c = mkCanvas(ifd.width, ifd.height);
      c.getContext('2d').putImageData(new ImageData(rgba, ifd.width, ifd.height), 0, 0);
      out.push(c);
    }
    if (!out.length) throw new Error('TIFF sin páginas legibles');
    return out;
  }
  const bmp = await createImageBitmap(new Blob([buf], { type: file.type || 'image/png' }), { imageOrientation: 'from-image' });
  const c = mkCanvas(bmp.width, bmp.height); c.getContext('2d').drawImage(bmp, 0, 0);
  return [c];
}

const canvasBlob = c => new Promise(r => c.toBlob(r, 'image/png'));

// ---- procesado por tipo ----
// Devuelve [{pageNo, method:'texto'|'ocr', conf, text, steps, processed(Blob|null)}]
export async function processImage(file, buf, onProgress, onStatus) {
  const cvs = await imageToCanvases(file, buf), out = [];
  for (let i = 0; i < cvs.length; i++) {
    onProgress?.(`imagen ${i + 1}/${cvs.length}: corrigiendo y aplicando OCR…`);
    const { canvas, steps } = enhance(cvs[i]);
    const { text, conf } = await ocr(canvas, onStatus);
    out.push({ pageNo: i + 1, method: 'ocr', conf, text, steps, processed: await canvasBlob(canvas) });
  }
  return out;
}

export async function processPdf(buf, onProgress, onStatus) {
  const task = pdfjsLib.getDocument({
    data: new Uint8Array(buf.slice(0)),
    cMapUrl: abs('vendor/pdfjs/cmaps/'), cMapPacked: true,
    standardFontDataUrl: abs('vendor/pdfjs/standard_fonts/'),
    wasmUrl: abs('vendor/pdfjs/wasm/'), iccUrl: abs('vendor/pdfjs/iccs/'),
  });
  const pdf = await task.promise;
  const out = [];
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      onProgress?.(`página ${n}/${pdf.numPages}…`);
      const page = await pdf.getPage(n);
      const tc = await page.getTextContent();
      const text = tc.items.map(it => it.str + (it.hasEOL ? '\n' : ' ')).join('').replace(/[ \t]+\n/g, '\n').replace(/ {2,}/g, ' ').trim();
      if (text.length >= MIN_NATIVE_CHARS) { out.push({ pageNo: n, method: 'texto', conf: null, text, steps: [], processed: null }); continue; }
      onProgress?.(`página ${n}/${pdf.numPages}: escaneada, aplicando OCR…`);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(PDF_OCR_DPI / 72, MAX_SIDE / Math.max(base.width, base.height));
      const vp = page.getViewport({ scale });
      const c = mkCanvas(Math.round(vp.width), Math.round(vp.height));
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvas: c, canvasContext: ctx, viewport: vp }).promise;
      const { canvas, steps } = enhance(c);
      const r = await ocr(canvas, onStatus);
      steps.unshift({ step: 'render_pdf', detail: `página rasterizada a ${Math.round(scale * 72)} dpi para OCR` });
      out.push({ pageNo: n, method: 'ocr', conf: r.conf, text: r.text, steps, processed: null });
      page.cleanup();
    }
  } finally { await task.destroy(); }
  return out;
}
