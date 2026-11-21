// Metadatos de un documento a partir de su portada / cajetín: nº de documento, título, revisión, fecha y estado.
// Todo son PROPUESTAS por reglas sobre el texto extraído (u OCR); el usuario puede corregirlas en el índice maestro.
const norm = s => (s || '').normalize('NFD').replace(/\p{M}/gu, '');
const ESTADOS = [[/para\s+aprobacion|for\s+approval/i, 'Para aprobación'], [/para\s+informacion|for\s+information|\bfor\s+info\b/i, 'Para información'], [/para\s+construccion|for\s+construction|\bifc\b/i, 'Para construcción'], [/para\s+comentarios|for\s+comments?/i, 'Para comentarios'], [/as[\s-]?built|segun\s+construido/i, 'As built'], [/obsolet[oa]|superseded|anulado/i, 'Obsoleto'], [/borrador|\bdraft\b/i, 'Borrador'], [/\baprobado\b|\bapproved\b/i, 'Aprobado']];
export function isoDate(s) {
  let m = (s || '').match(/(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})/);
  if (m) return +m[2] <= 12 && +m[3] <= 31 ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
  m = (s || '').match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4}|\d{2})\b/);
  if (m) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return +m[2] <= 12 && +m[1] <= 31 ? `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null; }
  return null;
}
const BAD_REV = new Set(['DE', 'DEL', 'LA', 'EL', 'EN', 'Y', 'OF', 'THE', 'AND', 'CON', 'POR', 'QUE', 'LOS', 'LAS', 'UN', 'UNA']);
export function metaOf(d, pages) {
  if (d.kind === 'correo') return { titulo: d.subject || '', fecha: (d.emailDate || '').slice(0, 10), num: '', rev: '', estado: '' };
  const ps = [...pages].sort((a, b) => a.pageNo - b.pageNo), src = d.kind === 'plano' ? ps.slice(0, 6) : ps.slice(0, 2);
  const t = norm(src.map(p => p.text || '').join('\n')).slice(0, 12000), head = t.slice(0, 2500), out = { num: '', titulo: '', rev: '', fecha: '', estado: '' };
  let m = t.match(/(?:^|\n)\s*(?:n[o°º.]*\s*(?:de\s*)?(?:documento|plano|dibujo|doc\.?)|doc(?:ument)?\.?\s*(?:no|n[o°º]|number|num)\.?|drawing\s*(?:no|number|n[o°º])\.?|dwg\.?\s*no\.?|plano\s*n[o°º]?\.?|codigo(?:\s+del\s+documento)?|document\s*(?:no|number)\.?)\s*[:.\-]?\s*\n?\s*([A-Z0-9][A-Z0-9\-_\/.]{3,34})/i);
  if (m) out.num = m[1].replace(/[.\-_/]+$/, '');
  m = t.match(/(?:^|[\s(])(?:rev(?:ision)?|issue|edicion)\.?\s*[:.\-]?\s*\n?\s*([A-Za-z0-9]{1,3})(?![A-Za-z0-9])/i);
  if (m && m[1] === m[1].toUpperCase() && !BAD_REV.has(m[1])) out.rev = m[1];
  m = t.match(/(?:fecha|date)\s*[:.\-]?\s*\n?\s*([0-9][0-9\/.\-]{5,11}[0-9])/i); if (m) out.fecha = isoDate(m[1]) || '';
  if (!out.fecha) { const dm = head.match(/\b\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/); if (dm) out.fecha = isoDate(dm[0]) || ''; }
  m = t.match(/(?:^|\n)\s*(?:titulo(?:\s+del\s+(?:documento|plano))?|title|descripcion|description|asunto|subject)\s*[:\-]\s*\n?\s*([^\n\r]{4,120})/i);
  if (m) out.titulo = m[1].trim();
  else if (d.kind === 'pdf' || d.kind === 'documento') {
    const ln = head.split(/\n+/).map(x => x.trim()).find(x => x.length >= 8 && x.length <= 110 && /[A-Za-z]{4}/.test(x) && !/^(pag|page|fecha|date|rev|n[o°º]\b)/i.test(x) && (x.match(/\d/g) || []).length < x.length / 3);
    if (ln) out.titulo = ln;
  }
  m = head.match(/(?:estado|status)\s*[:.\-]\s*([^\n]{3,40})/i);
  const cand = m ? m[1] : head; for (const [re, nm] of ESTADOS) if (re.test(cand)) { out.estado = nm; break; }
  if (!out.estado && m) out.estado = m[1].trim().slice(0, 30);
  const f = (d.name || '').replace(/\.[^.]+$/, '').match(/[A-Za-z0-9]{2,}(?:[-_][A-Za-z0-9]{2,}){2,}/); if (f) out.numFile = f[0];
  return out;
}
