// Lectura directa de Word (.doc) y Excel (.xls) binarios antiguos, sin convertirlos. Usa SheetJS (global XLSX) solo para abrir el
// contenedor OLE/CFB y leer las hojas de .xls; el texto de .doc se extrae aquí de la tabla de piezas del documento Word 97–2003.
const CP1252 = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';
const latin = u8 => { let s = ''; for (const b of u8) s += b >= 0x80 && b < 0xA0 ? CP1252[b - 0x80] : String.fromCharCode(b); return s; };
const utf16 = u8 => new TextDecoder('utf-16le').decode(u8);

function stream(cfb, name) {
  const e = XLSX.CFB.find(cfb, name); if (!e || !e.content) return null;
  return e.content instanceof Uint8Array ? e.content : Uint8Array.from(e.content);
}
// Campos de Word: 0x13 código 0x14 resultado 0x15. Se conserva solo el resultado visible.
function cleanStory(s) {
  let out = '', stack = [];   // stack: true = dentro del código del campo
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c === 0x13) { stack.push(true); continue; }
    if (c === 0x14) { if (stack.length) stack[stack.length - 1] = false; continue; }
    if (c === 0x15) { stack.pop(); continue; }
    if (stack.some(x => x)) continue;
    if (c === 0x0D) out += '\n'; else if (c === 0x07) out += '\x07'; else if (c === 0x0B) out += '\n'; else if (c === 0x1E || c === 0x1F) out += '-';
    else if (c === 0x0C) out += '\f'; else if (c < 0x20 && c !== 0x09 && c !== 0x0A) continue; else out += ch;
  }
  return out.replace(/\x07\x07/g, '\n').replace(/\x07/g, '\t').replace(/\t+\n/g, '\n').replace(/[ \t]+\n/g, '\n');
}

export function docPages(u8) {
  let cfb; try { cfb = XLSX.CFB.read(u8, { type: 'array' }); } catch { throw new Error('No es un documento de Word válido (.doc).'); }
  const wd = stream(cfb, 'WordDocument'); if (!wd) throw new Error('El archivo .doc no contiene un documento de Word.');
  const dv = new DataView(wd.buffer, wd.byteOffset, wd.byteLength), u16 = o => dv.getUint16(o, true), u32 = o => dv.getUint32(o, true);
  if (u16(0) !== 0xA5EC) throw new Error('Formato de Word anterior a Word 97 no admitido. Guárdalo como .docx o PDF.');
  const flags = u16(10);
  if (flags & 0x100) throw new Error('Documento Word protegido con contraseña: no se puede leer.');
  const tbl = stream(cfb, (flags & 0x200) ? '1Table' : '0Table'); if (!tbl) throw new Error('Falta la tabla de piezas del documento.');
  const tv = new DataView(tbl.buffer, tbl.byteOffset, tbl.byteLength);
  const csw = u16(32), rgLw = 34 + csw * 2 + 2, cslw = u16(34 + csw * 2), rgFc = rgLw + cslw * 4 + 2;
  const cc = i => u32(rgLw + 4 * i);
  const ccp = { text: cc(3), ftn: cc(4), hdd: cc(5), atn: cc(7), edn: cc(8), txbx: cc(9), hdrTxbx: cc(10) };
  const fcClx = u32(rgFc + 33 * 8), lcbClx = u32(rgFc + 33 * 8 + 4);
  let i = fcClx; const end = fcClx + lcbClx;
  while (i < end && tbl[i] === 1) i += 3 + tv.getUint16(i + 1, true);
  if (tbl[i] !== 2) throw new Error('Estructura de texto del .doc no reconocida.');
  const lcb = tv.getUint32(i + 1, true), plc = i + 5, n = (lcb - 4) / 12;
  const total = tv.getUint32(plc + 4 * n, true), chars = new Array(n);
  let all = '';
  for (let k = 0; k < n; k++) {
    const cp0 = tv.getUint32(plc + 4 * k, true), cp1 = tv.getUint32(plc + 4 * (k + 1), true), fcRaw = tv.getUint32(plc + 4 * (n + 1) + 8 * k + 2, true), len = cp1 - cp0;
    if (fcRaw & 0x40000000) { const o = (fcRaw & 0x3FFFFFFF) >>> 1; chars[k] = latin(wd.subarray(o, o + len)); }
    else { const o = fcRaw & 0x3FFFFFFF; chars[k] = utf16(wd.subarray(o, o + len * 2)); }
  }
  all = chars.join('');
  if (!all.length && total) throw new Error('No se pudo extraer texto del .doc.');
  let pos = 0; const take = k => { const s = all.slice(pos, pos + k); pos += k; return s; };
  const story = { main: take(ccp.text), ftn: take(ccp.ftn), hdd: take(ccp.hdd) }; take(cc(6)); story.atn = take(ccp.atn); story.edn = take(ccp.edn); story.txbx = take(ccp.txbx); story.hdrTxbx = take(ccp.hdrTxbx);
  const pages = [], main = cleanStory(story.main).split('\f').map(t => t.trim()).filter(Boolean);
  main.forEach((t, k) => pages.push({ label: main.length > 1 ? `pág. ${k + 1} (aprox.)` : '', text: t }));
  const extra = (label, s) => { const t = cleanStory(s).trim(); if (t) pages.push({ label, text: t }); };
  extra('notas al pie', story.ftn); extra('encabezados y pies de página', story.hdd); extra('comentarios', story.atn); extra('notas finales', story.edn); extra('cuadros de texto', story.txbx + '\n' + story.hdrTxbx);
  return (pages.length ? pages : [{ label: '', text: '' }]).map((p, k) => ({ pageNo: k + 1, ...p }));
}

export function xlsPages(u8) {
  let wb; try { wb = XLSX.read(u8, { type: 'array', sheetRows: 20000, cellDates: false }); }
  catch (e) { throw new Error(/password|encrypt/i.test(e.message) ? 'Libro de Excel protegido con contraseña: no se puede leer.' : 'No se pudo leer el .xls: ' + e.message); }
  const pages = [];
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '', blankrows: false })
      .map(r => r.map(c => String(c ?? '').trim()).filter(Boolean).join(' | ')).filter(Boolean);
    pages.push({ pageNo: pages.length + 1, label: `hoja «${name}»`, text: rows.join('\n').slice(0, 400000) });
  }
  return pages.length ? pages : [{ pageNo: 1, label: '', text: '' }];
}


// ---------------- PowerPoint 97–2003 (.ppt) ----------------
// Registros de «PowerPoint Document»: el texto de cada diapositiva está en TextCharsAtom (UTF-16) y TextBytesAtom (1252) dentro de SlideListWithText;
// el texto de formas/tablas está en los contenedores de diapositiva. Se agrupa por diapositiva; las notas del orador van en páginas aparte.
export function pptPages(u8) {
  let cfb; try { cfb = XLSX.CFB.read(u8, { type: 'array' }); } catch { throw new Error('No es una presentación de PowerPoint válida (.ppt).'); }
  const ps = stream(cfb, 'PowerPoint Document'); if (!ps) throw new Error('El archivo .ppt no contiene una presentación de PowerPoint.');
  if (stream(cfb, 'EncryptedSummary') ) throw new Error('Presentación protegida con contraseña: no se puede leer.');
  const dv = new DataView(ps.buffer, ps.byteOffset, ps.byteLength);
  const slides = [], notes = []; let cur = null, mode = '';
  const fix = t => t.replace(/\r\n?|\x0b|\x0d/g, '\n').replace(/[\x00-\x08\x0e-\x1f]/g, '').trim();
  const take = (type, s, e) => { const t = fix(type === 0x0FA0 ? utf16(ps.subarray(s, e)) : latin(ps.subarray(s, e))); if (t) cur?.push(t); };
  const walk = (s, e, ctx) => {
    let p = s;
    while (p + 8 <= e) {
      const vi = dv.getUint16(p, true), type = dv.getUint16(p + 2, true), len = dv.getUint32(p + 4, true), b = p + 8, end = Math.min(b + len, e), ver = vi & 0xF, inst = vi >> 4;
      if (type === 0x03F3 && ctx === 'list') { cur = []; (mode === 'notes' ? notes : slides).push(cur); }
      else if (type === 0x0FA0 || type === 0x0FA8) { if (ctx === 'list' || ctx === 'slide' || ctx === 'notes') take(type, b, end); }
      else if (ver === 0xF) {
        if (type === 0x0FF0) { mode = inst === 2 ? 'notes' : inst === 0 ? 'slides' : 'master'; if (mode !== 'master') walk(b, end, 'list'); }
        else if (type === 0x03EE || type === 0x03F0) { /* Slide / Notes: texto de formas */ const k = ctx === 'root' ? (type === 0x03EE ? 'slide' : 'notes') : ctx; const save = cur; const arr = type === 0x03EE ? (extra.slides.push([]), extra.slides.at(-1)) : (extra.notes.push([]), extra.notes.at(-1)); cur = arr; walk(b, end, k); cur = save; }
        else if (type === 0x03F8 || type === 0x03FA) { /* MainMaster / Master */ }
        else walk(b, end, ctx);
      }
      p = b + len;
    }
  };
  const extra = { slides: [], notes: [] };
  walk(0, ps.length, 'root');
  const pages = [], uniq = (a, extraLines) => { const seen = new Set(a.map(x => x.replace(/\s+/g, ' '))); return [...a, ...extraLines.filter(x => !seen.has(x.replace(/\s+/g, ' ')))]; };
  const n = Math.max(slides.length, extra.slides.length);
  for (let i = 0; i < n; i++) { const t = uniq(slides[i] || [], extra.slides[i] || []).join('\n'); if (t.trim()) pages.push({ label: `diapositiva ${i + 1}`, text: t }); }
  const nn = Math.max(notes.length, extra.notes.length);
  for (let i = 0; i < nn; i++) { const t = uniq(notes[i] || [], extra.notes[i] || []).join('\n'); if (t.trim()) pages.push({ label: `notas del orador (n.º ${i + 1}; el orden puede no coincidir con las diapositivas)`, text: t }); }
  const r = pages.map((p, i) => ({ pageNo: i + 1, label: p.label, text: p.text }));
  return r.length ? r : [{ pageNo: 1, label: '', text: '' }];
}
