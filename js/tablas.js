// Extracción de tablas de PDF con texto (PDF.js): agrupa por filas y columnas según las posiciones. Resultado orientativo: revisar siempre.
export async function pageTables(page) {
  const tc = await page.getTextContent(), items = [];
  for (const it of tc.items) { const s = (it.str || '').replace(/\s+/g, ' ').trim(); if (!s) continue; const h = Math.abs(it.transform[3]) || it.height || 8; items.push({ s, x: it.transform[4], y: it.transform[5], w: it.width || s.length * h * 0.5, h }); }
  if (items.length < 6) return [];
  const medH = items.map(i => i.h).sort((a, b) => a - b)[items.length >> 1] || 8;
  items.sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = []; for (const it of items) { const r = rows.at(-1); if (r && Math.abs(r.y - it.y) <= Math.max(2, medH * 0.45)) r.items.push(it); else rows.push({ y: it.y, items: [it] }); }
  for (const r of rows) {
    r.items.sort((a, b) => a.x - b.x); const cells = [];
    for (const it of r.items) { const c = cells.at(-1), cw = it.w / Math.max(1, it.s.length); if (c && it.x - (c.x + c.w) < Math.max(cw * 1.2, medH * 0.45)) { c.s += ' ' + it.s; c.w = it.x + it.w - c.x; } else cells.push({ s: it.s, x: it.x, w: it.w }); }
    r.cells = cells;
  }
  const tables = []; let blk = [];
  const flush = () => { if (blk.length >= 3) { const t = build(blk); if (t) tables.push(t); } blk = []; };
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], prev = blk.at(-1);
    if (r.cells.length >= 2 && (!prev || prev.y - r.y <= medH * 3.2)) blk.push(r); else { flush(); if (r.cells.length >= 2) blk.push(r); }
  }
  flush(); return tables;
}
function build(rows) {
  const iv = rows.flatMap(r => r.cells.map(c => [c.x, c.x + c.w])).sort((a, b) => a[0] - b[0]), cols = [];
  for (const [a, b] of iv) { const c = cols.at(-1); if (c && a <= c[1] + 1) c[1] = Math.max(c[1], b); else cols.push([a, b]); }
  if (cols.length < 2 || cols.length > 40) return null;
  const grid = rows.map(r => { const row = Array(cols.length).fill(''); for (const c of r.cells) { const k = cols.findIndex(([a, b]) => c.x >= a - 1 && c.x <= b + 1); if (k >= 0) row[k] = row[k] ? row[k] + ' ' + c.s : c.s; } return row; });
  const fill = grid.reduce((n, r) => n + r.filter(Boolean).length, 0) / (grid.length * cols.length);
  if (fill < 0.5) return null;
  return grid;
}
export async function docTables(pdf, onlyPage) {
  const out = [], from = onlyPage || 1, to = onlyPage || pdf.numPages;
  for (let n = from; n <= to; n++) { const pg = await pdf.getPage(n); for (const g of await pageTables(pg)) out.push({ pageNo: n, rows: g }); }
  return out;
}
