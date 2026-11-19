// Etiquetas técnicas como entidades: equipos/tags, normas y valores (caudal, presión, temperatura…) con ficha por etiqueta.
// Todo se calcula en local a partir del texto ya indexado; no modifica nada.
import { DB } from './db.js';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TAGS = [
  ['equipo', /\b\d{2,4}[A-Z]{3,6}\d{3,5}\b/g], ['equipo', /\b[A-Z]{2,5}-[A-Z]{2,6}\d{3,5}\b/g], ['local', /\b\d{2}[A-Z]{1,2}[A-Z]\d{1,2}(?:-\d{2})?\b/g],
  ['norma', /\b(?:ISO|EN|UNE|IEC|DIN|ASHRAE|NFPA|IMO|SOLAS|MSC|ATEX|NBE|RITE|CTE)[\s-]?\d[\d.:/-]*\d\b/g], ['norma', /\b(?:Directiva|Directive)\s+\d{4}\/\d{1,3}\/(?:UE|EU|CE|EC)\b/gi],
];
const VAL = /(\d+(?:[.,]\d+)?(?:\s?\/\s?\d+(?:[.,]\d+)?)?)\s?(m3\/h|m³\/h|l\/s|m\/s|Pa|mmca|mbar|bar|kW|W|dB\(A\)|dBA|dB|°\s?C|ºC|kg|mm|m3|rpm|V|A|Hz)\b/g;
export function entitiesOf(text) {
  const out = []; for (const [kind, re] of TAGS) { re.lastIndex = 0; let m; while ((m = re.exec(text))) out.push({ kind, value: m[0].toUpperCase().replace(/\s+/g, ' '), at: m.index }); } return out;
}
export const valuesNear = (text, at, r = 140) => { const seg = text.slice(Math.max(0, at - r), at + r), out = new Set(); let m; VAL.lastIndex = 0; while ((m = VAL.exec(seg))) out.add(m[0].replace(/\s+/g, ' ')); return [...out]; };
let cache = null;
export async function buildIndex(docsById, inProj) {
  const ps = await DB.all('pages'), map = new Map();
  for (const p of ps) {
    const d = docsById.get(p.docId); if (!d || d.status !== 'ok' || !inProj(d) || !p.text) continue;
    for (const e of entitiesOf(p.text)) {
      let r = map.get(e.value); if (!r) map.set(e.value, r = { value: e.value, kind: e.kind, occ: [] });
      if (r.occ.length < 400) r.occ.push({ docId: p.docId, pageNo: p.pageNo, at: e.at, text: p.text });
    }
  }
  cache = map; return map;
}
export function renderList(el, map, docsById, filter = '', kind = '') {
  const f = filter.trim().toUpperCase(), rows = [...map.values()].filter(r => (!kind || r.kind === kind) && (!f || r.value.includes(f))).sort((a, b) => b.occ.length - a.occ.length || a.value.localeCompare(b.value)).slice(0, 300);
  el.innerHTML = rows.length ? `<table><tr><th>Etiqueta</th><th>Tipo</th><th>Veces</th><th>Documentos</th><th></th></tr>${rows.map(r => `<tr><td><b>${esc(r.value)}</b></td><td>${r.kind}</td><td>${r.occ.length}</td><td>${new Set(r.occ.map(o => o.docId)).size}</td><td><a href="#" data-eq="${esc(r.value)}">ficha</a></td></tr>`).join('')}</table>` : '<div class="empty">Sin etiquetas. Indexa documentos con tags tipo 100VENT5501, RHE-ACON5067 o normas ISO/EN/UNE.</div>';
}
export function ficha(el, value, map, docsById) {
  const r = map.get(value); if (!r) { el.innerHTML = ''; return; }
  const byDoc = new Map(); r.occ.forEach(o => { const a = byDoc.get(o.docId) || []; a.push(o); byDoc.set(o.docId, a); });
  const vals = new Set(); r.occ.forEach(o => valuesNear(o.text, o.at).forEach(v => vals.add(v)));
  el.innerHTML = `<h3 style="margin:.4em 0">${esc(value)} <span class="tag">${r.kind}</span></h3><div class="m">${r.occ.length} aparición(es) en ${byDoc.size} documento(s)</div>
    ${vals.size ? `<div class="m"><b>Valores cercanos:</b> ${[...vals].slice(0, 30).map(esc).join(' · ')} <i>(cerca no significa asociado: comprobar en el original)</i></div>` : ''}
    <table><tr><th>Documento</th><th>Parte</th><th>Contexto</th><th></th></tr>${r.occ.slice(0, 80).map(o => { const d = docsById.get(o.docId), c = o.text.slice(Math.max(0, o.at - 70), o.at + value.length + 70).replace(/\s+/g, ' ');
      return `<tr><td>${esc(d?.title || d?.name || '')}</td><td>${o.pageNo}</td><td class="m">… ${esc(c)} …</td><td><a href="#" data-open="${o.docId}" data-page="${o.pageNo}">abrir original</a> · <a href="#" data-detail="${o.docId}" data-page="${o.pageNo}">ver / editar</a></td></tr>`; }).join('')}</table>`;
}

// ---- inconsistencias: la misma etiqueta con valores distintos de una misma magnitud en documentos distintos ----
const DIM = { 'm3/h': ['caudal', 1], 'm³/h': ['caudal', 1], 'l/s': ['caudal', 3.6], 'Pa': ['presión', 1], 'mmca': ['presión', 9.80665], 'mbar': ['presión', 100], 'bar': ['presión', 1e5], '°C': ['temperatura', 1], 'ºC': ['temperatura', 1], 'kW': ['potencia', 1], 'W': ['potencia', .001], 'm/s': ['velocidad', 1], 'dB': ['ruido', 1], 'dBA': ['ruido', 1], 'dB(A)': ['ruido', 1] };
const UNIT = { 'm3/h': 'm³/h', 'm³/h': 'm³/h', 'l/s': 'm³/h', 'Pa': 'Pa', 'mmca': 'Pa', 'mbar': 'Pa', 'bar': 'Pa', '°C': '°C', 'ºC': '°C', 'kW': 'kW', 'W': 'kW', 'm/s': 'm/s', 'dB': 'dB', 'dBA': 'dB', 'dB(A)': 'dB' };
export function valuesNormal(text, at, r = 60) {
  const seg = text.slice(Math.max(0, at - r), at + r), out = []; let m; const re = new RegExp(VAL.source, 'g');
  while ((m = re.exec(seg))) { const raw = m[1]; if (raw.includes('/')) continue; const u = m[2].replace(/\s/g, ''), k = DIM[u.replace('º', '°')] || DIM[u]; if (!k) continue; const n = parseFloat(raw.replace(',', '.')); if (!isFinite(n)) continue; out.push({ dim: k[0], v: n * k[1], unit: UNIT[u] || u, raw: m[0].replace(/\s+/g, ' ') }); }
  return out;
}
export function inconsistencies(map, docsById, tol = 0.02) {
  const res = [];
  for (const r of map.values()) {
    if (r.kind === 'norma') continue;
    const by = new Map();   // magnitud → [{docId,pageNo,v,raw}]
    for (const o of r.occ) for (const x of valuesNormal(o.text, o.at)) { const a = by.get(x.dim) || []; if (!a.some(y => y.docId === o.docId && y.pageNo === o.pageNo && y.v === x.v)) a.push({ docId: o.docId, pageNo: o.pageNo, v: x.v, raw: x.raw, unit: x.unit }); by.set(x.dim, a); }
    for (const [dim, a] of by) {
      const docs = new Set(a.map(x => x.docId)); if (docs.size < 2) continue;
      const vals = a.map(x => x.v), mx = Math.max(...vals), mn = Math.min(...vals); if ((mx - mn) / (mx || 1) <= tol) continue;
      res.push({ tag: r.value, dim, items: a.sort((p, q) => p.v - q.v), docs: docs.size });
    }
  }
  return res.sort((a, b) => b.docs - a.docs || a.tag.localeCompare(b.tag));
}
export function renderInconsistencies(el, list, docsById) {
  el.innerHTML = list.length ? `<div class="m">${list.length} posible(s) inconsistencia(s). Son <b>propuestas para revisar</b>: el valor puede referirse a otra cosa (otra condición de trabajo, otra revisión, otro equipo cercano en el texto).</div>
    <table><tr><th>Etiqueta</th><th>Magnitud</th><th>Valores encontrados</th><th></th></tr>${list.map((x, i) => `<tr><td><b>${esc(x.tag)}</b></td><td>${x.dim}</td><td>${x.items.map(it => `${esc(it.raw)} <span class="m">en <a href="#" data-detail="${it.docId}" data-page="${it.pageNo}">${esc(docsById.get(it.docId)?.title || docsById.get(it.docId)?.name || '')}</a> (parte ${it.pageNo})</span>`).join('<br>')}</td><td><a href="#" data-inc="${i}">añadir como conflicto</a></td></tr>`).join('')}</table>`
    : '<div class="empty">No se han encontrado etiquetas con valores distintos entre documentos.</div>';
}
