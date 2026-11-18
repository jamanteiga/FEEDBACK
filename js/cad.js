// Lectura de TEXTO de planos CAD sin convertirlos: DXF (texto y binario), DWG (R13–2018+, con LibreDWG compilado a WebAssembly)
// y DGN (V7 directo; V8 de forma aproximada). Solo se extrae lo escrito en el plano (textos, cotas con texto, atributos de bloques
// como el cajetín, capas y nombres de bloque). No se interpreta ni se "dibuja" nada: el original se abre con su programa.
const VER = { AC1006: 'R10', AC1009: 'R11/R12', AC1012: 'R13', AC1014: 'R14', AC1015: 'AutoCAD 2000', AC1018: 'AutoCAD 2004', AC1021: 'AutoCAD 2007', AC1024: 'AutoCAD 2010', AC1027: 'AutoCAD 2013', AC1032: 'AutoCAD 2018' };
const LINES_PER_PAGE = 2500;
const u8dec = (u8, enc) => new TextDecoder(enc).decode(u8);
const decode = u8 => { try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch { return new TextDecoder('windows-1252').decode(u8); } };

// Códigos de formato de MTEXT y códigos %% de TEXT → texto plano
export function cadText(s, multi = false) {
  if (s == null) return '';
  s = String(s);
  if (multi) {
    s = s.replace(/\\\\/g, '\u0001').replace(/\\[{}]/g, m => (m === '\\{' ? '\u0002' : '\u0003'))
      .replace(/\\[fFHhWwQqCcTtAap][^;]*;/g, '').replace(/\\S([^;]*);/g, (_, x) => x.replace(/[\^#]/g, '/'))
      .replace(/\\[LlOoKk]/g, '').replace(/\\P/gi, '\n').replace(/\\~/g, ' ').replace(/[{}]/g, '')
      .replace(/\u0001/g, '\\').replace(/\u0002/g, '{').replace(/\u0003/g, '}');
  }
  return s.replace(/\\U\+([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/%%d/gi, '°').replace(/%%p/gi, '±').replace(/%%c/gi, 'Ø')
    .replace(/%%[uo]/gi, '').replace(/%%(\d{3})/g, (_, n) => String.fromCharCode(+n)).replace(/[ \t]+\n/g, '\n').trim();
}
const paginate = (lines, label) => {
  const out = [];
  for (let i = 0; i < lines.length; i += LINES_PER_PAGE) out.push({ label: lines.length > LINES_PER_PAGE ? `${label} (${Math.floor(i / LINES_PER_PAGE) + 1})` : label, text: lines.slice(i, i + LINES_PER_PAGE).join('\n') });
  return out;
};
const finish = pages => { const r = pages.filter(p => p.text && p.text.trim()).map((p, i) => ({ pageNo: i + 1, label: p.label, text: p.text })); return r.length ? r : [{ pageNo: 1, label: '', text: '' }]; };
const infoPage = (ver, layers, blocks, counts, extra = '') => {
  const n = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${k} ${v}`).join(' · ');
  return { label: 'información del plano', text: [ver ? `Versión del archivo: ${VER[ver] || ver}${VER[ver] ? ' (' + ver + ')' : ''}` : '', layers.length ? 'Capas: ' + layers.join(', ') : '', blocks.length ? 'Bloques: ' + blocks.join(', ') : '', n ? 'Entidades: ' + n : '', extra].filter(Boolean).join('\n') };
};
const dedupe = a => [...new Set(a)];

// ---------------- DXF ----------------
export function dxfPages(txt) {
  const L = txt.split(/\r?\n/);
  const model = [], paper = [], attrs = [], blocks = new Map(), layers = [], blockNames = [], counts = {};
  let section = '', pending = false, cur = null, curBlock = null, hvar = '', ver = '', insert = '';
  const flush = () => {
    if (!cur) return; const { t, f } = cur; cur = null;
    if (section === 'TABLES') { if (t === 'LAYER' && f[2]) layers.push(f[2]); return; }
    if (section === 'BLOCKS') { if (t === 'BLOCK') { curBlock = f[2] || ''; if (curBlock && !curBlock.startsWith('*')) blockNames.push(curBlock); return; } if (t === 'ENDBLK') { curBlock = null; return; } }
    if (section !== 'ENTITIES' && section !== 'BLOCKS') return;
    counts[t] = (counts[t] || 0) + 1;
    const into = line => { if (!line) return; if (section === 'BLOCKS') { if (curBlock && !curBlock.startsWith('*')) { if (!blocks.has(curBlock)) blocks.set(curBlock, []); blocks.get(curBlock).push(line); } } else (f[67] === '1' ? paper : model).push(line); };
    if (t === 'TEXT') into(cadText(f[1]));
    else if (t === 'MTEXT') into(cadText((f.c3 || []).join('') + (f[1] || ''), true));
    else if (t === 'ATTRIB') { const v = cadText(f[1]); if (v) (section === 'BLOCKS' ? into : l => attrs.push(l))(`${insert ? insert + ' · ' : ''}${f[2] || ''}: ${v}`); }
    else if (t === 'ATTDEF') { const v = cadText(f[1]); into(`${f[2] || ''}${v ? ' (valor por defecto: ' + v + ')' : ''}${f[3] ? ' — ' + cadText(f[3]) : ''}`); }
    else if (t === 'DIMENSION') { const v = cadText(f[1], true); if (v && v !== '<>') into(v); }
    else if (t === 'MULTILEADER' || t === 'MLEADER') into(cadText(f[304] || f[1], true));
    else if (t === 'INSERT') insert = f[2] || '';
    else if (t === 'SEQEND') insert = '';
  };
  for (let i = 0; i + 1 < L.length; i += 2) {
    const c = parseInt(L[i], 10), v = L[i + 1];
    if (c === 0) {
      flush(); const t = v.trim();
      if (t === 'SECTION') { section = ''; pending = true; continue; }
      if (t === 'ENDSEC') { section = ''; continue; }
      if (t === 'EOF') break;
      cur = { t, f: {} }; continue;
    }
    if (pending && c === 2) { section = v.trim(); pending = false; continue; }
    if (section === 'HEADER') { if (c === 9) hvar = v.trim(); else if (hvar === '$ACADVER' && c === 1) ver = v.trim(); continue; }
    if (!cur) continue;
    if (c === 3 && (cur.t === 'MTEXT')) (cur.f.c3 ||= []).push(v.replace(/\r$/, ''));
    else if (cur.f[c] === undefined || c === 1) cur.f[c] = v.replace(/\r$/, '');
  }
  flush();
  const pages = [...paginate(model, 'espacio modelo'), ...paginate(paper, 'presentaciones (papel)'), ...paginate(attrs, 'atributos y cajetín')];
  const bl = [...blocks].map(([n, ls]) => `[${n}] ${ls.join(' / ')}`);
  pages.push(...paginate(bl, 'definición de bloques'));
  pages.push(infoPage(ver, dedupe(layers), dedupe(blockNames), counts));
  return finish(pages);
}

// ---------------- DWG (y DXF binario) ----------------
let lwPromise = null;
const BASE = new URL('../', import.meta.url);
const lwLoad = async (base = BASE) => { if (!lwPromise) lwPromise = import(new URL('vendor/libredwg/dist/libredwg-web.js', base).href).then(async m => ({ m, lw: await m.LibreDwg.create() })); return lwPromise; };
export async function dwgPages(u8, kind = 'DWG') {
  const { m, lw } = await lwLoad();
  const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  const ptr = lw.dwg_read_data(ab, kind === 'DXF' ? m.Dwg_File_Type.DXF : m.Dwg_File_Type.DWG);
  if (!ptr) throw new Error('No se pudo leer el DWG (versión no admitida o archivo dañado).');
  let db; try { db = lw.convert(ptr); } finally { try { lw.dwg_free(ptr); } catch { /* ya liberado */ } }
  const model = [], paper = [], attrs = [], blockLines = [], blockNames = [], counts = {};
  const txt = (e, ctx, out) => {
    counts[e.type] = (counts[e.type] || 0) + 1;
    if (e.type === 'TEXT') out.push(cadText(e.text));
    else if (e.type === 'MTEXT') out.push(cadText(e.text, true));
    else if (e.type === 'ATTRIB') { const v = cadText(e.text?.text ?? e.text); if (v) attrs.push(`${ctx ? ctx + ' · ' : ''}${e.tag || ''}: ${v}`); }
    else if (e.type === 'ATTDEF') { const v = cadText(e.text?.text ?? ''); out.push(`${e.tag || ''}${v ? ' (valor por defecto: ' + v + ')' : ''}${e.prompt ? ' — ' + cadText(e.prompt) : ''}`); }
    else if (e.type === 'DIMENSION') { const v = cadText(typeof e.text === 'string' ? e.text : '', true); if (v && v !== '<>') out.push(v); }
    else if (e.type === 'MULTILEADER' || e.type === 'MLEADER') { const v = cadText(e.contextData?.content?.text || e.text || '', true); if (v) out.push(v); }
    else if (e.type === 'INSERT') for (const a of e.attribs || []) txt(a, e.name, out);
  };
  const recs = db.tables?.BLOCK_RECORD?.entries || [];
  for (const b of recs) {
    const n = b.name || '', ents = b.entities || [];
    if (/^\*model_space$/i.test(n)) ents.forEach(e => txt(e, '', model));
    else if (/^\*paper_space/i.test(n)) ents.forEach(e => txt(e, '', paper));
    else if (!n.startsWith('*')) { blockNames.push(n); const ls = []; ents.forEach(e => txt(e, '', ls)); if (ls.length) blockLines.push(`[${n}] ${ls.filter(Boolean).join(' / ')}`); }
  }
  if (!recs.length) (db.entities || []).forEach(e => txt(e, '', model));
  const layers = (db.tables?.LAYER?.entries || []).map(l => l.name).filter(Boolean);
  const verKey = typeof db.header?.ACADVER === 'string' ? db.header.ACADVER : '';
  const pages = [...paginate(model.filter(Boolean), 'espacio modelo'), ...paginate(paper.filter(Boolean), 'presentaciones (papel)'), ...paginate(attrs, 'atributos y cajetín'), ...paginate(blockLines, 'definición de bloques')];
  pages.push(infoPage(verKey, dedupe(layers), dedupe(blockNames), counts));
  return finish(pages);
}

// ---------------- DGN V7 (ISFF) ----------------
export function dgn7Pages(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), n = u8.length, lines = [], counts = {};
  let pos = 0, is3d = false, first = true;
  while (pos + 4 <= n) {
    const w0 = dv.getUint16(pos, true); if (w0 === 0xFFFF) break;
    const type = (w0 >> 8) & 0x7f, words = dv.getUint16(pos + 2, true), size = (words + 2) * 2;
    if (size < 4 || pos + size > n) break;
    counts['tipo ' + type] = (counts['tipo ' + type] || 0) + 1;
    if (first && type === 9 && size > 1215) is3d = !!(u8[pos + 1214] & 0x40);
    if (type !== 9 && type !== 8) first = false;
    if (type === 17 && !(w0 & 0x8000)) {   // elemento de texto
      const o = is3d ? 74 : 58;
      if (pos + o + 2 <= n && size > o + 2) {
        const len = u8[pos + o], s = u8.subarray(pos + o + 2, Math.min(pos + o + 2 + len, pos + size));
        const t = u8dec(s, 'windows-1252').replace(/\0+$/g, '').replace(/[\r\n]+/g, ' ').trim(); if (t) lines.push(t);
      }
    }
    pos += size;
  }
  const info = { label: 'información del plano', text: `Formato DGN V7 · ${n} bytes · ${is3d ? '3D' : '2D'}` };
  return finish([...paginate(lines, 'textos del plano'), info]);
}

// ---------------- DGN V8 (contenedor OLE): extracción aproximada de cadenas ----------------
export function dgn8Pages(u8) {
  const cfb = XLSX.CFB.read(u8, { type: 'array' }), found = [];
  const runs = bytes => {   // cadenas UTF-16LE y ASCII legibles de al menos 5 caracteres
    const out = []; let cur = '';
    for (let i = 0; i + 1 < bytes.length; i += 2) { const c = bytes[i] | (bytes[i + 1] << 8); if ((c >= 32 && c < 127) || (c >= 0xA0 && c < 0x250)) cur += String.fromCharCode(c); else { if (cur.length >= 5) out.push(cur.trim()); cur = ''; } }
    if (cur.length >= 5) out.push(cur.trim()); return out;
  };
  for (const e of cfb.FileIndex || []) {
    const c = e.content; if (!c || !c.length || e.type !== 2) continue;
    let b = Uint8Array.from(c);
    if (b[0] === 0x78) { try { b = pako.inflate(b); } catch { /* no comprimido */ } }
    for (const r of runs(b)) found.push(r);
    for (const r of runs(b.subarray(1))) found.push(r);
  }
  const good = dedupe(found).filter(s => /[A-Za-zÁÉÍÓÚáéíóúñÑ]{3}/.test(s) && !/^[A-Za-z0-9_.~$\- ]{5,}$/.test(s) || /\s/.test(s));
  return finish([{ label: 'textos detectados (extracción aproximada de DGN V8)', text: good.join('\n') }, { label: 'información del plano', text: 'Formato DGN V8 (MicroStation). La lectura es aproximada: se rescatan las cadenas de texto del archivo sin interpretar su estructura. Revisa siempre el plano original.' }]);
}

// ---------------- punto de entrada ----------------
export async function cadPages(ext, u8) {
  if (ext === 'dxf') {
    const head = u8dec(u8.subarray(0, 22), 'latin1');
    if (head.startsWith('AutoCAD Binary DXF')) return dwgPages(u8, 'DXF');
    return dxfPages(decode(u8));
  }
  if (ext === 'dwg') return dwgPages(u8, 'DWG');
  if (ext === 'dgn') return (u8[0] === 0xD0 && u8[1] === 0xCF) ? dgn8Pages(u8) : dgn7Pages(u8);
  throw new Error('Formato CAD no admitido: .' + ext);
}
