// Búsqueda por significado SIN modelos descargados ni envío de datos: (a) diccionario HVAC/naval ES-EN y (b) términos relacionados
// calculados con tus propios documentos (coocurrencia en la misma página). No es un modelo neuronal: amplía la búsqueda, no la «entiende».
import { DB } from './db.js';
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const tok = t => t.split(/[^\p{L}\p{N}]+/u).map(norm).filter(w => w.length >= 3);
const GROUPS = [
  'caudal, flujo, gasto, flow, m3/h, l/s, volumen de aire', 'renovacion, renovaciones, aire exterior, aire fresco, ventilacion, ventilation, fresh air, ach',
  'velocidad, m/s, velocity, speed', 'presion, pa, mmca, mbar, bar, pressure, depresion, sobrepresion', 'perdida de carga, caida de presion, pressure drop, resistencia',
  'conducto, ducto, canalizacion, duct, trunking', 'tuberia, pipe, piping, line', 'ventilador, extractor, impulsor, fan, blower, turbina', 'enfriadora, chiller, planta frigorifica, grupo frigorifico, refrigerador',
  'bateria, serpentin, coil, intercambiador, heat exchanger, evaporador, condensador', 'filtro, filter, prefiltro, hepa', 'difusor, rejilla, boca, diffuser, grille, anemostato, toma',
  'compuerta, damper, clapeta, regulador, valvula de regulacion', 'cortafuegos, fire damper, trampilla, compuerta cortafuegos, rf, resistente al fuego', 'silenciador, atenuador, silencer, attenuator',
  'ruido, sonoro, acustico, db, dba, noise, sound, nivel sonoro', 'aislamiento, aislante, insulation, lana mineral, aislado', 'temperatura, tª, temp, temperature, grados, °c',
  'humedad, hr, humidity, humidificador, deshumidificador', 'calefaccion, calentamiento, heating, calor, resistencia electrica, reheater, recalentador', 'refrigeracion, enfriamiento, cooling, frio, aire acondicionado, ac, hvac, clima',
  'camarote, cabina, cabin, alojamiento, accommodation', 'sala de maquinas, cuarto de maquinas, engine room, machinery space, er', 'cocina, galley, office', 'puente, wheelhouse, bridge, timoneria',
  'cubierta, deck, cuaderna, frame', 'mamparo, bulkhead, shell, forro', 'ventilacion mecanica, mecanica, forzada, mechanical ventilation', 'ventilacion natural, natural, pasiva',
  'extraccion, extract, exhaust, evacuacion, descarga', 'impulsion, supply, suministro, aporte', 'retorno, return, recirculacion', 'incendio, fuego, fire, contraincendios, ci, fi',
  'estanco, watertight, tight, wt', 'normativa, norma, standard, reglamento, regulation, code', 'clase, class, sociedad de clasificacion, dnv, lr, abs, bv, rina',
  'potencia, power, kw, vatios, w', 'consumo, consumption, demanda, carga termica, heat load', 'plano, drawing, dibujo, esquema, diagrama, schematic', 'requisito, requerimiento, requirement, especificacion, spec',
];
const idx = GROUPS.map(g => g.split(',').map(x => norm(x.trim())).filter(Boolean));
const byWord = new Map(); idx.forEach((g, i) => g.forEach(w => { const a = byWord.get(w) || []; a.push(i); byWord.set(w, a); }));
let inv = null, nPages = 0, key = '';
export async function prepare() {
  const ps = await DB.all('pages'), k = ps.length + ':' + ps.reduce((a, p) => a + (p.text?.length || 0), 0);
  if (inv && k === key) return; key = k; nPages = ps.length; inv = new Map();
  ps.forEach((p, i) => { for (const w of new Set(tok(p.text || ''))) { let s = inv.get(w); if (!s) inv.set(w, s = []); s.push(i); } });
}
const related = (w, k = 4) => {
  const A = inv?.get(w); if (!A || A.length < 2 || !nPages) return [];
  const cnt = new Map(), inA = new Set(A);
  for (const [u, B] of inv) { if (u === w || u.length < 4 || B.length < 2 || B.length > nPages * .25 || /^\d+$/.test(u)) continue; let c = 0; for (const p of B) if (inA.has(p)) c++; if (c >= 2) cnt.set(u, c / Math.sqrt(A.length * B.length)); }
  return [...cnt].filter(x => x[1] >= .5).sort((a, b) => b[1] - a[1]).slice(0, k).map(x => x[0]);
};
// palabra → ella misma + sinónimos del diccionario + relacionadas del corpus
export function semVariants(word) {
  const w = norm(word), out = new Set([word]);
  for (const gi of byWord.get(w) || []) for (const x of idx[gi]) if (!x.includes(' ') && x.length >= 2) out.add(x);
  for (const r of related(w)) out.add(r);
  return [...out];
}
export const explain = word => { const v = semVariants(word).filter(x => norm(x) !== norm(word)); return v.length ? `${word} ≈ ${v.slice(0, 8).join(', ')}` : ''; };
