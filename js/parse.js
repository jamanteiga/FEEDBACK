// Envoltorio del Web Worker de procesado. Si el navegador no puede crearlo (p. ej. abriendo index.html desde file://),
// se procesa en el hilo principal como antes.
import { parseDocument } from './extract.js';
import { parseEmail } from './mail.js';
let w = null, broken = false, seq = 0; const pend = new Map();
function failAll(msg, fallback) { for (const [, p] of pend) fallback ? p.retry() : p.rej(new Error(msg)); pend.clear(); }
function worker() {
  if (broken) return null; if (w) return w;
  try {
    w = new Worker(new URL('./parse.worker.js', import.meta.url));
    w.onmessage = e => { const p = pend.get(e.data.id); if (!p) return; pend.delete(e.data.id); p.ok = true; e.data.error ? p.rej(new Error(e.data.error)) : p.res(e.data.res); };
    w.onerror = ev => { const never = ![...pend.values()].some(p => p.ok); w = null; if (never) broken = true; failAll('El proceso de lectura se interrumpió' + (ev?.message ? ': ' + ev.message : ''), never); };
  } catch { broken = true; w = null; }
  return w;
}
const needX = ext => ['doc', 'xls', 'dgn'].includes(ext) && typeof XLSX === 'undefined';
const loadX = () => new Promise((res, rej) => { const s = document.createElement('script'); s.src = new URL('../vendor/xlsx.full.min.js', import.meta.url).href; s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar SheetJS')); document.head.appendChild(s); });
const local = async (op, ext, buf) => { if (needX(ext)) await loadX(); return op === 'mail' ? parseEmail(ext, buf) : parseDocument(ext, buf); };
function run(op, ext, buf) {
  const k = worker(); if (!k) return local(op, ext, buf);
  return new Promise((res, rej) => { const id = ++seq; pend.set(id, { res, rej, retry: () => local(op, ext, buf).then(res, rej) }); k.postMessage({ id, op, ext, buf }); });
}
export const parseDoc = (ext, buf) => run('doc', ext, buf);
export const parseMail = (ext, buf) => run('mail', ext, buf);
export const usingWorker = () => !!w;
