// Extracción de TEXTO directa (sin convertir a PDF) de adjuntos y documentos: Word, Excel, PowerPoint,
// texto/CSV/HTML/RTF y ZIP. Devuelve páginas con una etiqueta de ubicación (hoja, diapositiva, pág. aprox., bloque).
export const OFFICE_EXT = ['docx', 'xlsx', 'pptx'];
export const TEXT_EXT = ['txt', 'csv', 'tsv', 'log', 'md', 'html', 'htm', 'rtf'];
export const ZIP_EXT = ['zip'];
export const DOC_EXT = [...OFFICE_EXT, ...TEXT_EXT, ...ZIP_EXT];
export const LEGACY_EXT = ['doc', 'xls', 'ppt'];   // formatos binarios antiguos: no indexables en el navegador

const parseXml = s => new DOMParser().parseFromString(s, 'application/xml');
const dec = u8 => { try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch { return new TextDecoder('windows-1252').decode(u8); } };
const unzip = u8 => fflate.unzipSync(u8);
const MAX_UNZIP = 300 * 1024 * 1024;

export const htmlToText = h => {
  const d = new DOMParser().parseFromString(String(h).replace(/<(br|\/p|\/div|\/tr|\/li|\/h\d)\b[^>]*>/gi, '\n'), 'text/html');
  d.querySelectorAll('style,script,head').forEach(n => n.remove());
  return d.body.textContent.replace(/[ \t ]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
};
const chunk = (text, label = n => `bloque ${n}`, size = 3500) => {
  const out = []; let cur = '';
  for (const line of text.split(/\r?\n/)) { if (cur.length + line.length > size && cur) { out.push(cur); cur = ''; } cur += line + '\n'; }
  if (cur.trim() || !out.length) out.push(cur);
  return out.map((t, i) => ({ pageNo: i + 1, label: out.length > 1 ? label(i + 1) : '', text: t.trim() }));
};

function docx(files) {
  const f = files['word/document.xml']; if (!f) throw new Error('DOCX sin document.xml');
  const x = parseXml(dec(f)), paras = [...x.getElementsByTagName('w:p')];
  const explicit = [...x.getElementsByTagName('w:br')].filter(b => b.getAttribute('w:type') === 'page').length;
  const pages = [[]];
  for (const p of paras) {
    let line = '';
    for (const el of p.getElementsByTagName('*')) {
      const n = el.nodeName;
      if (n === 'w:t') line += el.textContent;
      else if (n === 'w:tab') line += '\t';
      else if (n === 'w:br') { if (el.getAttribute('w:type') === 'page') { if (line) pages.at(-1).push(line); line = ''; pages.push([]); } else line += '\n'; }
      else if (n === 'w:lastRenderedPageBreak' && !explicit) { if (line) pages.at(-1).push(line); line = ''; pages.push([]); }
    }
    if (line) pages.at(-1).push(line);
  }
  const res = pages.map(l => l.join('\n').trim()).filter(Boolean);
  return (res.length ? res : ['']).map((t, i, a) => ({ pageNo: i + 1, label: a.length > 1 ? `pág. ${i + 1} (aprox.)` : '', text: t }));
}
function xlsx(files) {
  const ss = [];
  if (files['xl/sharedStrings.xml']) for (const si of parseXml(dec(files['xl/sharedStrings.xml'])).getElementsByTagName('si')) ss.push([...si.getElementsByTagName('t')].map(t => t.textContent).join(''));
  const wb = parseXml(dec(files['xl/workbook.xml'])), rels = {};
  if (files['xl/_rels/workbook.xml.rels']) for (const r of parseXml(dec(files['xl/_rels/workbook.xml.rels'])).getElementsByTagName('Relationship')) rels[r.getAttribute('Id')] = r.getAttribute('Target');
  const pages = []; let i = 0;
  for (const sh of wb.getElementsByTagName('sheet')) {
    i++; const t = rels[sh.getAttribute('r:id')] || `worksheets/sheet${i}.xml`, path = t.startsWith('/') ? t.slice(1) : 'xl/' + t;
    const data = files[path]; if (!data) continue;
    const rows = [];
    for (const row of [...parseXml(dec(data)).getElementsByTagName('row')].slice(0, 20000)) {
      const cells = [];
      for (const c of row.getElementsByTagName('c')) {
        const ty = c.getAttribute('t'), v = c.getElementsByTagName('v')[0]?.textContent;
        let val = ty === 's' ? ss[+v] : ty === 'inlineStr' ? [...c.getElementsByTagName('t')].map(x => x.textContent).join('') : ty === 'b' ? (v === '1' ? 'VERDADERO' : 'FALSO') : v;
        if (val !== undefined && val !== '') cells.push(val);
      }
      if (cells.length) rows.push(cells.join(' | '));
    }
    pages.push({ pageNo: pages.length + 1, label: `hoja «${sh.getAttribute('name')}»`, text: rows.join('\n').slice(0, 400000) });
  }
  return pages.length ? pages : [{ pageNo: 1, label: '', text: '' }];
}
function pptx(files) {
  const names = Object.keys(files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/)));
  const pages = names.map((n, i) => ({ pageNo: i + 1, label: `diapositiva ${i + 1}`,
    text: [...parseXml(dec(files[n])).getElementsByTagName('a:p')].map(p => [...p.getElementsByTagName('a:t')].map(t => t.textContent).join('')).filter(Boolean).join('\n') }));
  return pages.length ? pages : [{ pageNo: 1, label: '', text: '' }];
}
function rtf(s) {
  return s.replace(/\\'([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\par[d]?/g, '\n').replace(/\{\\\*[^{}]*\}/g, '')
    .replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[{}]/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

// ZIP: devuelve las entradas (un nivel) para tratarlas como adjuntos.
export function zipEntries(buf) {
  const files = unzip(new Uint8Array(buf)); let total = 0; const out = [];
  for (const [name, bytes] of Object.entries(files)) {
    if (name.endsWith('/') || /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)/i.test(name)) continue;
    total += bytes.byteLength; if (total > MAX_UNZIP) throw new Error('ZIP demasiado grande (>300 MB descomprimido)');
    out.push({ name: name.split('/').pop(), path: name, bytes });
  }
  return out;
}

// Devuelve [{pageNo,label,text}] para Word/Excel/PowerPoint/texto. (ZIP se gestiona aparte con zipEntries.)
export function extractDocument(ext, buf) {
  const u8 = new Uint8Array(buf);
  if (ext === 'docx') return docx(unzip(u8));
  if (ext === 'xlsx') return xlsx(unzip(u8));
  if (ext === 'pptx') return pptx(unzip(u8));
  let t = dec(u8);
  if (ext === 'html' || ext === 'htm') t = htmlToText(t);
  else if (ext === 'rtf') t = rtf(t);
  return chunk(t);
}
export const FORMAT_NAME = { docx: 'Word', xlsx: 'Excel', pptx: 'PowerPoint', txt: 'texto', csv: 'CSV', tsv: 'TSV', log: 'texto', md: 'texto', html: 'HTML', htm: 'HTML', rtf: 'RTF (aproximado)', zip: 'ZIP' };
