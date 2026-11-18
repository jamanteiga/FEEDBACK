// Comparación literal entre dos versiones de un documento: líneas añadidas/eliminadas y valores técnicos que cambian. Sin interpretar.
import { analyze } from './report.js';
const lines = pages => pages.flatMap(p => (p.text || '').split('\n').map(t => t.replace(/\s+/g, ' ').trim()).filter(Boolean).map(t => ({ t, loc: p.label || 'pág. ' + p.pageNo })));

export function diffLines(A, B) {   // → [{op:'=',a,b} | {op:'-',a} | {op:'+',b}] o null si es demasiado grande
  let s = 0; while (s < A.length && s < B.length && A[s].t === B[s].t) s++;
  let ea = A.length, eb = B.length; while (ea > s && eb > s && A[ea - 1].t === B[eb - 1].t) { ea--; eb--; }
  const a = A.slice(s, ea), b = B.slice(s, eb), n = a.length, m = b.length;
  if (n * m > 25e6) return null;
  const W = m + 1, L = new Uint16Array((n + 1) * W);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i * W + j] = a[i].t === b[j].t ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
  const out = A.slice(0, s).map((x, i) => ({ op: '=', a: x, b: B[i] }));
  let i = 0, j = 0;
  while (i < n && j < m) { if (a[i].t === b[j].t) { out.push({ op: '=', a: a[i], b: b[j] }); i++; j++; } else if (L[(i + 1) * W + j] >= L[i * W + j + 1]) out.push({ op: '-', a: a[i++] }); else out.push({ op: '+', b: b[j++] }); }
  while (i < n) out.push({ op: '-', a: a[i++] }); while (j < m) out.push({ op: '+', b: b[j++] });
  for (let k = ea; k < A.length; k++) out.push({ op: '=', a: A[k], b: B[eb + k - ea] });
  return out;
}

export function compareDocs(pa, pb) {
  const ops = diffLines(lines(pa), lines(pb));
  const va = new Map(), vb = new Map(), key = v => v.cat + '|' + v.value;
  for (const v of analyze(pa).values) if (v.value !== '—') va.set(key(v), v);
  for (const v of analyze(pb).values) if (v.value !== '—') vb.set(key(v), v);
  const values = [...[...va].filter(([k]) => !vb.has(k)).map(([, v]) => ({ side: 'solo en A', ...v })), ...[...vb].filter(([k]) => !va.has(k)).map(([, v]) => ({ side: 'solo en B', ...v }))];
  return { ops, values, added: ops?.filter(o => o.op === '+').length ?? 0, removed: ops?.filter(o => o.op === '-').length ?? 0, same: ops?.filter(o => o.op === '=').length ?? 0 };
}

export function hunks(ops, ctx = 2) {   // agrupa los cambios con unas líneas de contexto
  const keep = new Set(); ops.forEach((o, i) => { if (o.op !== '=') for (let k = i - ctx; k <= i + ctx; k++) if (k >= 0 && k < ops.length) keep.add(k); });
  const out = []; let cur = null;
  ops.forEach((o, i) => { if (!keep.has(i)) { cur = null; return; } if (!cur) out.push(cur = []); cur.push(o); });
  return out;
}
