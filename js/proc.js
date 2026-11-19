// Extracción de texto (PDF), OCR y corrección básica de imágenes, todo en el navegador.
// El original nunca se modifica: las copias procesadas son canvas/PNG separados.
import * as pdfjsLib from '../vendor/pdfjs/pdf.min.mjs';

const abs = p => new URL(p, document.baseURI).href;
pdfjsLib.GlobalWorkerOptions.workerSrc = abs('vendor/pdfjs/pdf.worker.min.mjs');

export { pdfjsLib };
export const openPdfDoc = buf => pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)), cMapUrl: abs('vendor/pdfjs/cmaps/'), cMapPacked: true, standardFontDataUrl: abs('vendor/pdfjs/standard_fonts/'), wasmUrl: abs('vendor/pdfjs/wasm/'), iccUrl: abs('vendor/pdfjs/iccs/') });
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


// ---- OCR para planos densos y fotos de pantalla ----
// Texto apelotonado, tamaños mezclados, líneas cruzadas y texto vertical: normaliza la iluminación,
// elimina color y líneas largas, amplía, binariza y lee en horizontal y girado 90°.
const gauss = (src, w, h) => {
  const k = [1, 4, 6, 4, 1], t = new Float32Array(w * h), o = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let a = 0; for (let i = -2; i <= 2; i++) a += k[i + 2] * src[y * w + Math.min(w - 1, Math.max(0, x + i))]; t[y * w + x] = a / 16; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let a = 0; for (let i = -2; i <= 2; i++) a += k[i + 2] * t[Math.min(h - 1, Math.max(0, y + i)) * w + x]; o[y * w + x] = a / 16; }
  return o;
};
function maxMinFilter(a, w, h, r, isMax) {
  const t = new Uint8ClampedArray(w * h), o = new Uint8ClampedArray(w * h), better = isMax ? (x, y) => x > y : (x, y) => x < y;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = a[y * w + x]; for (let i = Math.max(0, x - r); i <= Math.min(w - 1, x + r); i++) if (better(a[y * w + i], m)) m = a[y * w + i]; t[y * w + x] = m; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = t[y * w + x]; for (let i = Math.max(0, y - r); i <= Math.min(h - 1, y + r); i++) if (better(t[i * w + x], m)) m = t[i * w + x]; o[y * w + x] = m; }
  return o;
}
export function denseBinarize(src, opts = {}) {
  const { maxSide = 6000, scale = 3, lineLen = 150, mode = 'color' } = opts, thr = opts.thr ?? (mode === 'max' ? 130 : 110);
  const W0 = src.width, H0 = src.height, f = Math.min(scale, maxSide / Math.max(W0, H0));
  // 1) gris + color a blanco a resolución original
  const ctx0 = src.getContext('2d', { willReadFrequently: true }), d = ctx0.getImageData(0, 0, W0, H0).data;
  const g = new Uint8ClampedArray(W0 * H0), col = new Uint8Array(W0 * H0);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) {
    const r = d[j], gg = d[j + 1], b = d[j + 2], mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
    g[i] = mode === 'max' ? mx : (r * 299 + gg * 587 + b * 114) / 1000;
    if (mode !== 'max' && mx > 60 && (mx - mn) * 255 / mx > 70) col[i] = 1;
  }
  // 2) fondo = cierre morfológico a 1/4 de resolución (quita el texto, deja iluminación/moiré)
  const sw = Math.max(1, Math.round(W0 / 4)), sh = Math.max(1, Math.round(H0 / 4)), small = new Uint8ClampedArray(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) small[y * sw + x] = g[Math.min(H0 - 1, y * 4) * W0 + Math.min(W0 - 1, x * 4)];
  const bg = gauss(maxMinFilter(maxMinFilter(small, sw, sh, 6, true), sw, sh, 6, false), sw, sh);
  const norm = new Uint8ClampedArray(W0 * H0);
  for (let y = 0; y < H0; y++) for (let x = 0; x < W0; x++) {
    const i = y * W0 + x, b = bg[Math.min(sh - 1, y >> 2) * sw + Math.min(sw - 1, x >> 2)] || 1;
    norm[i] = col[i] ? 255 : Math.min(255, g[i] * 255 / b);
  }
  // 3) ampliar, suavizar y binarizar
  const W = Math.round(W0 * f), H = Math.round(H0 * f);
  const tmp = mkCanvas(W0, H0), tx = tmp.getContext('2d'), im = tx.createImageData(W0, H0);
  for (let i = 0, j = 0; i < norm.length; i++, j += 4) { im.data[j] = im.data[j + 1] = im.data[j + 2] = norm[i]; im.data[j + 3] = 255; }
  tx.putImageData(im, 0, 0);
  const big = mkCanvas(W, H), bx = big.getContext('2d', { willReadFrequently: true }); bx.imageSmoothingQuality = 'high'; bx.drawImage(tmp, 0, 0, W, H);
  const bd = bx.getImageData(0, 0, W, H), px = new Uint8ClampedArray(W * H);
  for (let i = 0, j = 0; i < px.length; i++, j += 4) px[i] = bd.data[j];
  const sm = gauss(px, W, H), ink = new Uint8Array(W * H);
  for (let i = 0; i < ink.length; i++) ink[i] = sm[i] < thr ? 1 : 0;
  // 4) quitar líneas largas (rectas horizontales/verticales) del dibujo
  const lines = new Uint8Array(W * H), L = Math.round(lineLen * f / 3);
  for (let y = 0; y < H; y++) { let x = 0; while (x < W) { if (!ink[y * W + x]) { x++; continue; } let e = x; while (e < W && ink[y * W + e]) e++; if (e - x >= L) lines.fill(1, y * W + x, y * W + e); x = e; } }
  for (let x = 0; x < W; x++) { let y = 0; while (y < H) { if (!ink[y * W + x]) { y++; continue; } let e = y; while (e < H && ink[e * W + x]) e++; if (e - y >= L) for (let k = y; k < e; k++) lines[k * W + x] = 1; y = e; } }
  const out = bx.createImageData(W, H), o = out.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; let ln = lines[i];
    if (!ln) for (let dy = -1; dy <= 1 && !ln; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < H && xx >= 0 && xx < W && lines[yy * W + xx]) { ln = 1; break; } }
    const v = ink[i] && !ln ? 0 : 255, j = i * 4; o[j] = o[j + 1] = o[j + 2] = v; o[j + 3] = 255;
  }
  bx.putImageData(out, 0, 0);
  return big;
}
const rot90 = (c, cw) => { const r = mkCanvas(c.height, c.width), x = r.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, r.width, r.height); x.translate(cw ? r.width : 0, cw ? 0 : r.height); x.rotate((cw ? 1 : -1) * Math.PI / 2); x.drawImage(c, 0, 0); return r; };
const tsvWords = tsv => (tsv || '').split('\n').map(l => l.split('\t')).filter(a => a.length >= 12 && a[0] === '5' && (a[11] || '').trim()).map(a => ({ conf: +a[10], text: a[11].trim() }));
// Añade a la lectura normal solo las palabras nuevas de la lectura densa (nunca sustituye una buena lectura por otra peor)
export function mergeDense(base, dense) {
  const seen = new Set(base.toLowerCase().split(/\s+/).filter(Boolean)), add = [];
  for (const t of dense.split(/\s+/)) { const k = t.toLowerCase(); if (t.length >= 3 && /[A-Za-z0-9]/.test(t) && !seen.has(k) && !/^\[/.test(t)) { seen.add(k); add.push(t); } }
  return add.length ? base.trim() + '\n\n[lecturas adicionales: sombreados y texto vertical]\n' + add.join(' ') : base;
}
// OCR de una imagen limpia generada por la app (p. ej. un plano dibujado): sin preproceso, horizontal y girada ±90°
export async function ocrClean(canvas, onStatus) {
  const w = await getWorker(onStatus); await w.setParameters({ tessedit_pageseg_mode: '11', preserve_interword_spaces: '1' });
  const out = [], seen = new Set(); let conf = 0, n = 0;
  for (const [rot, label] of [[null, 'horizontal'], [true, 'vertical ↑'], [false, 'vertical ↓']]) {
    onStatus?.(label);
    const r = await w.recognize(rot === null ? canvas : rot90(canvas, rot), {}, { text: true, tsv: true });
    for (const x of tsvWords(r.data.tsv)) if (x.conf >= 60 && x.text.length >= 3 && /[A-Za-z0-9]/.test(x.text) && !seen.has(x.text.toLowerCase())) { seen.add(x.text.toLowerCase()); out.push(x.text); conf += x.conf; n++; }
  }
  await w.setParameters({ tessedit_pageseg_mode: '3' });
  return { text: out.join(' '), conf: n ? conf / n : 0 };
}
export async function ocrDense(canvas, onStatus) {
  const w = await getWorker(onStatus);
  onStatus?.('OCR denso: preparando imagen…');
  const bin = denseBinarize(canvas), binMax = denseBinarize(canvas, { mode: 'max' }); // 2.ª: texto sobre sombreados de color
  await w.setParameters({ tessedit_pageseg_mode: '12', preserve_interword_spaces: '1' });
  onStatus?.('OCR denso: texto horizontal…');
  const h = await w.recognize(bin, {}, { text: true, tsv: true });
  const seen = new Set((h.data.text || '').toLowerCase().split(/\s+/).filter(Boolean));
  const extra = [];
  const keep = x => x.conf >= 65 && x.text.length >= 3 && /[A-Za-z0-9]/.test(x.text) && (/\d/.test(x.text) || x.text.length >= 4) && !seen.has(x.text.toLowerCase());
  const take = ws => ws.filter(keep).forEach(x => { seen.add(x.text.toLowerCase()); extra.push(x.text); });
  onStatus?.('OCR denso: texto sobre sombreados…');
  take(tsvWords((await w.recognize(binMax, {}, { text: true, tsv: true })).data.tsv));
  for (const [cw, label] of [[true, 'vertical ↑'], [false, 'vertical ↓']]) {
    onStatus?.(`OCR denso: texto ${label}…`);
    take(tsvWords((await w.recognize(rot90(bin, cw), {}, { text: true, tsv: true })).data.tsv));
  }
  await w.setParameters({ tessedit_pageseg_mode: '3' });
  const text = tsvWords(h.data.tsv).filter(x => x.conf >= 45).map(x => x.text).join(' ') + ' ' + extra.join(' ');
  return { text, conf: h.data.confidence ?? 0, bin };
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
    let { text, conf } = await ocr(canvas, onStatus), processed = canvas;
    if (conf < 85 || text.length < 400) {
      try {
        const d = await ocrDense(cvs[i], onStatus);
        const m = mergeDense(text, d.text); if (m !== text) { text = m; conf = Math.max(conf, d.conf); steps.push({ step: 'ocr_denso', detail: 'iluminación normalizada, color y líneas largas eliminados, x3, lectura horizontal y vertical' }); }
      } catch (e) { steps.push({ step: 'ocr_denso', detail: 'no se pudo aplicar: ' + (e.message || e) }); }
    }
    out.push({ pageNo: i + 1, method: 'ocr', conf, text, steps, processed: await canvasBlob(processed) });
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
      let r = await ocr(canvas, onStatus);
      if (r.conf < 70) { try { const d = await ocrDense(c, onStatus); const m = mergeDense(r.text, d.text); if (m !== r.text) { r = { text: m, conf: Math.max(r.conf, d.conf) }; steps.push({ step: 'ocr_denso', detail: 'segunda lectura para plano denso (más texto reconocido)' }); } } catch {} }
      steps.unshift({ step: 'render_pdf', detail: `página rasterizada a ${Math.round(scale * 72)} dpi para OCR` });
      out.push({ pageNo: n, method: 'ocr', conf: r.conf, text: r.text, steps, processed: null });
      page.cleanup();
    }
  } finally { await task.destroy(); }
  return out;
}
