// Trazabilidad: lista de comprobación por documento, detección de revisiones de un mismo documento y matriz requisito → documentos.
// Nada se decide solo: la app propone coincidencias literales o aproximadas y las marca como tales; el estado lo pone la persona.
export const CHK = [
  ['rev', 'Revisado'],
  ['con', 'Contrastado con otros documentos'],
  ['val', 'Valores verificados contra el original'],
  ['pen', 'Pendiente de respuesta o aclaración'],
];
export const chkDone = d => ['rev', 'con', 'val'].filter(k => d.check?.[k]).length;
export const chkLabel = d => !d.check ? '' : `${chkDone(d)}/3${d.check.pen ? ' ⏳' : ''}`;

// ---- revisiones de un mismo documento (por el nombre del archivo) ----
const nn = s => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/_/g, ' ');
const REV_PATS = [
  /\b(?:rev(?:ision)?|ed(?:icion)?|issue)[ ._-]*([a-z]|\d{1,3})\b/i,
  /(?:^|[ ._-])r[ ._-]?(\d{1,3})(?=$|[ ._-])/i,
  /(?:^|[ ._-])v(?:er(?:sion)?)?[ ._-]?(\d+(?:[._]\d+)*)(?=$|[ ._-])/i,
  /[ -]([a-z])$/i,
];
export function revOf(name) {   // token de revisión escrito en el nombre (A, B, 2, 1.3…) o ''
  const base = nn(name.replace(/\.[^.]+$/, ''));
  for (const re of REV_PATS) { const m = re.exec(base); if (m) return m[1].toUpperCase(); }
  return '';
}
export function famKey(name) {   // nombre sin extensión, revisión, versión, fecha ni «copia»
  let s = nn(name.replace(/\.[^.]+$/, ''));
  s = s.replace(/\b\d{4}[-_.]\d{2}[-_.]\d{2}\b|\b\d{2}[-_.]\d{2}[-_.]\d{4}\b|\b\d{8}\b/g, ' ').replace(/\bcopia( de)?\b|\bcopy( of)?\b/g, ' ').replace(/\(\d+\)/g, ' ')
    .replace(/\b(?:rev(?:ision)?|ed(?:icion)?|issue)[ ._-]*(?:[a-z]|\d{1,3})\b/g, ' ').replace(/(?:^|[ ._-])v(?:er(?:sion)?)?[ ._-]?\d+(?:[._]\d+)*(?=$|[ ._-])/g, ' ')
    .replace(/(?:^|[ ._-])r[ ._-]?\d{1,3}(?=$|[ ._-])/g, ' ').replace(/[ -][a-z]$/, ' ');
  s = s.replace(/[^a-z0-9]+/g, ' ').trim();
  return s.length >= 4 ? s : '';
}
const rank = t => /^\d+(\.\d+)*$/.test(t) ? t.split('.').reduce((a, x) => a * 1000 + +x, 0) : t ? 1e9 + t.charCodeAt(0) : -1;
// Grupos de ≥2 documentos distintos con el mismo nombre base, ordenados de más antiguo a más reciente.
export function revGroups(docs) {
  const g = new Map();
  for (const d of docs) { if (d.status !== 'ok') continue; const k = famKey(d.name); if (!k) continue; const kk = `${d.project || ''}|${d.kind}|${d.name.split('.').pop().toLowerCase()}|${k}`; (g.get(kk) || g.set(kk, []).get(kk)).push(d); }
  return [...g.values()].filter(l => l.length > 1 && new Set(l.map(d => d.sha256)).size > 1).map(l => l.map(d => ({ d, rev: revOf(d.name) })).sort((a, b) => (rank(a.rev) - rank(b.rev)) || (a.d.emailDate || a.d.fileDate || '').localeCompare(b.d.emailDate || b.d.fileDate || '') || a.d.id - b.d.id));
}

// ---- matriz de trazabilidad ----
const squash = s => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
// Para cada requisito: dónde aparece su texto idéntico en otros documentos y qué páginas lo mencionan de forma aproximada.
export async function buildMatrix({ reqs, docsById, DB, okDoc, related }) {
  const pages = []; for (const d of docsById.values()) if (okDoc(d)) for (const p of await DB.byIndex('pages', 'docId', d.id)) pages.push({ d, p, t: squash(p.text || '') });
  const rows = [];
  for (const r of reqs) {
    const origin = docsById.get(r.docId), needle = squash(r.text).slice(0, 400), same = [];
    if (needle.length >= 12) for (const x of pages) if (!(x.d.id === r.docId && x.p.pageNo === r.pageNo) && x.t.includes(needle)) same.push({ docId: x.d.id, pageNo: x.p.pageNo, label: x.p.label || 'pág. ' + x.p.pageNo });
    const rel = related ? (await related(r)).filter(h => !same.some(s => s.docId === h.docId && s.pageNo === h.pageNo) && !(h.docId === r.docId && h.pageNo === r.pageNo)).slice(0, 3) : [];
    rows.push({ r, origin, same: same.slice(0, 8), rel });
  }
  return rows;
}
