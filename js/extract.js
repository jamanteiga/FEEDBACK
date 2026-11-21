// Extracción de TEXTO directa (sin convertir a PDF) de adjuntos y documentos: Word, Excel, PowerPoint,
// texto/CSV/HTML/RTF y ZIP. Devuelve páginas con una etiqueta de ubicación (hoja, diapositiva, pág. aprox., bloque).
import { docPages, xlsPages, pptPages } from './legacy.js';
import { cadPages } from './cad.js';
import { carveImages } from './carve.js';
export const OFFICE_EXT = ['docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt', 'docm', 'xlsm', 'pptm'];
const MACRO = { docm: 'docx', xlsm: 'xlsx', pptm: 'pptx' };   // mismo formato interno; las macros (vbaProject.bin) NUNCA se ejecutan ni se leen
export const CAD_EXT = ['dwg', 'dxf', 'dgn'];
export const TEXT_EXT = ['txt', 'csv', 'tsv', 'log', 'md', 'html', 'htm', 'rtf'];
export const ZIP_EXT = ['zip'];
export const DOC_EXT = [...OFFICE_EXT, ...TEXT_EXT, ...ZIP_EXT, ...CAD_EXT];
export const LEGACY_EXT = [];   // formato binario antiguo aún no legible: guardar como .pptx o PDF

// XML sin DOM (también funciona en un Web Worker): entidades y recorrido por expresiones regulares
const decXml = s => s.indexOf('&') < 0 ? s : s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" })[e.toLowerCase()]);
const attr = (a, n) => { const m = new RegExp(`(?:^|\\s)${n.replace(':', '\\:')}\\s*=\\s*"([^"]*)"`).exec(a); return m ? decXml(m[1]) : null; };
const dec = u8 => { try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch { return new TextDecoder('windows-1252').decode(u8); } };
const unzip = u8 => fflate.unzipSync(u8);
const MAX_UNZIP = 300 * 1024 * 1024;

const NAMED = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', ntilde: 'ñ', Ntilde: 'Ñ', uuml: 'ü', Uuml: 'Ü', deg: '°', plusmn: '±', ordm: 'º', ordf: 'ª', copy: '©', reg: '®', middot: '·', euro: '€', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', iexcl: '¡', iquest: '¿', agrave: 'à', egrave: 'è', ccedil: 'ç', micro: 'µ', sup2: '²', sup3: '³' };
export const htmlToText = h => {
  if (typeof DOMParser === 'undefined') {   // Web Worker: sin DOM
    return String(h).replace(/<(style|script|head)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<(br|\/p|\/div|\/tr|\/li|\/h\d)\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, '')
      .replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : (NAMED[e] ?? NAMED[e.toLowerCase()] ?? m))
      .replace(/[ \t\u00a0]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
  }
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
  const x = dec(f), explicit = (x.match(/<w:br\b[^>]*w:type="page"/g) || []).length, pages = [[]];
  let line = '';
  const flush = () => { if (line) pages.at(-1).push(line); line = ''; };
  for (const m of x.matchAll(/<(\/?)w:(p|t|tab|br|lastRenderedPageBreak)\b([^>]*?)(\/?)>([^<]*)/g)) {
    const [, close, n, a, , txt] = m;
    if (n === 'p') { if (close) flush(); }
    else if (n === 't') { if (!close) line += decXml(txt); }
    else if (n === 'tab') line += '\t';
    else if (n === 'br') { if (/w:type="page"/.test(a)) { flush(); pages.push([]); } else line += '\n'; }
    else if (n === 'lastRenderedPageBreak' && !explicit) { flush(); pages.push([]); }
  }
  flush();
  const res = pages.map(l => l.join('\n').trim()).filter(Boolean);
  return (res.length ? res : ['']).map((t, i, a) => ({ pageNo: i + 1, label: a.length > 1 ? `pág. ${i + 1} (aprox.)` : '', text: t }));
}
const tText = s => { let o = ''; for (const m of s.matchAll(/<t\b[^>]*?(?:\/>|>([^<]*)<\/t>)/g)) o += decXml(m[1] || ''); return o; };
function xlsx(files) {
  const ss = [];
  if (files['xl/sharedStrings.xml']) for (const m of dec(files['xl/sharedStrings.xml']).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) ss.push(tText(m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')));
  const rels = {};
  if (files['xl/_rels/workbook.xml.rels']) for (const m of dec(files['xl/_rels/workbook.xml.rels']).matchAll(/<Relationship\b([^>]*?)\/?>/g)) rels[attr(m[1], 'Id')] = attr(m[1], 'Target');
  const pages = []; let i = 0;
  for (const m of dec(files['xl/workbook.xml']).matchAll(/<sheet\b([^>]*?)\/?>/g)) {
    i++; const nm = attr(m[1], 'name'), t = rels[attr(m[1], 'r:id')] || `worksheets/sheet${i}.xml`, path = t.startsWith('/') ? t.slice(1) : 'xl/' + t;
    const data = files[path]; if (!data) continue;
    const rows = []; let nr = 0;
    for (const rm of dec(data).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      if (++nr > 20000) break;
      const cells = [];
      for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ty = attr(cm[1], 't'), body = cm[2] || '', v = /<v>([^<]*)<\/v>/.exec(body)?.[1];
        let val = ty === 's' ? ss[+v] : ty === 'inlineStr' ? tText(body) : ty === 'b' ? (v === '1' ? 'VERDADERO' : 'FALSO') : (v !== undefined ? decXml(v) : undefined);
        if (val !== undefined && val !== '') cells.push(val);
      }
      if (cells.length) rows.push(cells.join(' | '));
    }
    pages.push({ pageNo: pages.length + 1, label: `hoja «${nm}»`, text: rows.join('\n').slice(0, 400000) });
  }
  return pages.length ? pages : [{ pageNo: 1, label: '', text: '' }];
}
function pptx(files) {
  const names = Object.keys(files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/)));
  const pages = names.map((n, i) => ({ pageNo: i + 1, label: `diapositiva ${i + 1}`,
    text: [...dec(files[n]).matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)].map(p => [...p[1].matchAll(/<a:t\b[^>]*?(?:\/>|>([^<]*)<\/a:t>)/g)].map(t => decXml(t[1] || '')).join('')).filter(Boolean).join('\n') }));
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
export async function extractDocument(ext, buf) {
  ext = MACRO[ext] || ext;
  const u8 = new Uint8Array(buf);
  if (ext === 'doc') return docPages(u8);
  if (ext === 'xls') return xlsPages(u8);
  if (ext === 'ppt') return pptPages(u8);
  if (CAD_EXT.includes(ext)) return cadPages(ext, u8);
  if (ext === 'docx') return docx(unzip(u8));
  if (ext === 'xlsx') return xlsx(unzip(u8));
  if (ext === 'pptx') return pptx(unzip(u8));
  let t = dec(u8);
  if (ext === 'html' || ext === 'htm') t = htmlToText(t);
  else if (ext === 'rtf') t = rtf(t);
  return chunk(t);
}
export const FORMAT_NAME = { docm: 'Word con macros (solo texto; las macros no se ejecutan)', xlsm: 'Excel con macros (solo datos; las macros no se ejecutan)', pptm: 'PowerPoint con macros (solo texto)', docx: 'Word', doc: 'Word (.doc antiguo)', xlsx: 'Excel', xls: 'Excel (.xls antiguo)', ppt: 'PowerPoint (.ppt antiguo)', pptx: 'PowerPoint', dwg: 'plano DWG', dxf: 'plano DXF', dgn: 'plano DGN', txt: 'texto', csv: 'CSV', tsv: 'TSV', log: 'texto', md: 'texto', html: 'HTML', htm: 'HTML', rtf: 'RTF (aproximado)', zip: 'ZIP' };

// Imágenes incrustadas en Word/Excel/PowerPoint (capturas, fotos de planos…): se devuelven como «adjuntos» para que se les pase OCR.
export function embeddedImages(ext, buf) {
  ext = MACRO[ext] || ext;
  const mk = (list, tag) => list.slice(0, 40).map((f, i) => ({ name: `imagen-incrustada-${String(i + 1).padStart(2, '0')}${tag}-${f.name}`, mime: '', bytes: f.bytes, inline: f.bytes.byteLength < 8192 }));
  try {
    if (['docx', 'xlsx', 'pptx'].includes(ext)) {
      const z = zipEntries(buf), media = z.filter(f => /(^|\/)(word|ppt|xl)\/media\//i.test(f.path) && /\.(png|jpe?g|tiff?|bmp|gif|webp)$/i.test(f.name)), ole = [];
      for (const f of z.filter(f => /(^|\/)(word|ppt|xl)\/embeddings\//i.test(f.path) && /\.(bin|ole)$/i.test(f.name))) carveImages(f.bytes, 5).forEach((c, k) => ole.push({ name: `${f.name}-${k + 1}.${c.ext}`, bytes: c.bytes }));
      return [...mk(media, ''), ...mk(ole, '-ole')];
    }
    if (['doc', 'xls', 'ppt'].includes(ext)) return mk(carveImages(buf, 30).map((c, k) => ({ name: `${k + 1}.${c.ext}`, bytes: c.bytes })), '-bin');   // formatos antiguos: imágenes halladas por firma (aproximado)
  } catch { /* sin imágenes */ }
  return [];
}

// Punto de entrada común (hilo principal o Web Worker): páginas de texto + «adjuntos» (ZIP: sus archivos; Office: imágenes incrustadas para OCR).
export async function parseDocument(ext, buf) {
  if (ext === 'zip') {
    const ents = zipEntries(buf);
    return { pages: [{ pageNo: 1, label: '', text: 'Contenido del ZIP:\n' + ents.map(e => e.path).join('\n') }], atts: ents.map(e => ({ name: e.name, mime: '', bytes: e.bytes, inline: false })) };
  }
  const pages = await extractDocument(ext, buf);
  return { pages, atts: [...embeddedImages(ext, buf), ...(pages.carved || []).slice(0, 10).map((c, i) => ({ name: `imagen-incrustada-dwg-${i + 1}.${c.ext}`, mime: '', bytes: c.bytes, inline: false }))] };
}
