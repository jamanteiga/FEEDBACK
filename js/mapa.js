// Mapa de relaciones: documentos ↔ etiquetas de equipo ↔ requisitos. Disposición por fuerzas (sin librerías), SVG clicable.
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function buildGraph({ docsById, eqMap, reqs, q = '' }) {
  const N = new Map(), E = new Set(), add = (id, o) => { if (!N.has(id)) N.set(id, { id, ...o }); return N.get(id); }, link = (a, b) => { if (a !== b) E.add(a < b ? a + '→' + b : b + '→' + a); };
  const tags = [...eqMap.values()].filter(r => r.kind === 'equipo'), docTags = new Map();
  for (const r of tags) for (const d of new Set(r.occ.map(o => o.docId))) { let s = docTags.get(d); if (!s) docTags.set(d, s = new Map()); s.set(r.value, r.occ.filter(o => o.docId === d).length); }
  const dn = id => { const d = docsById.get(id); return d ? (d.title || d.name) : '?'; };
  const addDoc = id => add('d' + id, { t: 'doc', label: dn(id), ref: id });
  const addTag = v => add('t' + v, { t: 'tag', label: v, ref: v });
  const addReqs = ids => { for (const r of reqs) { const hit = ids.has(r.docId) || (r.ev || []).some(e => ids.has(e.docId)); if (!hit) continue; const n = add('r' + r.id, { t: 'req', label: '#' + r.id + ' ' + r.text.slice(0, 26), ref: r.docId, page: r.pageNo, st: r.status }); if (ids.has(r.docId)) { addDoc(r.docId); link(n.id, 'd' + r.docId); } for (const e of r.ev || []) if (ids.has(e.docId)) { addDoc(e.docId); link(n.id, 'd' + e.docId); } } };
  const qq = q.trim(); let mode = 'general', focus = '';
  const tagHit = qq && eqMap.get(qq.toUpperCase()), docHit = qq && !tagHit ? [...docsById.values()].find(d => d.status === 'ok' && ((d.title || '') + ' ' + d.name).toLowerCase().includes(qq.toLowerCase())) : null;
  if (tagHit && tagHit.kind === 'equipo') {
    mode = 'etiqueta'; focus = tagHit.value; addTag(tagHit.value); const ids = new Set(tagHit.occ.map(o => o.docId));
    for (const id of [...ids].slice(0, 40)) { addDoc(id); link('t' + tagHit.value, 'd' + id); }
    const co = new Map(); for (const id of ids) for (const [v, n] of docTags.get(id) || []) if (v !== tagHit.value) co.set(v, (co.get(v) || 0) + n);
    for (const [v] of [...co].sort((a, b) => b[1] - a[1]).slice(0, 12)) { addTag(v); for (const id of ids) if (docTags.get(id)?.has(v) && N.has('d' + id)) link('t' + v, 'd' + id); }
    addReqs(new Set([...ids].slice(0, 40)));
  } else if (docHit) {
    mode = 'documento'; focus = docHit.title || docHit.name; addDoc(docHit.id); const mine = docTags.get(docHit.id) || new Map();
    for (const [v] of [...mine].sort((a, b) => b[1] - a[1]).slice(0, 18)) { addTag(v); link('t' + v, 'd' + docHit.id); }
    const sh = new Map(); for (const [id, m] of docTags) if (id !== docHit.id) { let c = 0; for (const v of mine.keys()) if (m.has(v)) c++; if (c) sh.set(id, c); }
    for (const [id] of [...sh].sort((a, b) => b[1] - a[1]).slice(0, 8)) { addDoc(id); for (const v of docTags.get(id).keys()) if (N.has('t' + v)) link('t' + v, 'd' + id); }
    addReqs(new Set([docHit.id]));
  } else {
    const top = [...tags].sort((a, b) => b.occ.length - a.occ.length).slice(0, 25), ids = new Set();
    for (const r of top) { addTag(r.value); for (const id of new Set(r.occ.map(o => o.docId))) { if (ids.size < 60 || ids.has(id)) { ids.add(id); addDoc(id); link('t' + r.value, 'd' + id); } } }
    addReqs(ids);
  }
  return { nodes: [...N.values()], edges: [...E].map(e => e.split('→')), mode, focus, nodesFound: !!(tagHit || docHit) || !qq };
}
export function layout(nodes, edges, W = 1000, H = 620) {
  let s = 12345; const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (const n of nodes) { n.x = W / 2 + (rnd() - .5) * W * .6; n.y = H / 2 + (rnd() - .5) * H * .6; n.dx = n.dy = 0; }
  const idx = new Map(nodes.map((n, i) => [n.id, i])), k = Math.sqrt(W * H / Math.max(nodes.length, 1)) * 0.75;
  for (let it = 0, T = W / 8; it < 260; it++, T *= 0.985) {
    for (const n of nodes) { n.dx = 0; n.dy = 0; }
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) { const a = nodes[i], b = nodes[j]; let dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy) || .01, f = k * k / d; dx /= d; dy /= d; a.dx += dx * f; a.dy += dy * f; b.dx -= dx * f; b.dy -= dy * f; }
    for (const [x, y] of edges) { const a = nodes[idx.get(x)], b = nodes[idx.get(y)]; if (!a || !b) continue; let dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy) || .01, f = d * d / k; dx /= d; dy /= d; a.dx -= dx * f; a.dy -= dy * f; b.dx += dx * f; b.dy += dy * f; }
    for (const n of nodes) { const d = Math.hypot(n.dx, n.dy) || .01, m = Math.min(d, T); n.x += n.dx / d * m + (W / 2 - n.x) * .01; n.y += n.dy / d * m + (H / 2 - n.y) * .01; n.x = Math.max(60, Math.min(W - 60, n.x)); n.y = Math.max(24, Math.min(H - 24, n.y)); }
  }
}
export function renderGraph(el, g, W = 1000, H = 620) {
  if (!g.nodes.length) { el.innerHTML = '<div class="empty">No hay relaciones que dibujar todavía (importa documentos y calcula la lista de equipos).</div>'; return; }
  layout(g.nodes, g.edges, W, H); const byId = new Map(g.nodes.map(n => [n.id, n])), COL = { doc: '#2563eb', tag: '#d97706', req: '#15803d' };
  const lines = g.edges.map(([a, b]) => { const p = byId.get(a), q = byId.get(b); return p && q ? `<line x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${q.x.toFixed(1)}" y2="${q.y.toFixed(1)}" stroke="#94a3b8" stroke-width="1" opacity=".55"/>` : ''; }).join('');
  const nodes = g.nodes.map(n => {
    const attr = n.t === 'doc' ? `data-detail="${n.ref}" data-page="1"` : n.t === 'tag' ? `data-eq="${esc(n.ref)}"` : `data-detail="${n.ref}" data-page="${n.page || 1}"`, col = n.t === 'req' && n.st === 'conflicto' ? '#b42318' : COL[n.t], lab = n.label.length > 26 ? n.label.slice(0, 25) + '…' : n.label;
    const r = n.t === 'tag' ? 9 : n.t === 'doc' ? 8 : 6, focus = g.focus && (n.label === g.focus);
    return `<g ${attr} style="cursor:pointer"><title>${esc(n.label)}</title>${n.t === 'doc' ? `<rect x="${(n.x - r).toFixed(1)}" y="${(n.y - r).toFixed(1)}" width="${2 * r}" height="${2 * r}" rx="2" fill="${col}"${focus ? ' stroke="#111" stroke-width="3"' : ''}/>` : `<circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${r}" fill="${col}"${focus ? ' stroke="#111" stroke-width="3"' : ''}/>`}<text x="${(n.x + r + 3).toFixed(1)}" y="${(n.y + 4).toFixed(1)}" font-size="11" fill="currentColor" paint-order="stroke" stroke="var(--card,#fff)" stroke-width="3">${esc(lab)}</text></g>`;
  }).join('');
  el.innerHTML = `<div class="m" style="margin-bottom:4px"><span style="color:#2563eb">■</span> documento · <span style="color:#d97706">●</span> etiqueta de equipo · <span style="color:#15803d">●</span> requisito (<span style="color:#b42318">●</span> conflicto) · ${g.nodes.length} nodos, ${g.edges.length} relaciones. Haz clic en un nodo para abrirlo; escribe una etiqueta o un documento arriba para centrar el mapa.</div><svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;max-height:70vh;border:1px solid var(--line);border-radius:8px;background:var(--card)">${lines}${nodes}</svg>`;
}
