// Exportadores del informe: .docx (librería docx), .pdf (jsPDF + autoTable) y .xlsx (escritor propio sobre fflate).
import { headLine } from './report.js';
const clean = s => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
export function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }
export const reportName = ext => `informe-feedback-${stamp()}.${ext}`;

// ---------------- DOCX ----------------
export async function toDocx(m) {
  const D = globalThis.docx;
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle, Footer, Header, AlignmentType, PageNumber } = D;
  const runs = (t, o = {}) => clean(t).split('\n').map((l, i) => new TextRun({ text: l, break: i ? 1 : 0, size: o.size ?? 20, bold: o.bold, italics: o.italics, color: o.color }));
  const para = (t, o = {}) => new Paragraph({ children: runs(t, o), spacing: { after: o.after ?? 80 }, bullet: o.bullet ? { level: 0 } : undefined, heading: o.heading });
  const line = { style: BorderStyle.SINGLE, size: 4, color: 'B8C0CC' };
  const borders = { top: line, bottom: line, left: line, right: line, insideHorizontal: line, insideVertical: line };
  const cell = (t, w, head) => new TableCell({ width: { size: w, type: WidthType.PERCENTAGE }, shading: head ? { type: ShadingType.CLEAR, fill: 'E8EEF8', color: 'auto' } : undefined,
    margins: { top: 40, bottom: 40, left: 80, right: 80 }, children: [new Paragraph({ children: runs(t, { size: 18, bold: head }) })] });
  const table = (head, rows, widths) => new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders,
    rows: [...(head ? [new TableRow({ tableHeader: true, children: head.map((h, i) => cell(h, widths[i], true)) })] : []), ...rows.map(r => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, widths[i], false)) }))] });
  const H = (t, level) => new Paragraph({ heading: level, children: [new TextRun({ text: clean(t), bold: true })], spacing: { before: 240, after: 100 } });
  const gap = () => new Paragraph({ children: [], spacing: { after: 120 } });

  const logo = m.header?.logo ? Uint8Array.from(atob(m.header.logo.split(',')[1]), ch => ch.charCodeAt(0)) : null;
  const c = [...(logo ? [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new D.ImageRun({ type: 'png', data: logo, transformation: { width: m.header.lw || 150, height: m.header.lh || 50 } })] })] : []),
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: clean(m.title), bold: true })] }),
    para(headLine(m.header), { size: 19, bold: true }),
    para(`Generado el ${m.when} · Alcance: ${m.scope} · ${m.count} documento(s)`, { color: '555555', size: 18 }),
    para('Método: ' + m.method, { size: 18, italics: true }), H('Índice', HeadingLevel.HEADING_2),
    ...m.docs.map(d => para(`${d.n}. ${d.title}`, { size: 19, after: 40 }))];
  for (const d of m.docs) {
    c.push(H(`${d.n}. ${d.name}`, HeadingLevel.HEADING_2), table(null, d.rows, [22, 78]), gap());
    c.push(H('Puntos marcados por el usuario', HeadingLevel.HEADING_3));
    if (d.marks.length) d.marks.forEach(x => c.push(para(`«${x.text}» (${x.loc}${x.note ? ' · nota: ' + x.note : ''})`, { bullet: true, size: 19 })));
    else c.push(para('Ninguno marcado.', { color: '777777', size: 18 }));
    if (m.auto) {
      c.push(H('Valores y referencias detectados automáticamente (propuestos · pendientes de revisión)', HeadingLevel.HEADING_3));
      if (d.values.length) c.push(table(['Categoría', 'Valor', 'Texto literal', 'Ubicación'], d.values.map(v => [v.cat, v.value, v.ctx, v.loc]), [18, 14, 53, 15]), gap());
      else c.push(para('No se detectaron valores técnicos.', { color: '777777', size: 18 }));
      if (d.phrases.length) { c.push(H('Frases con carácter de requisito (extracto literal)', HeadingLevel.HEADING_3)); d.phrases.forEach(p => c.push(para(`${p.ctx} (${p.loc})`, { bullet: true, size: 19 }))); }
    }
  }
  if (m.reqs?.length) c.push(H('Requisitos y su estado', HeadingLevel.HEADING_2), table(['#', 'Requisito (literal)', 'Origen', 'Estado', 'Concepto / nota'], m.reqs.map(q => [String(q.id), q.text, `${q.doc} · ${q.loc}`, q.status, [q.group, q.note].filter(Boolean).join(' · ')]), [5, 42, 22, 11, 20]), gap());
  if (m.comparison.length) {
    c.push(H('Cuadro comparativo de valores por categoría', HeadingLevel.HEADING_2), para(m.compareNote, { size: 18, italics: true }));
    for (const g of m.comparison) c.push(H(g.cat, HeadingLevel.HEADING_3), table(['Valor', 'Documento', 'Ubicación', 'Fecha'], g.rows.map(v => [v.value, `${v.n}. ${v.doc}`, v.loc, v.date]), [20, 50, 18, 12]), gap());
  }
  const doc = new Document({ creator: 'FEEDBACK', title: m.title, sections: [{
    properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } },
    headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: m.header?.cl ? [new TextRun({ text: clean(m.header.cl), bold: true, size: 18, color: 'B42318' })] : [] })] }) },
    footers: { default: new Footer({ children: [...(m.header?.cl ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: clean(m.header.cl), bold: true, size: 18, color: 'B42318' })] })] : []), new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: ['Página ', PageNumber.CURRENT, ' de ', PageNumber.TOTAL_PAGES], size: 16, color: '777777' })] })] }) },
    children: c }] });
  const blob = await Packer.toBlob(doc);
  return m.header?.wm ? addDocxWatermark(blob, clean(m.header.wm)) : blob;
}

// Marca de agua de Word (texto VML en la cabecera, como la que inserta Word en Diseño > Marca de agua)
async function addDocxWatermark(blob, text) {
  const files = fflate.unzipSync(new Uint8Array(await blob.arrayBuffer())), name = Object.keys(files).find(n => /^word\/header\d*\.xml$/.test(n));
  if (!name) return blob;
  let x = fflate.strFromU8(files[name]); const ns = { 'xmlns:v': 'urn:schemas-microsoft-com:vml', 'xmlns:o': 'urn:schemas-microsoft-com:office:office', 'xmlns:w10': 'urn:schemas-microsoft-com:office:word' };
  x = x.replace(/<w:hdr\b([^>]*)>/, (m, a) => `<w:hdr${a}${Object.entries(ns).filter(([k]) => !a.includes(k + '=')).map(([k, v]) => ` ${k}="${v}"`).join('')}>`);
  const t = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'), w = Math.min(520, Math.max(260, t.length * 40)), h = Math.round(w / Math.max(4, t.length) * 1.6);
  const pict = `<w:r><w:rPr><w:noProof/></w:rPr><w:pict><v:shapetype id="_x0000_t136" coordsize="21600,21600" o:spt="136" adj="10800" path="m@7,l@8,m@5,21600l@6,21600e"><v:formulas><v:f eqn="sum #0 0 10800"/><v:f eqn="prod #0 2 1"/><v:f eqn="sum 21600 0 @1"/><v:f eqn="sum 0 0 @2"/><v:f eqn="sum 21600 0 @3"/><v:f eqn="if @0 @3 0"/><v:f eqn="if @0 21600 @1"/><v:f eqn="if @0 0 @2"/><v:f eqn="if @0 @4 21600"/><v:f eqn="mid @5 @6"/><v:f eqn="mid @8 @5"/><v:f eqn="mid @7 @8"/><v:f eqn="mid @6 @7"/><v:f eqn="sum @6 0 @5"/></v:formulas><v:path textpathok="t" o:connecttype="custom" o:connectlocs="@9,0;@10,10800;@11,21600;@12,10800" o:connectangles="270,180,90,0"/><v:textpath on="t" fitshape="t"/><v:handles><v:h position="#0,bottomRight" xrange="6629,14971"/></v:handles><o:lock v:ext="edit" text="t" shapetype="t"/></v:shapetype><v:shape id="PowerPlusWaterMarkObject1" o:spid="_x0000_s2049" type="#_x0000_t136" style="position:absolute;margin-left:0;margin-top:0;width:${w}pt;height:${h}pt;rotation:315;z-index:-251658752;mso-position-horizontal:center;mso-position-horizontal-relative:margin;mso-position-vertical:center;mso-position-vertical-relative:margin" o:allowincell="f" fillcolor="silver" stroked="f"><v:fill opacity=".5"/><v:textpath style="font-family:&quot;Calibri&quot;;font-size:1pt" string="${t}"/><w10:wrap anchorx="margin" anchory="margin"/></v:shape></w:pict></w:r>`;
  x = x.includes('</w:p>') ? x.replace('</w:p>', pict + '</w:p>') : x.replace(/<w:p\/>/, '<w:p>' + pict + '</w:p>');   // al final del primer párrafo de la cabecera
  files[name] = fflate.strToU8(x);
  return new Blob([fflate.zipSync(files)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

// ---------------- PDF ----------------
const WIN = new Set([...'€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'].map(ch => ch.charCodeAt(0)));
const latin = s => Array.from(clean(s)).map(ch => { const c = ch.charCodeAt(0); return c < 256 || WIN.has(c) ? ch : (ch === '★' ? '*' : ch === '⚠' ? '!' : ch === '→' ? '->' : ch === '≥' ? '>=' : ch === '≤' ? '<=' : '?'); }).join('');
export function toPdf(m) {
  const { jsPDF } = globalThis.jspdf, doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth(), Hh = doc.internal.pageSize.getHeight(), M = 40, TW = W - 2 * M;
  let y = M;
  const need = h => { if (y + h > Hh - 50) { doc.addPage(); y = M; } };
  const text = (t, size = 9.5, o = {}) => {
    doc.setFont('helvetica', o.bold ? 'bold' : o.italic ? 'italic' : 'normal'); doc.setFontSize(size); doc.setTextColor(...(o.color || [20, 20, 20]));
    const lines = doc.splitTextToSize(latin(t), TW - (o.indent || 0)); const lh = size * 1.3;
    for (const l of lines) { need(lh); doc.text(l, M + (o.indent || 0), y + size); y += lh; }
    y += o.after ?? 3;
  };
  const head = (t, size) => { need(size * 2.5); y += 6; text(t, size, { bold: true, color: [31, 63, 122], after: 4 }); };
  const tbl = (headRow, rows, widths, fs = 8.5) => {
    need(40);
    doc.autoTable({ startY: y, margin: { left: M, right: M, bottom: 50 }, head: headRow ? [headRow.map(latin)] : undefined, body: rows.map(r => r.map(latin)),
      styles: { fontSize: fs, cellPadding: 3, lineColor: [184, 192, 204], lineWidth: 0.5, overflow: 'linebreak', valign: 'top', textColor: [20, 20, 20] },
      headStyles: { fillColor: [232, 238, 248], textColor: [20, 20, 20], fontStyle: 'bold' },
      columnStyles: Object.fromEntries(widths.map((w, i) => [i, { cellWidth: TW * w / 100 }])), tableWidth: TW });
    y = doc.lastAutoTable.finalY + 8;
  };
  if (m.header?.logo) { try { { const k = 40 / (m.header.lh || 50), w = (m.header.lw || 150) * k; doc.addImage(m.header.logo, 'PNG', W - M - w, M - 10, w, 40); } } catch { /* sin logotipo */ } }
  text(m.title, 18, { bold: true, after: 4 });
  if (headLine(m.header)) text(headLine(m.header), 9.5, { bold: true, after: 4 });
  text(`Generado el ${m.when} · Alcance: ${m.scope} · ${m.count} documento(s)`, 9, { color: [90, 90, 90], after: 6 });
  text('Metodo: ' + m.method.replace(/^/, ''), 8.5, { italic: true, after: 8 });
  head('Indice', 13); m.docs.forEach(d => text(`${d.n}. ${d.title}`, 9, { after: 1 }));
  for (const d of m.docs) {
    doc.addPage(); y = M; head(`${d.n}. ${d.name}`, 13);
    tbl(null, d.rows, [24, 76]);
    head('Puntos marcados por el usuario', 10.5);
    if (d.marks.length) d.marks.forEach(x => text(`- «${x.text}» (${x.loc}${x.note ? ' - nota: ' + x.note : ''})`, 9, { indent: 6 })); else text('Ninguno marcado.', 9, { color: [120, 120, 120] });
    if (m.auto) {
      head('Valores y referencias detectados automaticamente (propuestos - pendientes de revision)', 10.5);
      if (d.values.length) tbl(['Categoria', 'Valor', 'Texto literal', 'Ubicacion'], d.values.map(v => [v.cat, v.value, v.ctx, v.loc]), [18, 14, 53, 15], 8); else text('No se detectaron valores tecnicos.', 9, { color: [120, 120, 120] });
      if (d.phrases.length) { head('Frases con caracter de requisito (extracto literal)', 10.5); d.phrases.forEach(p => text(`- ${p.ctx} (${p.loc})`, 9, { indent: 6 })); }
    }
  }
  if (m.reqs?.length) { doc.addPage(); y = M; head('Requisitos y su estado', 13); tbl(['#', 'Requisito (literal)', 'Origen', 'Estado', 'Concepto / nota'], m.reqs.map(q => [String(q.id), q.text, `${q.doc} - ${q.loc}`, q.status, [q.group, q.note].filter(Boolean).join(' - ')]), [5, 42, 22, 11, 20]); }
  if (m.comparison.length) {
    doc.addPage(); y = M; head('Cuadro comparativo de valores por categoria', 13); text(m.compareNote, 8.5, { italic: true, after: 6 });
    for (const g of m.comparison) { head(g.cat, 10.5); tbl(['Valor', 'Documento', 'Ubicacion', 'Fecha'], g.rows.map(v => [v.value, `${v.n}. ${v.doc}`, v.loc, v.date]), [20, 50, 18, 12]); }
  }
  const n = doc.getNumberOfPages(), wm = latin(m.header?.wm || ''), cl = latin(m.header?.cl || '');
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    if (wm) { try { doc.saveGraphicsState(); doc.setGState(new doc.GState({ opacity: 0.13 })); doc.setFont('helvetica', 'bold'); doc.setFontSize(wm.length > 14 ? 52 : 80); doc.setTextColor(90, 90, 90); doc.text(wm, W / 2, Hh / 2, { align: 'center', angle: 35, baseline: 'middle' }); doc.restoreGraphicsState(); } catch { /* sin marca de agua */ } }
    if (cl) { doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(180, 35, 24); doc.text(cl, W / 2, 20, { align: 'center' }); doc.text(cl, W / 2, Hh - 12, { align: 'center' }); }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(120, 120, 120); doc.text(`FEEDBACK · Pagina ${i} de ${n}`, W / 2, Hh - 28, { align: 'center' });
  }
  return doc.output('blob');
}

// ---------------- XLSX ----------------
const xe = s => clean(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = i => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; };
function sheetXml(rows, widths, cl = '') {
  const body = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => `<c r="${colName(ci)}${ri + 1}" t="inlineStr" s="${ri === 0 ? 1 : 0}"><is><t xml:space="preserve">${xe(v)}</t></is></c>`).join('')}</row>`).join('');
  const last = `${colName(Math.max(0, (rows[0] || ['']).length - 1))}${Math.max(1, rows.length)}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${body}</sheetData><autoFilter ref="A1:${last}"/><pageMargins left="0.5" right="0.5" top="0.8" bottom="0.8" header="0.3" footer="0.3"/><pageSetup orientation="landscape" fitToHeight="0"/><headerFooter><oddHeader>${cl ? '&amp;C&amp;B&amp;K00B42318' + xe(cl).replace(/&amp;/g, '&amp;&amp;') : ''}</oddHeader><oddFooter>${cl ? '&amp;L&amp;B&amp;K00B42318' + xe(cl).replace(/&amp;/g, '&amp;&amp;') : ''}&amp;RPágina &amp;P de &amp;N</oddFooter></headerFooter></worksheet>`;
}
export function toXlsx(m) {
  const lab = (d, k) => (d.rows.find(r => r[0] === k) || [])[1] || '';
  const sheets = [];
  sheets.push({ name: 'Resumen', widths: [5, 34, 30, 26, 18, 36, 34, 8, 14, 22, 30, 28],
    rows: [['#', 'Archivo', 'Título', 'Tipo / origen', 'Fecha', 'Asunto', 'De → Para', 'Partes', 'OCR', 'Etiquetas', 'Nota', 'Texto corregido'],
      ...m.docs.map(d => [d.n, d.name, lab(d, 'Título'), lab(d, 'Tipo / origen'), lab(d, 'Fecha del correo') || lab(d, 'Fecha del archivo'), lab(d, 'Asunto'), lab(d, 'De → Para'), lab(d, 'Partes / identificación').split(' ')[0],
        lab(d, 'Calidad de OCR'), lab(d, 'Etiquetas'), lab(d, 'Nota'), lab(d, 'Texto corregido manualmente')])] });
  const marks = m.docs.flatMap(d => d.marks.map(x => [d.n, d.name, x.loc, x.text, x.note]));
  if (marks.length) sheets.push({ name: 'Puntos marcados', widths: [5, 34, 18, 90, 30], rows: [['#', 'Documento', 'Ubicación', 'Texto marcado (literal)', 'Nota'], ...marks] });
  if (m.auto) {
    const vals = m.docs.flatMap(d => d.values.map(v => [d.n, d.name, v.cat, v.value, v.ctx, v.loc]));
    if (vals.length) sheets.push({ name: 'Valores detectados', widths: [5, 32, 24, 16, 80, 16], rows: [['#', 'Documento', 'Categoría', 'Valor', 'Texto literal (propuesto, a revisar)', 'Ubicación'], ...vals] });
    const fr = m.docs.flatMap(d => d.phrases.map(p => [d.n, d.name, p.loc, p.ctx]));
    if (fr.length) sheets.push({ name: 'Frases requisito', widths: [5, 32, 16, 100], rows: [['#', 'Documento', 'Ubicación', 'Texto literal'], ...fr] });
  }
  if (m.reqs?.length) sheets.push({ name: 'Requisitos', widths: [6, 70, 34, 14, 26, 28], rows: [['#', 'Requisito (literal)', 'Documento · ubicación', 'Estado', 'Concepto', 'Nota'], ...m.reqs.map(q => [q.id, q.text, `${q.doc} · ${q.loc}`, q.status, q.group, q.note])] });
  if (m.comparison.length) sheets.push({ name: 'Comparativo', widths: [26, 16, 40, 16, 12], rows: [['Categoría', 'Valor', 'Documento', 'Ubicación', 'Fecha'], ...m.comparison.flatMap(g => g.rows.map(v => [g.cat, v.value, `${v.n}. ${v.doc}`, v.loc, v.date]))] });
  sheets.push({ name: 'Método', widths: [120], rows: [['Método y advertencias'], [headLine(m.header)], [m.method], [`Generado el ${m.when} · Alcance: ${m.scope} · ${m.count} documento(s)`], ...(m.comparison.length ? [[m.compareNote]] : [])] });

  return packXlsx(sheets, m.header?.cl || '');
}
export function packXlsx(sheets, cl = '') {
  const E = s => fflate.strToU8(s), files = {
    '[Content_Types].xml': E(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`),
    '_rels/.rels': E(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': E(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xe(s.name.replace(/[\[\]:*?\/\\]/g, ' ').slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': E(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': E(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="10"/><name val="Calibri"/></font><font><b/><sz val="10"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF8"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`),
  };
  sheets.forEach((s, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = E(sheetXml(s.rows, s.widths, cl)); });
  return new Blob([fflate.zipSync(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
