import { decorate, leaveFs } from './vwin.js';
// Visor de planos CAD (DWG/DXF) en el navegador: dibuja la geometría 2D (líneas, polilíneas, arcos, círculos, elipses, textos y bloques)
// y resalta los textos que coinciden con la búsqueda. Solo lectura; el original no se modifica. No sustituye a un programa CAD.
import { dwgDb, cadText } from './cad.js';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const norm = s => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const MAX_ENT = 600000, DEG = Math.PI / 180;
const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const ap = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const insM = (x, y, sx, sy, rot, bx = 0, by = 0) => { const c = Math.cos(rot), s = Math.sin(rot); return mul([c * sx, s * sx, -s * sy, c * sy, x, y], [1, 0, 0, 1, -bx, -by]); };
const arcPts = (cx, cy, rx, ry, a0, a1, rot = 0) => { let d = a1 - a0; while (d <= 0) d += 2 * Math.PI; const n = Math.max(8, Math.min(96, Math.ceil(d * 12))), out = [], c = Math.cos(rot), s = Math.sin(rot); for (let i = 0; i <= n; i++) { const t = a0 + d * i / n, x = rx * Math.cos(t), y = ry * Math.sin(t); out.push(cx + x * c - y * s, cy + x * s + y * c); } return out; };

// ---- escena a partir de la lista de entidades normalizadas {t, ...} ----
function build(modelEnts, blocks) {
  const strokes = [], texts = []; let count = 0;
  const walk = (ents, m, depth) => {
    for (const e of ents) {
      if (++count > MAX_ENT) return;
      if (e.t === 'L') { const [x1, y1] = ap(m, e.x1, e.y1), [x2, y2] = ap(m, e.x2, e.y2); strokes.push([x1, y1, x2, y2]); }
      else if (e.t === 'P') { const o = []; for (let i = 0; i < e.pts.length; i += 2) o.push(...ap(m, e.pts[i], e.pts[i + 1])); if (e.closed) o.push(o[0], o[1]); strokes.push(o); }
      else if (e.t === 'A') { const p = arcPts(e.cx, e.cy, e.rx, e.ry, e.a0, e.a1, e.rot || 0), o = []; for (let i = 0; i < p.length; i += 2) o.push(...ap(m, p[i], p[i + 1])); strokes.push(o); }
      else if (e.t === 'T') { const [x, y] = ap(m, e.x, e.y), sc = Math.hypot(m[0], m[1]) || 1, rot = Math.atan2(m[1], m[0]) + (e.rot || 0); texts.push({ x, y, h: (e.h || 1) * sc, rot, s: e.s, ml: e.ml }); }
      else if (e.t === 'I' && depth < 5) { const b = blocks.get(e.name); if (!b) continue; const rows = Math.max(1, e.rows || 1), cols = Math.max(1, e.cols || 1);
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) walk(b.ents, mul(m, insM(e.x + c * (e.dx || 0), e.y + r * (e.dy || 0), e.sx, e.sy, e.rot, b.bx, b.by)), depth + 1); }
    }
  };
  walk(modelEnts, [1, 0, 0, 1, 0, 0], 0);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const ext = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
  for (const s of strokes) for (let i = 0; i < s.length; i += 2) ext(s[i], s[i + 1]);
  for (const t of texts) ext(t.x, t.y);
  if (!isFinite(x0)) { x0 = y0 = 0; x1 = y1 = 100; }
  return { strokes, texts, bounds: [x0, y0, x1, y1], count, truncated: count > MAX_ENT };
}

// ---- DWG ----
const pt = p => p ? [p.x || 0, p.y || 0] : [0, 0];
function dwgEnts(list) {
  const out = [];
  for (const e of list || []) {
    switch (e.type) {
      case 'LINE': { const [a, b] = pt(e.startPoint), [c, d] = pt(e.endPoint); out.push({ t: 'L', x1: a, y1: b, x2: c, y2: d }); break; }
      case 'LWPOLYLINE': case 'POLYLINE2D': { const v = (e.vertices || []).flatMap(q => [q.x || 0, q.y || 0]); if (v.length >= 4) out.push({ t: 'P', pts: v, closed: !!((e.flag || 0) & 1) }); break; }
      case 'CIRCLE': { const [x, y] = pt(e.center); out.push({ t: 'A', cx: x, cy: y, rx: e.radius, ry: e.radius, a0: 0, a1: 2 * Math.PI }); break; }
      case 'ARC': { const [x, y] = pt(e.center); out.push({ t: 'A', cx: x, cy: y, rx: e.radius, ry: e.radius, a0: e.startAngle || 0, a1: e.endAngle || 0 }); break; }
      case 'ELLIPSE': { const [x, y] = pt(e.center), [mx, my] = pt(e.majorAxisEndPoint), rx = Math.hypot(mx, my); out.push({ t: 'A', cx: x, cy: y, rx, ry: rx * (e.axisRatio || 1), a0: e.startAngle || 0, a1: e.endAngle ?? 2 * Math.PI, rot: Math.atan2(my, mx) }); break; }
      case 'TEXT': { const [x, y] = pt(e.startPoint), s = cadText(e.text); if (s) out.push({ t: 'T', x, y, h: e.textHeight || 1, rot: e.rotation || 0, s }); break; }
      case 'MTEXT': { const [x, y] = pt(e.insertionPoint), s = cadText(e.text, true); if (s) out.push({ t: 'T', x, y, h: e.textHeight || 1, rot: e.rotation || 0, s: s.replace(/\n+/g, ' '), ml: true }); break; }
      case 'ATTRIB': { const [x, y] = pt(e.startPoint), s = cadText(e.text?.text ?? e.text); if (s) out.push({ t: 'T', x, y, h: e.textHeight || e.text?.textHeight || 1, rot: e.rotation || 0, s }); break; }
      case 'INSERT': { const [x, y] = pt(e.insertionPoint); out.push({ t: 'I', name: e.name, x, y, sx: e.xScale || 1, sy: e.yScale || 1, rot: e.rotation || 0, rows: e.rowCount, cols: e.columnCount, dx: e.columnSpacing, dy: e.rowSpacing }); out.push(...dwgEnts(e.attribs)); break; }
      default: break;
    }
  }
  return out;
}
async function sceneDwg(u8, kind) {
  const db = await dwgDb(u8, kind), blocks = new Map(); let model = [];
  for (const b of db.tables?.BLOCK_RECORD?.entries || []) {
    const n = b.name || '';
    if (/^\*model_space$/i.test(n)) model = dwgEnts(b.entities);
    else if (!n.startsWith('*')) { const [bx, by] = pt(b.basePoint || b.origin); blocks.set(n, { ents: dwgEnts(b.entities), bx, by }); }
  }
  if (!model.length) model = dwgEnts(db.entities);
  return build(model, blocks);
}

// ---- DXF ASCII ----
function sceneDxf(txt) {
  const L = txt.split(/\r?\n/), blocks = new Map(), model = [];
  let section = '', cur = null, blk = null, poly = null, pend = false;
  const num = (g, c, d = 0) => { const v = g[c]; return v === undefined ? d : parseFloat(Array.isArray(v) ? v[0] : v); };
  const flush = () => {
    if (!cur) return; const { t, g } = cur; cur = null;
    const into = e => { if (!e) return; if (section === 'BLOCKS') blk && blk.ents.push(e); else if (section === 'ENTITIES' && num(g, 67, 0) !== 1) model.push(e); };
    if (section === 'BLOCKS' && t === 'BLOCK') { blk = { ents: [], bx: num(g, 10), by: num(g, 20) }; blocks.set(String(g[2] ?? g[3] ?? ''), blk); return; }
    if (section === 'BLOCKS' && t === 'ENDBLK') { blk = null; return; }
    if (section !== 'ENTITIES' && !(section === 'BLOCKS' && blk)) return;
    if (t === 'VERTEX') { if (poly) poly.pts.push(num(g, 10), num(g, 20)); return; }
    if (t === 'SEQEND') { if (poly && poly.pts.length >= 4) into(poly); poly = null; return; }
    if (t === 'LINE') into({ t: 'L', x1: num(g, 10), y1: num(g, 20), x2: num(g, 11), y2: num(g, 21) });
    else if (t === 'LWPOLYLINE') { const xs = g[10] || [], ys = g[20] || []; const pts = []; for (let i = 0; i < xs.length; i++) pts.push(parseFloat(xs[i]), parseFloat(ys[i])); if (pts.length >= 4) into({ t: 'P', pts, closed: (num(g, 70) & 1) === 1 }); }
    else if (t === 'POLYLINE') poly = { t: 'P', pts: [], closed: (num(g, 70) & 1) === 1 };
    else if (t === 'CIRCLE') into({ t: 'A', cx: num(g, 10), cy: num(g, 20), rx: num(g, 40), ry: num(g, 40), a0: 0, a1: 2 * Math.PI });
    else if (t === 'ARC') into({ t: 'A', cx: num(g, 10), cy: num(g, 20), rx: num(g, 40), ry: num(g, 40), a0: num(g, 50) * DEG, a1: num(g, 51) * DEG });
    else if (t === 'ELLIPSE') { const mx = num(g, 11), my = num(g, 21), rx = Math.hypot(mx, my); into({ t: 'A', cx: num(g, 10), cy: num(g, 20), rx, ry: rx * num(g, 40, 1), a0: num(g, 41, 0), a1: num(g, 42, 2 * Math.PI), rot: Math.atan2(my, mx) }); }
    else if (t === 'TEXT' || t === 'ATTRIB') { const s = cadText(g[1] ?? ''); if (s) into({ t: 'T', x: num(g, 10), y: num(g, 20), h: num(g, 40, 1), rot: num(g, 50) * DEG, s }); }
    else if (t === 'MTEXT') { const s = cadText(((g[3] || []).join('') + (g[1] || '')), true).replace(/\n+/g, ' '); if (s) into({ t: 'T', x: num(g, 10), y: num(g, 20), h: num(g, 40, 1), rot: num(g, 50) * DEG, s, ml: true }); }
    else if (t === 'INSERT') into({ t: 'I', name: String(g[2] ?? ''), x: num(g, 10), y: num(g, 20), sx: num(g, 41, 1), sy: num(g, 42, 1), rot: num(g, 50) * DEG, rows: num(g, 71, 1), cols: num(g, 70, 1), dx: num(g, 44), dy: num(g, 45) });
  };
  for (let i = 0; i + 1 < L.length; i += 2) {
    const c = parseInt(L[i], 10), v = (L[i + 1] ?? '').replace(/\r$/, '');
    if (c === 0) {
      flush(); const t = v.trim();
      if (t === 'SECTION') { pend = true; section = ''; continue; } if (t === 'ENDSEC') { section = ''; continue; }
      cur = { t, g: {} }; continue;
    }
    if (pend && c === 2) { section = v.trim(); pend = false; continue; }
    if (!cur) continue;
    if (c === 10 || c === 20) { if (!Array.isArray(cur.g[c])) cur.g[c] = cur.g[c] === undefined ? [] : [cur.g[c]]; cur.g[c].push(v); }   // polilíneas: varios vértices
    else if (c === 3) { if (!Array.isArray(cur.g[3])) cur.g[3] = cur.g[3] === undefined ? [] : [cur.g[3]]; cur.g[3].push(v); }
    else if (cur.g[c] === undefined || c === 1) cur.g[c] = v;
    if ((c === 10 || c === 20) && cur.t !== 'LWPOLYLINE') cur.g[c] = cur.g[c][0];   // resto de entidades: valor único
  }
  flush(); return build(model, blocks);
}


// ---- DGN V7 (solo geometría: líneas, cadenas de líneas y formas; el texto ya se extrae aparte) ----
function sceneDgn7(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), n = u8.length, model = [];
  const i32 = p => (dv.getInt16(p, true) << 16) | dv.getUint16(p + 2, true);
  let pos = 0, is3d = false, first = true;
  while (pos + 4 <= n) {
    const w0 = dv.getUint16(pos, true); if (w0 === 0xFFFF) break;
    const type = (w0 >> 8) & 0x7f, words = dv.getUint16(pos + 2, true), size = (words + 2) * 2;
    if (size < 4 || pos + size > n) break;
    if (first && type === 9 && size > 1215) is3d = !!(u8[pos + 1214] & 0x40);
    if (type !== 9 && type !== 8) first = false;
    if (!(w0 & 0x8000)) {
      const st = is3d ? 12 : 8;
      if (type === 3 && size >= 36 + 2 * st) model.push({ t: 'L', x1: i32(pos + 36), y1: i32(pos + 40), x2: i32(pos + 36 + st), y2: i32(pos + 40 + st) });
      else if ((type === 4 || type === 6) && size >= 38) {
        const nv = Math.min(dv.getUint16(pos + 36, true), Math.floor((size - 38) / st)), pts = [];
        for (let k = 0; k < nv; k++) pts.push(i32(pos + 38 + k * st), i32(pos + 42 + k * st));
        if (pts.length >= 4) model.push({ t: 'P', pts, closed: type === 6 });
      }
    }
    pos += size;
  }
  return build(model, new Map());
}
export async function cadScene(ext, u8) {
  if (ext === 'dgn') { if (u8[0] === 0xD0 && u8[1] === 0xCF) throw new Error('DGN V8: no se puede dibujar (solo DGN V7)'); return sceneDgn7(u8); }
  const head = new TextDecoder().decode(u8.subarray(0, 20));
  return ext === 'dxf' && !head.startsWith('AutoCAD Binary') ? sceneDxf(new TextDecoder('utf-8').decode(u8)) : sceneDwg(u8, ext === 'dxf' ? 'DXF' : 'DWG');
}
// dibuja solo la geometría en un canvas blanco (para OCR de texto dibujado con líneas)
export function renderStrokes(scene, maxSide = 5000) {
  const [x0, y0, x1, y1] = scene.bounds, W0 = Math.max(1e-9, x1 - x0), H0 = Math.max(1e-9, y1 - y0), s = maxSide / Math.max(W0, H0) * 0.98;
  const c = document.createElement('canvas'); c.width = Math.max(16, Math.ceil(W0 * s) + 20); c.height = Math.max(16, Math.ceil(H0 * s) + 20);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.strokeStyle = '#000'; g.lineWidth = 1.6; g.lineJoin = 'round'; g.beginPath();
  for (const st of scene.strokes) { g.moveTo((st[0] - x0) * s + 10, (y1 - st[1]) * s + 10); for (let i = 2; i < st.length; i += 2) g.lineTo((st[i] - x0) * s + 10, (y1 - st[i + 1]) * s + 10); }
  g.stroke();
  // texto convertido a contornos (fuentes TrueType explotadas): los contornos cerrados pequeños se rellenan para que se lean como letras
  const lim = Math.max(W0, H0) * 0.03; g.fillStyle = '#000'; g.beginPath();
  for (const st of scene.strokes) {
    const n = st.length; if (n < 8 || Math.abs(st[0] - st[n - 2]) > 1e-6 || Math.abs(st[1] - st[n - 1]) > 1e-6) continue;
    let a = Infinity, b = Infinity, c2 = -Infinity, d = -Infinity; for (let i = 0; i < n; i += 2) { a = Math.min(a, st[i]); c2 = Math.max(c2, st[i]); b = Math.min(b, st[i + 1]); d = Math.max(d, st[i + 1]); }
    if (c2 - a > lim || d - b > lim) continue;
    g.moveTo((st[0] - x0) * s + 10, (y1 - st[1]) * s + 10); for (let i = 2; i < n; i += 2) g.lineTo((st[i] - x0) * s + 10, (y1 - st[i + 1]) * s + 10); g.closePath();
  }
  g.fill('evenodd'); return c;
}
export async function openCadViewer({ blob, name, ext, terms = [] }) {
  document.getElementById('viewer')?.remove();
  const wrap = document.createElement('div'); wrap.id = 'viewer';
  wrap.innerHTML = `<div class="vwin"><div class="vbar"><b class="vname">${esc(name)}</b>
    <button class="sec" data-v="fit">Ajustar</button><button class="sec" data-v="out">−</button><button class="sec" data-v="in">＋</button>
    <input id="cv-q" placeholder="Buscar texto en el plano" style="width:190px"><button class="sec" data-v="prev">◀</button><button class="sec" data-v="next">▶</button><span class="m vhits"></span>
    <span style="flex:1"></span><button class="sec" data-v="dl">Descargar original</button></div>
    <div class="vbody" style="padding:0;overflow:hidden;position:relative"><canvas id="cv" style="width:100%;height:100%;display:block;background:#fff;cursor:grab;touch-action:none"></canvas><div class="m" id="cv-msg" style="position:absolute;left:10px;top:8px;background:#fffd;color:#111;padding:3px 8px;border-radius:6px">Cargando plano…</div></div></div>`;
  document.body.appendChild(wrap);
  const cv = wrap.querySelector('#cv'), g = cv.getContext('2d'), msg = wrap.querySelector('#cv-msg'), hits = wrap.querySelector('.vhits'), q = wrap.querySelector('#cv-q');
  const close = () => { document.removeEventListener('keydown', onKey); leaveFs(); wrap.remove(); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey); decorate(wrap, close);
  let scene, view = { s: 1, x: 0, y: 0 }, matches = [], cur = -1, raf = 0;   // pantalla = (mundo - origen) * s, eje Y invertido
  const size = () => { const r = cv.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1); cv.width = Math.max(1, r.width * d); cv.height = Math.max(1, r.height * d); return { w: r.width, h: r.height, d }; };
  const fit = () => { const { w, h } = size(), [x0, y0, x1, y1] = scene.bounds, s = Math.min(w / Math.max(1e-9, x1 - x0), h / Math.max(1e-9, y1 - y0)) * 0.92; view = { s, x: (x0 + x1) / 2 - w / 2 / s, y: (y0 + y1) / 2 + h / 2 / s }; draw(); };
  const sx = x => (x - view.x) * view.s, sy = y => (view.y - y) * view.s;
  function draw() {
    cancelAnimationFrame(raf); raf = requestAnimationFrame(() => {
      const { w, h, d } = size(); g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, w, h);
      g.lineWidth = 1; g.strokeStyle = '#2b3340'; g.beginPath();
      for (const st of scene.strokes) { g.moveTo(sx(st[0]), sy(st[1])); for (let i = 2; i < st.length; i += 2) g.lineTo(sx(st[i]), sy(st[i + 1])); }
      g.stroke();
      g.fillStyle = '#0b5cad';
      for (const t of scene.texts) {
        const px = t.h * view.s; if (px < 2.5) { g.fillRect(sx(t.x), sy(t.y) - 1, Math.max(1, t.s.length * px * .5), 1.2); continue; }
        if (px > 400) continue; g.save(); g.translate(sx(t.x), sy(t.y)); g.rotate(-t.rot); g.font = `${px}px sans-serif`; g.fillText(t.s, 0, 0); g.restore();
      }
      matches.forEach((t, i) => {
        const wpx = Math.max(6, t.s.length * t.h * view.s * 0.55), hpx = Math.max(6, t.h * view.s * 1.2), x = sx(t.x), y = sy(t.y);
        g.save(); g.translate(x, y); g.rotate(-t.rot); g.fillStyle = i === cur ? 'rgba(255,200,0,.55)' : 'rgba(255,235,0,.35)'; g.strokeStyle = '#d00'; g.lineWidth = i === cur ? 2.5 : 1.2; g.fillRect(-2, -hpx, wpx + 4, hpx + 3); g.strokeRect(-2, -hpx, wpx + 4, hpx + 3); g.restore();
        if (view.s * t.h < 6) { g.strokeStyle = '#d00'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 9, 0, 6.3); g.stroke(); }   // aro visible aunque el texto sea diminuto
      });
    });
  }
  const find = (zoomTo = true) => {
    const ts = [...new Set(q.value.split(/\s+/).map(norm).filter(t => t.length >= 2))];
    matches = ts.length ? scene.texts.filter(t => { const s = norm(t.s); return ts.every(x => s.includes(x)) || ts.some(x => s.includes(x)); }) : [];
    cur = matches.length ? 0 : -1; hits.textContent = ts.length ? `${matches.length} texto(s)` : ''; if (matches.length && zoomTo) go(0); else draw();
  };
  const go = i => { cur = (i + matches.length) % matches.length; const t = matches[cur], { w, h } = size(); if (view.s * t.h < 14) view.s = 18 / t.h; view.x = t.x - w / 2 / view.s; view.y = t.y + h / 2 / view.s; hits.textContent = `${cur + 1} de ${matches.length}`; draw(); };
  const zoom = (f, cx, cy) => { const { w, h } = size(); cx ??= w / 2; cy ??= h / 2; const wx = view.x + cx / view.s, wy = view.y - cy / view.s; view.s *= f; view.x = wx - cx / view.s; view.y = wy + cy / view.s; draw(); };
  cv.addEventListener('wheel', e => { e.preventDefault(); const r = cv.getBoundingClientRect(); zoom(e.deltaY < 0 ? 1.25 : 0.8, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  let drag = null;
  cv.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing'; });
  cv.addEventListener('pointermove', e => { if (!drag) return; view.x -= (e.clientX - drag.x) / view.s; view.y += (e.clientY - drag.y) / view.s; drag = { x: e.clientX, y: e.clientY }; draw(); });
  cv.addEventListener('pointerup', () => { drag = null; cv.style.cursor = 'grab'; });
  addEventListener('resize', () => scene && draw());
  q.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); matches.length && e.shiftKey ? go(cur - 1) : matches.length && hits.textContent && cur >= 0 && document.activeElement === q && q.dataset.done === q.value ? go(cur + 1) : (find(true), q.dataset.done = q.value); } e.stopPropagation(); };
  wrap.addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (!b) return; const a = b.dataset.v;
    if (a === 'close') close(); else if (a === 'fit' && scene) fit(); else if (a === 'in') zoom(1.4); else if (a === 'out') zoom(1 / 1.4);
    else if (a === 'next' && matches.length) go(cur + 1); else if (a === 'prev' && matches.length) go(cur - 1);
    else if (a === 'dl') { const l = document.createElement('a'); l.href = URL.createObjectURL(blob); l.download = name; l.click(); } });
  try {
    const u8 = new Uint8Array(await blob.arrayBuffer());
    if (ext === 'dgn' && u8[0] === 0xD0 && u8[1] === 0xCF) throw new Error('La vista de planos no está disponible para DGN V8 (se indexa su texto, pero el dibujo solo puede abrirse con MicroStation o similar).');
    scene = await cadScene(ext, u8);
    msg.textContent = `${scene.strokes.length} trazos · ${scene.texts.length} textos${scene.truncated ? ' · plano muy grande: dibujo parcial' : ''} · rueda = zoom, arrastrar = mover`;
    q.value = terms.join(' '); fit(); if (terms.length) find(false);
  } catch (e) { msg.textContent = 'No se pudo mostrar el plano: ' + (e.message || e); msg.style.color = '#b00'; }
}

// ---- comparación gráfica de dos planos: lo que solo está en A (rojo), solo en B (verde) y lo común (gris) ----
export function diffScenes(A, B, maxSide = 1600) {
  const x0 = Math.min(A.bounds[0], B.bounds[0]), y0 = Math.min(A.bounds[1], B.bounds[1]), x1 = Math.max(A.bounds[2], B.bounds[2]), y1 = Math.max(A.bounds[3], B.bounds[3]);
  const q = Math.max(x1 - x0, y1 - y0) / 4000 || 1, sig = st => { const o = []; for (let i = 0; i < st.length; i += 2) o.push(Math.round(st[i] / q), Math.round(st[i + 1] / q)); const f = o.join(','), r = []; for (let i = o.length - 2; i >= 0; i -= 2) r.push(o[i], o[i + 1]); const b = r.join(','); return f < b ? f : b; };
  const sa = new Map(A.strokes.map(s => [sig(s), s])), sb = new Map(B.strokes.map(s => [sig(s), s])), onlyA = [], onlyB = [], both = [];
  for (const [k, s] of sa) (sb.has(k) ? both : onlyA).push(s); for (const [k, s] of sb) if (!sa.has(k)) onlyB.push(s);
  const W0 = Math.max(1e-9, x1 - x0), H0 = Math.max(1e-9, y1 - y0), sc = maxSide / Math.max(W0, H0), c = document.createElement('canvas'); c.width = Math.ceil(W0 * sc) + 20; c.height = Math.ceil(H0 * sc) + 20;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  const paint = (list, col, w) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); for (const st of list) { g.moveTo((st[0] - x0) * sc + 10, (y1 - st[1]) * sc + 10); for (let i = 2; i < st.length; i += 2) g.lineTo((st[i] - x0) * sc + 10, (y1 - st[i + 1]) * sc + 10); } g.stroke(); };
  paint(both, '#b0b6bf', 1); paint(onlyA, '#d32f2f', 1.8); paint(onlyB, '#2e7d32', 1.8);
  const ta = new Set(A.texts.map(t => t.s)), tb = new Set(B.texts.map(t => t.s));
  return { canvas: c, onlyA: onlyA.length, onlyB: onlyB.length, both: both.length, textsRemoved: [...ta].filter(t => !tb.has(t)), textsAdded: [...tb].filter(t => !ta.has(t)) };
}
