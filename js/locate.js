// Localiza dónde está el texto buscado dentro de imágenes y páginas escaneadas (sin capa de texto): OCR con coordenadas.
// Las cajas se guardan normalizadas (0..1) en la página para no repetir el OCR. El original no se modifica.
import { getWorker, denseBinarize } from './proc.js';
import { DB } from './db.js';
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const readBoxes = async (w, cv, W0) => {
  const r = await w.recognize(cv, {}, { text: true, tsv: true }), W = cv.width, H = cv.height, out = [];
  for (const l of (r.data.tsv || '').split('\n')) {
    const a = l.split('\t'); if (a.length < 12 || a[0] !== '5' || !(a[11] || '').trim() || +a[10] < 25) continue;
    out.push([a[11].trim(), +a[6] / W, +a[7] / H, +a[8] / W, +a[9] / H]);
  }
  return out;
};
export async function locateWords(canvas, onStatus) {
  const w = await getWorker(onStatus), m = Math.max(canvas.width, canvas.height), out = [];
  await w.setParameters({ tessedit_pageseg_mode: '11' });
  // pasada 1: imagen tal cual (mejor para escaneos limpios y PDF a buena resolución)
  const f1 = Math.min(3000 / m, Math.max(1, 1800 / m * 1.5)), c1 = document.createElement('canvas'); c1.width = Math.round(canvas.width * f1); c1.height = Math.round(canvas.height * f1);
  const x1 = c1.getContext('2d'); x1.fillStyle = '#fff'; x1.fillRect(0, 0, c1.width, c1.height); x1.imageSmoothingQuality = 'high'; x1.drawImage(canvas, 0, 0, c1.width, c1.height);
  out.push(...await readBoxes(w, c1));
  // pasada 2: preproceso para fotos/planos densos (iluminación, color, líneas)
  onStatus?.('(2.ª pasada)');
  out.push(...await readBoxes(w, denseBinarize(canvas, { scale: Math.max(1, Math.min(3, 3000 / m)) })));
  await w.setParameters({ tessedit_pageseg_mode: '3' });
  return out;
}
export async function cachedBoxes(docId, pageNo, makeCanvas, onStatus) {
  const rec = docId != null ? await DB.get('pages', [docId, pageNo]) : null;
  if (rec?.boxes) return rec.boxes;
  const boxes = await locateWords(await makeCanvas(), onStatus);
  if (rec) { rec.boxes = boxes; try { await DB.put('pages', rec); } catch { /* sin caché */ } }
  return boxes;
}
// rectángulos [x,y,w,h] (0..1) de las palabras que contienen el término (o de una secuencia de palabras que lo contiene)
export function matchBoxes(boxes, terms) {
  const ts = [...new Set(terms.map(t => norm(t.trim())).filter(t => t.length >= 2))], res = [], N = boxes.map(b => norm(b[0]));
  for (const t of ts) {
    for (let i = 0; i < boxes.length; i++) {
      let acc = '';
      for (let j = i; j < Math.min(boxes.length, i + 6); j++) {
        acc += (j > i ? ' ' : '') + N[j];
        if (acc.includes(t) && (j > i ? N[i] && t.includes(N[i].slice(-3)) || t.startsWith(N[i].slice(0, 3)) : true)) { for (let k = i; k <= j; k++) res.push(boxes[k].slice(1)); break; }
        if (acc.length > t.length + 12) break;
      }
    }
  }
  return res;
}
export function drawBoxes(layer, rects, pad = .15) {
  layer.innerHTML = '';
  for (const [x, y, w, h] of rects) {
    const d = document.createElement("div"), px = Math.min(w * 0.04, 0.004), py = h * pad;
    d.className = 'locbox'; d.style.cssText = `position:absolute;left:${(x - px) * 100}%;top:${(y - py) * 100}%;width:${(w + 2 * px) * 100}%;height:${(h + 2 * py) * 100}%;border:2px solid #d32f2f;background:rgba(255,214,0,.22);pointer-events:none;box-sizing:border-box`;
    layer.appendChild(d);
  }
  return layer.firstElementChild;
}
