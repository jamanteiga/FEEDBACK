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
  const values = [], phrases = [], seen = new Set();
  const push = (arr, o, k) => { const key = k + '|' + o.page; if (!seen.has(key)) { seen.add(key); arr.push(o); } };
  for (const p of pages) {
    for (const s of sentences(p.text || '')) {
      for (const [cat, re] of VALUE_PATS) { re.lastIndex = 0; let m; while ((m = re.exec(s))) push(values, { cat, value: m[0].trim(), ctx: clip(s), page: p.pageNo }, cat + m[0] + s); }
      NORM.lastIndex = 0; let n; while ((n = NORM.exec(s))) push(values, { cat: 'Normativa y referencias', value: n[0].trim(), ctx: clip(s), page: p.pageNo }, 'N' + n[0] + s);
      for (const [cat, re] of KEY_PATS) if (re.test(s)) push(values, { cat, value: '—', ctx: clip(s), page: p.pageNo }, cat + s);
      if (REQ.test(s)) push(phrases, { ctx: clip(s), page: p.pageNo }, 'P' + s);
    }
  }
  return { values, phrases };
}

const CSS = `body{font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#111;margin:24px}h1{font-size:20pt;margin:0 0 4pt}h2{font-size:14pt;border-bottom:1.5pt solid #1f5fbf;padding-bottom:2pt;margin-top:22pt;color:#1f3f7a}
h3{font-size:11.5pt;margin:12pt 0 3pt}table{border-collapse:collapse;width:100%;margin:4pt 0 8pt}td,th{border:.75pt solid #b8c0cc;padding:3pt 5pt;font-size:10pt;vertical-align:top;text-align:left}th{background:#e8eef8}
.nota{background:#fff8e6;border:.75pt solid #e6c675;padding:6pt 8pt;font-size:10pt}.m{color:#555;font-size:9.5pt}.warn{color:#9a4a00}ul{margin:2pt 0 6pt 16pt;padding:0}li{margin:2pt 0}@media print{h2{page-break-after:avoid}}`;

// docs: [{doc, pages, marks, parent}] en orden de presentación
export function buildReport({ items, opts, scope, now = new Date(), rootName }) {
  const when = now.toISOString().replace('T', ' ').slice(0, 16);
  const toc = items.map((it, i) => `<li><a href="#d${i + 1}">${esc(it.doc.subject && it.doc.kind === 'correo' ? it.doc.subject + ' (' + it.doc.name + ')' : it.doc.name)}</a></li>`).join('');
  const all = [];
  const sections = items.map((it, i) => {
    const { doc: d, pages, marks, parent } = it, an = opts.auto ? analyze(pages) : { values: [], phrases: [] };
    const confs = pages.filter(p => p.conf != null).map(p => p.conf), avg = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null;
    const low = pages.filter(p => p.conf != null && p.conf < 60).map(p => p.pageNo);
    const place = d.path ? [rootName(d.rootId), ...d.path].filter(Boolean).join(' / ') : (d.source === 'adjunto' ? 'adjunto de correo' : 'importado manualmente');
    let h = `<h2 id="d${i + 1}">${i + 1}. ${esc(d.name)}</h2><table>
      <tr><th style="width:22%">Tipo / origen</th><td>${esc(d.kind)} · ${esc(place)}</td></tr>
      ${d.kind === 'correo' ? `<tr><th>Asunto</th><td>${esc(d.subject)}</td></tr><tr><th>De / Para</th><td>${esc(d.sender)} → ${esc(d.to)}</td></tr><tr><th>Fecha del correo</th><td>${esc((d.emailDate || '').replace('T', ' ').slice(0, 16))}</td></tr>`
        : `<tr><th>Fecha del archivo</th><td>${esc((d.fileDate || '').replace('T', ' ').slice(0, 16))}</td></tr>`}
      ${parent ? `<tr><th>Adjunto del correo</th><td>${esc(parent.subject)} (${esc(parent.sender)}, ${esc((parent.emailDate || '').slice(0, 10))})</td></tr>` : ''}
      <tr><th>Páginas / identificación</th><td>${d.pages} · SHA-256 ${esc(d.sha256.slice(0, 16))}…</td></tr>
      ${avg != null ? `<tr><th>Calidad de OCR</th><td>${Math.round(avg)} % de confianza media${low.length ? ` <span class="warn">· ⚠ baja confianza en pág. ${low.join(', ')}: verificar contra el original</span>` : ''}</td></tr>` : ''}</table>`;
    h += `<h3>Puntos marcados por el usuario</h3>` + (marks.length
      ? `<ul>${marks.map(m => `<li>«${esc(m.text)}» <span class="m">(pág. ${m.pageNo}${m.note ? ' · nota: ' + esc(m.note) : ''})</span></li>`).join('')}</ul>` : '<p class="m">Ninguno marcado.</p>');
    if (opts.auto) {
      const byCat = {}; for (const v of an.values) (byCat[v.cat] ||= []).push(v);
      const cats = Object.keys(byCat);
      h += `<h3>Valores y referencias detectados automáticamente <span class="m">(propuestos · pendientes de revisión)</span></h3>`;
      h += cats.length ? `<table><tr><th>Categoría</th><th>Valor</th><th>Texto literal</th><th>Pág.</th></tr>${cats.map(c => byCat[c].slice(0, 25).map(v => `<tr><td>${esc(c)}</td><td>${esc(v.value)}</td><td>${esc(v.ctx)}</td><td>${v.page}</td></tr>`).join('')).join('')}</table>` : '<p class="m">No se detectaron valores técnicos.</p>';
      if (an.phrases.length) h += `<h3>Frases con carácter de requisito <span class="m">(extracto literal)</span></h3><ul>${an.phrases.slice(0, 12).map(p => `<li>${esc(p.ctx)} <span class="m">(pág. ${p.page})</span></li>`).join('')}</ul>`;
      for (const v of an.values) if (['Velocidades', 'Caudales', 'Presiones', 'Temperaturas', 'Requisitos acústicos', 'Normativa y referencias'].includes(v.cat))
        all.push({ ...v, doc: d, date: (d.emailDate || d.fileDate || '').slice(0, 10), n: i + 1 });
    }
    return h;
  }).join('');

  let cmp = '';
  if (opts.auto && opts.compare && all.length) {
    const cats = [...new Set(all.map(v => v.cat))];
    cmp = `<h2>Cuadro comparativo de valores por categoría</h2><p class="nota">Se muestran juntos los valores detectados en distintos documentos, con su fuente y fecha. <b>No se determina cuál prevalece</b>: la jerarquía documental la define el criterio del ingeniero y las reglas del proyecto.</p>` +
      cats.map(c => `<h3>${esc(c)}</h3><table><tr><th>Valor</th><th>Documento</th><th>Pág.</th><th>Fecha</th></tr>${all.filter(v => v.cat === c).sort((a, b) => a.value.localeCompare(b.value, 'es', { numeric: true })).map(v => `<tr><td>${esc(v.value)}</td><td>${v.n}. ${esc(v.doc.name)}</td><td>${v.page}</td><td>${esc(v.date)}</td></tr>`).join('')}</table>`).join('');
  }
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Informe resumen FEEDBACK</title><style>${CSS}</style></head><body>
    <h1>Informe resumen de documentación</h1><p class="m">Generado el ${when} · Alcance: ${esc(scope)} · ${items.length} documento(s)</p>
    <p class="nota"><b>Método:</b> informe generado por extracción literal de texto (sin inteligencia artificial). Los valores detectados automáticamente son <b>propuestas pendientes de revisión humana</b>, con su texto literal y página de origen; pueden contener errores de OCR o ambigüedades. Los puntos marcados los ha seleccionado el usuario. Este informe no sustituye al documento original ni resuelve contradicciones entre documentos.</p>
    <h2>Índice</h2><ol>${toc}</ol>${sections}${cmp}</body></html>`;
}
