// Informe resumen: extracción LITERAL (sin IA) de valores técnicos y frases relevantes, más los puntos
// que el usuario ha marcado. Todo dato lleva archivo y página; nada se interpreta ni se resuelve.
const esc = s => (s ?? '').toString().replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const NUM = String.raw`\d+(?:[.,]\d+)?`;
const RNG = String.raw`${NUM}(?:\s*[-–a]\s*${NUM})?`;

// Categorías de valor (número + unidad) y de palabras clave (frase completa). Corresponden a 2.3 del documento de requisitos.
const VALUE_PATS = [
  ['Velocidades', new RegExp(String.raw`(${RNG})\s*(m\/s|m·s-1|m\s?s-1|km\/h)(?![A-Za-z])`, 'gi')],
  ['Caudales', new RegExp(String.raw`(${RNG})\s*(m3\/h|m³\/h|m3\/s|m³\/s|l\/s|l\/min|cfm|ren\/h|renovaciones\/h(?:ora)?)(?![A-Za-z])`, 'gi')],
  ['Presiones', new RegExp(String.raw`(${RNG})\s*(mbar|bar|kPa|MPa|Pa|mm\s?c\.?\s?a\.?|mmca|mmH2O|psi)(?![A-Za-z])`, 'gi')],
  ['Temperaturas', new RegExp(String.raw`(-?${RNG})\s*((?:°|º)\s?C|grados(?: cent[ií]grados)?|\sC(?![A-Za-z]))`, 'gi')],
  ['Espesores / dimensiones', new RegExp(String.raw`(${NUM})\s*(mm|cm)(?![A-Za-z])`, 'gi')],
  ['Requisitos acústicos', new RegExp(String.raw`(${RNG})\s*(dB\s?\(?A\)?|dBA|dB)(?![A-Za-z])`, 'gi')],
];
const KEY_PATS = [
  ['Materiales', /\b(acero|inox\w*|galvaniz\w*|aluminio|chapa|cobre|cupron[ií]quel|fibra de vidrio|PRFV|material)\b/i],
  ['Aislamiento térmico', /aislamiento|aislante|lana (?:mineral|de roca|de vidrio)|conductividad|W\/m\s?·?\s?K/i],
  ['Seguridad', /incendi\w*|fuego|estanqu\w*|\bA-?60\b|\bB-?15\b|\bEI\s?\d+|CBRN|NBQ|explosi\w*|t[oó]xic\w*|seguridad/i],
  ['Instalación y montaje', /montaje|instalaci[oó]n|soporte|sujeci[oó]n|fijaci[oó]n|brida|compuerta|registro de inspecci[oó]n/i],
];
const NORM = /\b(?:ISO|EN|UNE|IEC|IMO|ASTM|DIN|NFPA|MIL-STD|STANAG|NES|SOLAS|MSC|DNV|IACS|SMACNA)(?:[\s\-]*(?:EN|ISO))?[\s\-]*[A-Z]?\d[\w.\-\/:]*(?:\s?(?:\+|-)\s?[A-Z]\d+)?/g;
const REQ = /\b(deber[aá]n?|debe[n]?|m[aá]xim[oa]s?|m[ií]nim[oa]s?|no (?:se )?(?:podr[aá]n?|permitir[aá])|obligatori\w*|requisito\w*|shall|must|maximum|minimum)\b/i;

const sentences = text => text.split(/(?<=[.;!?])\s+|\n+/).map(s => s.replace(/\s+/g, ' ').trim()).filter(s => s.length > 3);
const clip = s => s.length > 240 ? s.slice(0, 237) + '…' : s;

// pages: [{pageNo, text, method, conf}] → { values:[{cat,value,ctx,page}], phrases:[{ctx,page}] }
export function analyze(pages) {
  const loc = p => p.label || p.pageNo;
  const values = [], phrases = [], seen = new Set();
  const push = (arr, o, k) => { const key = k + '|' + o.page; if (!seen.has(key)) { seen.add(key); arr.push(o); } };
  for (const p of pages) {
    for (const s of sentences(p.text || '')) {
      for (const [cat, re] of VALUE_PATS) { re.lastIndex = 0; let m; while ((m = re.exec(s))) push(values, { cat, value: m[0].trim(), ctx: clip(s), page: loc(p) }, cat + m[0] + s); }
      NORM.lastIndex = 0; let n; while ((n = NORM.exec(s))) push(values, { cat: 'Normativa y referencias', value: n[0].trim(), ctx: clip(s), page: loc(p) }, 'N' + n[0] + s);
      for (const [cat, re] of KEY_PATS) if (re.test(s)) push(values, { cat, value: '—', ctx: clip(s), page: loc(p) }, cat + s);
      if (REQ.test(s)) push(phrases, { ctx: clip(s), page: loc(p) }, 'P' + s);
    }
  }
  return { values, phrases };
}

const CSS = `body{font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#111;margin:24px}h1{font-size:20pt;margin:0 0 4pt}h2{font-size:14pt;border-bottom:1.5pt solid #1f5fbf;padding-bottom:2pt;margin-top:22pt;color:#1f3f7a}
h3{font-size:11.5pt;margin:12pt 0 3pt}table{border-collapse:collapse;width:100%;margin:4pt 0 8pt}td,th{border:.75pt solid #b8c0cc;padding:3pt 5pt;font-size:10pt;vertical-align:top;text-align:left}th{background:#e8eef8}
.nota{background:#fff8e6;border:.75pt solid #e6c675;padding:6pt 8pt;font-size:10pt}.m{color:#555;font-size:9.5pt}.warn{color:#9a4a00}ul{margin:2pt 0 6pt 16pt;padding:0}li{margin:2pt 0}@media print{h2{page-break-after:avoid}}`;

const NAME_OF = d => d.title ? `${d.title} (${d.name})` : (d.kind === 'correo' && d.subject ? `${d.subject} (${d.name})` : d.name);
const locOf = (pages, n) => (pages.find(q => q.pageNo === n) || {}).label || 'pág. ' + n;
const fmt = v => typeof v === 'number' ? 'pág. ' + v : v;
const day = s => (s || '').replace('T', ' ').slice(0, 16);

// Modelo neutro del informe: de aquí salen el HTML, el .docx, el .pdf y el .xlsx.
export function buildModel({ items, opts, scope, now = new Date(), rootName }) {
  const all = [];
  const docs = items.map((it, i) => {
    const { doc: d, pages, marks, parent } = it, an = opts.auto ? analyze(pages) : { values: [], phrases: [] };
    const confs = pages.filter(p => p.conf != null).map(p => p.conf), avg = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null;
    const low = pages.filter(p => p.conf != null && p.conf < 60).map(p => p.pageNo);
    const edited = pages.filter(p => p.edited).map(p => p.label || 'pág. ' + p.pageNo);
    const place = d.path ? [rootName(d.rootId), ...d.path].filter(Boolean).join(' / ') : (d.source === 'adjunto' ? 'adjunto de correo' : 'importado manualmente');
    const rows = [['Archivo', d.name], ['Tipo / origen', `${d.kind} · ${place}`]];
    if (d.title) rows.push(['Título', d.title]);
    if (d.tags) rows.push(['Etiquetas', d.tags]);
    if (d.note) rows.push(['Nota', d.note]);
    if (d.kind === 'correo') rows.push(['Asunto', d.subject || ''], ['De → Para', `${d.sender || ''} → ${d.to || ''}`], ['Fecha del correo', day(d.emailDate)]);
    else rows.push(['Fecha del archivo', day(d.fileDate)]);
    if (parent) rows.push(['Adjunto del correo', `${parent.subject || ''} (${parent.sender || ''}, ${(parent.emailDate || '').slice(0, 10)})`]);
    rows.push(['Partes / identificación', `${d.pages} · SHA-256 ${d.sha256.slice(0, 16)}…`]);
    if (avg != null) rows.push(['Calidad de OCR', `${Math.round(avg)} % de confianza media${low.length ? ` · ⚠ baja confianza en pág. ${low.join(', ')}: verificar contra el original` : ''}`]);
    if (edited.length) rows.push(['Texto corregido manualmente', `${edited.join(', ')} (corrección del usuario sobre el texto extraído)`]);
    const values = an.values.slice(0, 200).map(v => ({ cat: v.cat, value: v.value, ctx: v.ctx, loc: fmt(v.page) }));
    for (const v of an.values) if (['Velocidades', 'Caudales', 'Presiones', 'Temperaturas', 'Requisitos acústicos', 'Normativa y referencias'].includes(v.cat))
      all.push({ cat: v.cat, value: v.value, doc: d.title || d.name, loc: fmt(v.page), date: (d.emailDate || d.fileDate || '').slice(0, 10), n: i + 1 });
    return { n: i + 1, name: d.name, title: NAME_OF(d), rows, marks: marks.map(m => ({ text: m.text, loc: locOf(pages, m.pageNo), note: m.note || '' })),
      values, phrases: an.phrases.slice(0, 12).map(p => ({ ctx: p.ctx, loc: fmt(p.page) })) };
  });
  const cats = [...new Set(all.map(v => v.cat))];
  return {
    title: 'Informe resumen de documentación', when: now.toISOString().replace('T', ' ').slice(0, 16), scope, count: items.length, auto: !!opts.auto,
    method: 'Informe generado por extracción literal de texto (sin inteligencia artificial). Los valores detectados automáticamente son propuestas pendientes de revisión humana, con su texto literal y ubicación de origen; pueden contener errores de OCR o ambigüedades. Los puntos marcados los ha seleccionado el usuario. Los textos corregidos manualmente se indican como tales. Este informe no sustituye al documento original ni resuelve contradicciones entre documentos.',
    compareNote: 'Se muestran juntos los valores detectados en distintos documentos, con su fuente y fecha. No se determina cuál prevalece: la jerarquía documental la define el criterio del ingeniero y las reglas del proyecto.',
    docs,
    comparison: opts.auto && opts.compare ? cats.map(c => ({ cat: c, rows: all.filter(v => v.cat === c).sort((a, b) => a.value.localeCompare(b.value, 'es', { numeric: true })) })) : [],
  };
}

export function renderHtml(m) {
  const toc = m.docs.map(d => `<li><a href="#d${d.n}">${esc(d.title)}</a></li>`).join('');
  const sections = m.docs.map(d => {
    let h = `<h2 id="d${d.n}">${d.n}. ${esc(d.name)}</h2><table>${d.rows.map(([k, v]) => `<tr><th style="width:22%">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>`;
    h += `<h3>Puntos marcados por el usuario</h3>` + (d.marks.length ? `<ul>${d.marks.map(x => `<li>«${esc(x.text)}» <span class="m">(${esc(x.loc)}${x.note ? ' · nota: ' + esc(x.note) : ''})</span></li>`).join('')}</ul>` : '<p class="m">Ninguno marcado.</p>');
    if (m.auto) {
      h += `<h3>Valores y referencias detectados automáticamente <span class="m">(propuestos · pendientes de revisión)</span></h3>`;
      h += d.values.length ? `<table><tr><th>Categoría</th><th>Valor</th><th>Texto literal</th><th>Ubicación</th></tr>${d.values.map(v => `<tr><td>${esc(v.cat)}</td><td>${esc(v.value)}</td><td>${esc(v.ctx)}</td><td>${esc(v.loc)}</td></tr>`).join('')}</table>` : '<p class="m">No se detectaron valores técnicos.</p>';
      if (d.phrases.length) h += `<h3>Frases con carácter de requisito <span class="m">(extracto literal)</span></h3><ul>${d.phrases.map(p => `<li>${esc(p.ctx)} <span class="m">(${esc(p.loc)})</span></li>`).join('')}</ul>`;
    }
    return h;
  }).join('');
  const cmp = m.comparison.length ? `<h2>Cuadro comparativo de valores por categoría</h2><p class="nota"><b>${esc(m.compareNote.split(':')[0])}:</b>${esc(m.compareNote.split(':').slice(1).join(':'))}</p>` +
    m.comparison.map(c => `<h3>${esc(c.cat)}</h3><table><tr><th>Valor</th><th>Documento</th><th>Ubicación</th><th>Fecha</th></tr>${c.rows.map(v => `<tr><td>${esc(v.value)}</td><td>${v.n}. ${esc(v.doc)}</td><td>${esc(v.loc)}</td><td>${esc(v.date)}</td></tr>`).join('')}</table>`).join('') : '';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(m.title)}</title><style>${CSS}</style></head><body>
    <h1>${esc(m.title)}</h1><p class="m">Generado el ${m.when} · Alcance: ${esc(m.scope)} · ${m.count} documento(s)</p>
    <p class="nota"><b>Método:</b> ${esc(m.method)}</p><h2>Índice</h2><ol>${toc}</ol>${sections}${cmp}</body></html>`;
}
