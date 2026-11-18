// Búsqueda por valores con unidades normalizadas: «caudal > 5000 m3/h», «presión 100-300 Pa», «< 65 dB(A)».
// Las cantidades se convierten a una unidad base de su magnitud (5.000 m³/h = 1,39 m³/s = 1388,9 l/s) y se comparan en esa base.
// Solo se compara lo escrito literalmente en los documentos; no se infiere ninguna magnitud que no lleve unidad.
const T = (dim, name, f, o = 0) => ({ dim, name, f, o });   // valor_base = valor·f + o
const UNITS = {
  'm3/h': T('caudal', 'm³/h', 1 / 3600), 'm3/s': T('caudal', 'm³/s', 1), 'm3/min': T('caudal', 'm³/min', 1 / 60), 'l/s': T('caudal', 'l/s', 1e-3), 'l/min': T('caudal', 'l/min', 1 / 60000), 'cfm': T('caudal', 'cfm', 4.71947e-4), 'l/h': T('caudal', 'l/h', 1 / 3.6e6),
  'ren/h': T('renovaciones', 'ren/h', 1),
  'pa': T('presión', 'Pa', 1), 'dapa': T('presión', 'daPa', 10), 'kpa': T('presión', 'kPa', 1e3), 'mpa': T('presión', 'MPa', 1e6), 'bar': T('presión', 'bar', 1e5), 'mbar': T('presión', 'mbar', 100),
  'mmca': T('presión', 'mm c.a.', 9.80665), 'mmh2o': T('presión', 'mm c.a.', 9.80665), 'mca': T('presión', 'm c.a.', 9806.65), 'psi': T('presión', 'psi', 6894.757),
  'm/s': T('velocidad', 'm/s', 1), 'km/h': T('velocidad', 'km/h', 1 / 3.6), 'cm/s': T('velocidad', 'cm/s', 0.01), 'kn': T('velocidad', 'kn', 0.514444),
  '°c': T('temperatura', '°C', 1), 'k': T('temperatura', 'K', 1, -273.15), '°f': T('temperatura', '°F', 5 / 9, -160 / 9),
  'mm': T('longitud', 'mm', 1e-3), 'cm': T('longitud', 'cm', 1e-2), 'm': T('longitud', 'm', 1), 'km': T('longitud', 'km', 1e3), 'in': T('longitud', 'in', 0.0254),
  'w': T('potencia', 'W', 1), 'kw': T('potencia', 'kW', 1e3), 'mw': T('potencia', 'MW', 1e6), 'kcal/h': T('potencia', 'kcal/h', 1.163), 'fg/h': T('potencia', 'fg/h', 1.163), 'btu/h': T('potencia', 'BTU/h', 0.29307107), 'cv': T('potencia', 'CV', 735.4988), 'hp': T('potencia', 'HP', 745.6999),
  'db': T('sonoro', 'dB', 1), 'dba': T('sonoro', 'dB(A)', 1), 'db(a)': T('sonoro', 'dB(A)', 1),
  'kg/s': T('caudal másico', 'kg/s', 1), 'kg/h': T('caudal másico', 'kg/h', 1 / 3600),
  'kg': T('masa', 'kg', 1), 't': T('masa', 't', 1e3), 'g': T('masa', 'g', 1e-3),
  'm2': T('superficie', 'm²', 1), 'cm2': T('superficie', 'cm²', 1e-4), 'mm2': T('superficie', 'mm²', 1e-6),
  'm3': T('volumen', 'm³', 1), 'l': T('volumen', 'l', 1e-3),
  'hz': T('frecuencia', 'Hz', 1), 'khz': T('frecuencia', 'kHz', 1e3), 'rpm': T('giro', 'rpm', 1),
  'v': T('tensión', 'V', 1), 'kv': T('tensión', 'kV', 1e3), 'a': T('corriente', 'A', 1), 'ka': T('corriente', 'kA', 1e3),
  'w/m2': T('flujo térmico', 'W/m²', 1), 'w/mk': T('conductividad', 'W/m·K', 1),
};
// escrituras alternativas que se reconocen en el texto
const SPELL = { 'm³/h': 'm3/h', 'm^3/h': 'm3/h', 'm3h': 'm3/h', 'm³/s': 'm3/s', 'm³/min': 'm3/min', 'm²': 'm2', 'm³': 'm3', 'cm²': 'cm2', 'mm²': 'mm2', 'º c': '°c', 'ºc': '°c', '° c': '°c', 'grados': '°c', 'litros/s': 'l/s', 'lps': 'l/s', 'l/seg': 'l/s', 'mm.c.a.': 'mmca', 'mmc.a.': 'mmca', 'mmc.a': 'mmca', 'mmc a': 'mmca', 'mm c.a': 'mmca', 'mmc.a': 'mmca', 'mm ca': 'mmca', 'w/m·k': 'w/mk', 'w/m.k': 'w/mk', 'w/m k': 'w/mk', 'frig/h': 'fg/h', 'btu/hr': 'btu/h', 'renovaciones/h': 'ren/h', 'renovaciones/hora': 'ren/h', 'rev/min': 'rpm', 'r.p.m.': 'rpm' };
export const unitKey = raw => { let k = raw.trim().toLowerCase().replace(/\s+/g, ' '); k = SPELL[k] || SPELL[k.replace(/ /g, '')] || k.replace(/ /g, ''); return UNITS[k] ? k : (SPELL[k] || null); };

const NUM = String.raw`[-+]?(?:\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d{1,3}(?: \d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)`;
const UNIT_ALTS = [...new Set([...Object.keys(UNITS), ...Object.keys(SPELL)])].filter(u => u !== 'a' && u !== 'v' && u !== 'k' && u !== 'l' && u !== 't' && u !== 'g' && u !== 'in' && u !== 'kn' && u !== 'cv' && u !== 'hp' && u !== 'w')
  .concat(['k', 'l', 'kn', 'cv', 'hp', 'w', 'v', 'a'].filter(() => false)).sort((a, b) => b.length - a.length)
  .map(u => u.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&').replace(/ /g, '\\s?'));
const UNIT_SRC = String.raw`(?:${UNIT_ALTS.join('|')}|° ?c|º ?c|\bw\b|\bkw\b|\bhp\b|\bcv\b|\bl\/s\b)`;
const SAFE_SHORT = new Set(['w', 'v', 'a', 'k', 'l', 't', 'g', 'in', 'kn', 'cv', 'hp']);
const RX = new RegExp(String.raw`(${NUM})(?:\s*(?:-|–|—|a|y|hasta)\s*(${NUM}))?\s*(${UNIT_SRC})(?![A-Za-zÀ-ÿ0-9²³])`, 'gi');

export const toNum = s => {
  s = s.replace(/\s/g, '');
  if (/^[-+]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) || /^[-+]?[1-9]\d{0,2}\.\d{3}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(',', '.');
  return parseFloat(s);
};
const toBase = (v, u) => v * UNITS[u].f + UNITS[u].o;

// Valores con unidad que aparecen en un texto: [{raw, idx, dim, lo, hi, unit}] (lo/hi en unidad base)
export function valuesIn(text) {
  const out = []; RX.lastIndex = 0; let m;
  while ((m = RX.exec(text))) {
    const key = unitKey(m[3]); if (!key) continue;
    const a = toNum(m[1]), b = m[2] != null ? toNum(m[2]) : a; if (!isFinite(a) || !isFinite(b)) continue;
    const lo = Math.min(toBase(a, key), toBase(b, key)), hi = Math.max(toBase(a, key), toBase(b, key));
    out.push({ raw: m[0].trim(), idx: m.index, dim: UNITS[key].dim, lo, hi, unit: UNITS[key].name, a, b, key });
  }
  return out;
}

// «caudal >= 5000 m3/h», «8-12 m/s», «< 65 dB(A)». Devuelve { cond:{op,lo,hi,dim,unit,label}, rest } o null si no hay valor con unidad.
const OPS = [[/\b(?:mayor|superior)\s+(?:o\s+igual\s+)?(?:que|a)\b|\bal\s+menos\b|\bm[ií]nimo\b|\bmin\.?\b/i, '>='], [/\b(?:menor|inferior)\s+(?:o\s+igual\s+)?(?:que|a)\b|\bcomo\s+m[aá]ximo\b|\bm[aá]ximo\b|\bmax\.?\b/i, '<=']];
export function parseValueQuery(q) {
  const unq = q.replace(/"[^"]*"/g, m => ' '.repeat(m.length));   // lo que va entre comillas se busca como frase, no como valor
  const rx = new RegExp(String.raw`(>=|<=|≥|≤|>|<|=|≈|~)?\s*(${NUM})(?:\s*(?:-|–|—|a|y|hasta)\s*(${NUM}))?\s*(${UNIT_SRC})(?![A-Za-zÀ-ÿ0-9²³])`, 'i');
  const m = rx.exec(unq); if (!m) return null;
  const key = unitKey(m[4]); if (!key) return null;
  if (SAFE_SHORT.has(key) && !m[1] && m[3] == null && !/\d\s?(w|v|a|k|l|t|g|in|kn|cv|hp)\b/i.test(m[0])) return null;
  let op = m[1] || (m[3] != null ? 'rango' : '='); op = { '≥': '>=', '≤': '<=', '≈': '~', '=': '=' }[op] || op;
  let before = (q.slice(0, m.index) + ' ' + q.slice(m.index + m[0].length));
  for (const [re, o] of OPS) if (re.test(before)) { if (!m[1] && m[3] == null) op = o; before = before.replace(re, ' '); }
  const a = toNum(m[2]), b = m[3] != null ? toNum(m[3]) : a, A = toBase(a, key), B = toBase(b, key), dim = UNITS[key].dim;
  const cond = { op, dim, unit: UNITS[key].name, lo: Math.min(A, B), hi: Math.max(A, B) };
  cond.label = op === 'rango' ? `${m[2]}–${m[3]} ${UNITS[key].name}` : `${op === '=' ? '' : op + ' '}${m[2]} ${UNITS[key].name}`;
  return { cond, rest: before.replace(/\s+/g, ' ').trim() };
}
// ¿Cumple el valor encontrado la condición? (con una pequeña tolerancia relativa en igualdades por redondeos de unidades)
export function matches(v, c) {
  if (v.dim !== c.dim) return false;
  const tol = Math.max(Math.abs(c.hi), Math.abs(c.lo)) * 0.005 + 1e-9;
  switch (c.op) {
    case '>': return v.hi > c.lo + tol; case '>=': return v.hi >= c.lo - tol;
    case '<': return v.lo < c.hi - tol; case '<=': return v.lo <= c.hi + tol;
    case 'rango': return v.hi >= c.lo - tol && v.lo <= c.hi + tol;
    default: return v.lo <= c.hi + tol && v.hi >= c.lo - tol;   // = ~
  }
}
export const matchValues = (text, c) => valuesIn(text).filter(v => matches(v, c));
// equivalencia legible: «5000 m³/h» → «= 1,39 m³/s»
export function equiv(v) {
  const base = { caudal: ['m³/s', 1], presión: ['Pa', 1], velocidad: ['m/s', 1], longitud: ['m', 1], potencia: ['W', 1] }[v.dim]; if (!base || v.lo !== v.hi) return '';
  const alt = { caudal: ['l/s', 1e-3], presión: ['kPa', 1e3], velocidad: ['km/h', 1 / 3.6], longitud: ['mm', 1e-3], potencia: ['kW', 1e3] }[v.dim], f = x => (Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 1 ? x.toFixed(2) : x.toPrecision(3)).replace('.', ',');
  const parts = [`${f(v.lo / base[1])} ${base[0]}`, alt && `${f(v.lo / alt[1])} ${alt[0]}`].filter(Boolean).filter(s => !s.endsWith(' ' + v.unit));
  return parts.length ? '= ' + parts.join(' = ') : '';
}
