// Duplicados y casi duplicados: similitud por «shingles» de 5 palabras (todo local, sin IA).
import { DB } from './db.js';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const norm = s => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
function h32(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export function shingles(text, k = 5) {
  const w = norm(text).match(/[a-z0-9]{2,}/g) || [], out = new Set();
  for (let i = 0; i + k <= w.length && out.size < 6000; i++) { const h = h32(w.slice(i, i + k).join(' ')); if (h % 3 === 0) out.add(h); }
  return out;
}
export async function findSimilar(docsById, inProj, min = 0.85, onProg) {
  const pages = await DB.all('pages'), txt = new Map();
  for (const p of pages) { const d = docsById.get(p.docId); if (d && d.status === 'ok' && inProj(d) && p.text) txt.set(p.docId, (txt.get(p.docId) || '') + ' ' + p.text); }
  const sets = new Map(), inv = new Map();
  for (const [id, t] of txt) { const s = shingles(t); if (s.size < 15) continue; sets.set(id, s); for (const h of s) { let a = inv.get(h); if (!a) inv.set(h, a = []); a.push(id); } }
  const cnt = new Map(), ids = [...sets.keys()]; let n = 0;
  for (const id of ids) {
    const c = new Map();
    for (const h of sets.get(id)) for (const o of inv.get(h)) if (o > id) c.set(o, (c.get(o) || 0) + 1);
    for (const [o, k] of c) { const sim = k / Math.min(sets.get(id).size, sets.get(o).size); if (sim >= min) cnt.set(id + '|' + o, { a: id, b: o, sim, sameSha: docsById.get(id).sha256 === docsById.get(o).sha256 }); }
    if (++n % 50 === 0) onProg?.(n, ids.length);
  }
  return [...cnt.values()].sort((x, y) => y.sim - x.sim);
}
export function renderSimilar(el, pairs, docsById, fam) {
  const nm = id => { const d = docsById.get(id); return d ? esc(d.title || d.name) : ''; };
  const t1 = pairs.length ? `<table><tr><th>Documento A</th><th>Documento B</th><th>Parecido</th><th></th></tr>${pairs.map(p => `<tr><td><a href="#" data-detail="${p.a}">${nm(p.a)}</a></td><td><a href="#" data-detail="${p.b}">${nm(p.b)}</a></td><td>${Math.round(p.sim * 100)} %${p.sameSha ? ' (idéntico)' : ''}</td><td><a href="#" data-cmp="${p.a},${p.b}">comparar</a></td></tr>`).join('')}</table>` : '<div class="empty">No hay documentos con contenido casi idéntico.</div>';
  const t2 = fam.length ? `<h3>Familias de versiones (mismo nombre con otra revisión)</h3><table><tr><th>Familia</th><th>Versiones (orden)</th><th></th></tr>${fam.map(l => `<tr><td>${esc(l[0].d.title || l[0].d.name)}</td><td>${l.map(x => `<a href="#" data-detail="${x.d.id}">${esc(x.rev || x.d.name)}</a>`).join(' → ')}</td><td>${l.slice(1).map((x, i) => `<a href="#" data-cmp="${l[i].d.id},${x.d.id}">comparar ${esc(l[i].rev || '·')}→${esc(x.rev || '·')}</a>`).join('<br>')}</td></tr>`).join('')}</table>` : '';
  el.innerHTML = `<div class="m">${pairs.length} pareja(s) con contenido muy parecido. Son <b>propuestas para revisar</b>: nada se elimina solo.</div>${t1}${t2}`;
}
