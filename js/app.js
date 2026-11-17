import { DB } from './db.js';
import { sha256, processPdf, processImage } from './proc.js';
import { buildReport } from './report.js';

const $ = s => document.querySelector(s);
const esc = s => (s ?? '').toString().replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fdate = s => s ? s.replace('T', ' ').slice(0, 16) : '';
const PDF_EXT = ['pdf'], IMG_EXT = ['jpg', 'jpeg', 'png', 'tif', 'tiff'], MAIL_EXT = ['eml', 'msg'];
const ALL_EXT = [...PDF_EXT, ...IMG_EXT, ...MAIL_EXT];
const INLINE_MAX = 50 * 1024;   // imágenes pequeñas incrustadas (logos, firmas) no se indexan
const LOW_CONF = 60;
const extOf = n => (n.split('.').pop() || '').toLowerCase();

// ---- normalización (misma longitud: permite localizar posiciones en el texto original) ----
const normChar = c => { const d = c.normalize('NFD')[0].toLowerCase(); return d.length === 1 ? d : c.toLowerCase()[0]; };
const normLen = s => Array.from(s).map(normChar).join('');
const normTerm = t => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

let mini, cancel = false, busy = false;
const roots = new Map();   // rootId -> { id, name, handle }
const docsById = new Map();
const selected = new Set();   // documentos marcados para el informe
let lastResultIds = [];

function newMini() {
  mini = new MiniSearch({
    fields: ['text'], storeFields: ['docId', 'pageNo'], idField: 'id',
    processTerm: t => normTerm(t) || null,
    searchOptions: { prefix: t => t.length > 2, combineWith: 'AND', processTerm: t => normTerm(t) || null },
  });
}
const pid = (d, p) => `${d}:${p}`;

async function loadIndex() {
  newMini(); docsById.clear();
  for (const d of await DB.all('docs')) { if (d.source === 'carpeta' && d.rootId == null) d.rootId = 1; docsById.set(d.id, d); }
  const pages = await DB.all('pages');
  mini.addAll(pages.map(p => ({ id: pid(p.docId, p.pageNo), docId: p.docId, pageNo: p.pageNo, text: p.text })));
}

// ---- estado / mensajes ----
const setStatus = (t, cls = '') => { const e = $('#status'); e.className = 'msg ' + cls; e.textContent = t; e.hidden = !t; };
const addMsg = (cls, html) => { $('#upmsgs').insertAdjacentHTML('afterbegin', `<div class="msg ${cls}">${html}</div>`); };

// ---- correos (.eml / .msg) ----
const htmlToText = h => {
  const d = new DOMParser().parseFromString(String(h).replace(/<(br|\/p|\/div|\/tr|\/li|\/h\d)\b[^>]*>/gi, '\n'), 'text/html');
  d.querySelectorAll('style,script,head').forEach(n => n.remove());
  return d.body.textContent.replace(/[ \t ]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
};
const addr = a => a ? (a.name && a.address ? `${a.name} <${a.address}>` : (a.address || a.name || '')) : '';
async function parseEmail(ext, buf) {
  let r;
  if (ext === 'eml') {
    const e = await new EmailLibs.PostalMime().parse(buf);
    r = { subject: e.subject || '', from: addr(e.from), to: (e.to || []).map(addr).join('; '), cc: (e.cc || []).map(addr).join('; '),
      date: e.date ? new Date(e.date).toISOString() : null, text: e.text || '', html: e.html || '',
      atts: (e.attachments || []).map(a => ({ name: a.filename || 'adjunto', mime: a.mimeType || '', bytes: new Uint8Array(a.content), inline: a.disposition === 'inline' || !!a.related })) };
  } else {
    const m = new EmailLibs.MsgReader(buf), f = m.getFileData();
    const rec = (f.recipients || []).map(x => x.name && x.email && x.name !== x.email ? `${x.name} <${x.email}>` : (x.email || x.name)).filter(Boolean);
    const dt = f.messageDeliveryTime || f.clientSubmitTime || f.creationTime;
    r = { subject: f.subject || '', from: f.senderName && f.senderEmail && f.senderName !== f.senderEmail ? `${f.senderName} <${f.senderEmail}>` : (f.senderEmail || f.senderName || ''),
      to: rec.join('; '), cc: '', date: dt && !isNaN(new Date(dt)) ? new Date(dt).toISOString() : null, text: f.body || '', html: f.bodyHtml || '',
      atts: (f.attachments || []).filter(a => !a.innerMsgContent).map(a => { const x = m.getAttachment(a); return { name: x.fileName || a.fileName || 'adjunto', mime: a.attachMimeTag || '', bytes: x.content, inline: !!(a.attachmentHidden || a.pidContentId) }; }) };
  }
  let method = 'cuerpo en texto plano', body = (r.text || '').trim();
  if (body.length < 5 && r.html) { body = htmlToText(r.html); method = 'cuerpo convertido desde HTML'; }
  r.body = body; r.method = method;
  return r;
}
const mailText = r => [`Asunto: ${r.subject}`, `De: ${r.from}`, `Para: ${r.to}`, r.cc ? `CC: ${r.cc}` : null, `Fecha: ${r.date ? r.date.replace('T', ' ').slice(0, 16) : ''}`, '', r.body].filter(x => x !== null).join('\n');

// ---- ingesta ----
async function ingest({ file, buf, key, path, source, via, fileDate, parent, rootId }) {
  const name = file.name, ext = extOf(name);
  if (!ALL_EXT.includes(ext)) { await DB.addLog('error', name, `Formato no admitido: .${ext}`); return { status: 'error', msg: `Formato no admitido: .${ext}` }; }
  if (!buf.byteLength) { await DB.addLog('error', name, 'Archivo vacío'); return { status: 'error', msg: 'Archivo vacío' }; }
  const sha = await sha256(buf);
  const dups = await DB.byIndex('docs', 'sha', sha);
  const dup = dups.find(d => d.key !== key && d.status === 'ok');
  const kind = PDF_EXT.includes(ext) ? 'pdf' : MAIL_EXT.includes(ext) ? 'correo' : 'imagen';
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const doc = {
    sha256: sha, key, name, path: path || null, storedName: `${stamp}_${kind}_${sha.slice(0, 8)}.${ext}`,
    kind, mime: file.type || '', source, via, size: buf.byteLength, fileDate, parentId: parent?.id ?? null, rootId: rootId ?? null,
    subject: parent?.subject ?? null, sender: parent?.sender ?? null, emailDate: parent?.emailDate ?? null, ingestedAt: new Date().toISOString(), pages: 0, status: 'ok',
  };
  if (dup) {
    doc.status = 'duplicado'; doc.error = `Duplicado exacto de #${dup.id} (${dup.path ? dup.path.join('/') : dup.name})`;
    doc.id = await DB.put('docs', doc); docsById.set(doc.id, doc);
    await DB.addLog('duplicado', name, doc.error);
    return { status: 'duplicado', msg: doc.error, docId: dup.id };
  }
  doc.id = await DB.put('docs', doc);
  try {
    if (source !== 'carpeta') await DB.put('blobs', new Blob([buf], { type: file.type }), doc.id);
    const onP = t => setStatus(`${name}: ${t}`, 'info'), onS = t => setStatus(t, 'info');
    let pages, mailAtts = [];
    if (kind === 'correo') {
      const m = await parseEmail(ext, buf);
      Object.assign(doc, { subject: m.subject, sender: m.from, to: m.to, emailDate: m.date });
      pages = [{ pageNo: 1, method: 'correo', conf: null, text: mailText(m), steps: [{ step: 'extraccion_correo', detail: m.method }], processed: null }];
      mailAtts = m.atts;
    } else pages = kind === 'pdf' ? await processPdf(buf, onP, onS) : await processImage(file, buf, onP, onS);
    let low = 0; const mini_docs = [];
    for (const p of pages) {
      await DB.put('pages', { docId: doc.id, pageNo: p.pageNo, method: p.method, conf: p.conf, text: p.text, steps: p.steps });
      if (p.processed) await DB.put('pimg', p.processed, [doc.id, p.pageNo]);
      mini_docs.push({ id: pid(doc.id, p.pageNo), docId: doc.id, pageNo: p.pageNo, text: p.text });
      if (p.conf != null && p.conf < LOW_CONF) low++;
    }
    mini.addAll(mini_docs);
    doc.pages = pages.length; await DB.put('docs', doc); docsById.set(doc.id, doc);
    let msg = kind === 'correo' ? 'Correo indexado' : `Indexado (${pages.length} pág.)`;
    if (low) msg += ` — ${low} pág. con OCR de baja confianza`;
    if (kind === 'correo') {
      doc.attachments = []; let nOk = 0, nSkip = 0, nInl = 0;
      for (const [i, a] of mailAtts.entries()) {
        const aext = extOf(a.name), entry = { name: a.name, size: a.bytes.byteLength, docId: null, note: '' };
        if (![...PDF_EXT, ...IMG_EXT].includes(aext)) { entry.note = 'formato no indexable'; nSkip++; await DB.addLog('info', name, `Adjunto no indexado (${aext || 'sin extensión'}): ${a.name}`); }
        else if (a.inline && IMG_EXT.includes(aext) && a.bytes.byteLength < INLINE_MAX) { entry.note = 'imagen incrustada pequeña (firma/logo)'; nInl++; }
        else {
          const ab = a.bytes.buffer.slice(a.bytes.byteOffset, a.bytes.byteOffset + a.bytes.byteLength);
          const r = await ingest({ file: new File([ab], a.name, { type: a.mime }), buf: ab, key: `a:${doc.sha256}:${i}`, source: 'adjunto', via: `adjunto de #${doc.id}`, fileDate: doc.emailDate || doc.fileDate, parent: doc });
          entry.note = r.status === 'ok' ? 'indexado' : r.msg; entry.docId = r.docId ?? null; if (r.status === 'ok') nOk++;
        }
        doc.attachments.push(entry);
      }
      await DB.put('docs', doc); docsById.set(doc.id, doc);
      msg += ` — adjuntos: ${nOk} indexados` + (nSkip ? `, ${nSkip} de formato no indexable` : '') + (nInl ? `, ${nInl} imágenes incrustadas omitidas` : '');
    }
    await DB.addLog('info', name, msg);
    return { status: 'ok', msg, docId: doc.id };
  } catch (e) {
    doc.status = 'error'; doc.error = String(e.message || e); await DB.put('docs', doc); docsById.set(doc.id, doc);
    await DB.addLog('error', name, `Fallo de procesamiento: ${doc.error}`);
    return { status: 'error', msg: `Fallo de procesamiento: ${doc.error}` };
  }
}

async function removeDoc(id) {
  const nums = await DB.deleteDoc(id); docsById.delete(id);
  for (const n of nums) mini.discard(pid(id, n));
}

async function importFiles(files, via) {
  if (busy) return addMsg('error', 'Hay un proceso en marcha; espera a que termine.');
  busy = true; cancel = false; $('#cancel').hidden = false;
  try {
    for (const f of files) {
      if (cancel) break;
      const buf = await f.arrayBuffer();
      const r = await ingest({ file: f, buf, key: 'i:' + f.name + ':' + f.size + ':' + f.lastModified, source: 'importado', via, fileDate: new Date(f.lastModified).toISOString() });
      addMsg(r.status, `<b>${esc(f.name)}</b> — ${esc(r.msg)}`);
    }
  } finally { busy = false; $('#cancel').hidden = true; setStatus(''); await refresh(); await runSearch(); }
}

// ---- carpeta ----
async function* walk(dir, path = []) {
  for await (const [name, h] of dir.entries()) {
    if (name.startsWith('.') || name === '$RECYCLE.BIN') continue;
    if (h.kind === 'directory') yield* walk(h, [...path, name]);
    else if (ALL_EXT.includes(extOf(name))) yield { handle: h, path: [...path, name] };
  }
}
async function ensurePerm(handle) {
  if (!handle.queryPermission) return true;
  if ((await handle.queryPermission({ mode: 'read' })) === 'granted') return true;
  return (await handle.requestPermission({ mode: 'read' })) === 'granted';
}
async function saveRoots() {
  await DB.put('meta', [...roots.values()].map(r => ({ id: r.id, name: r.name, handle: r.handle })), 'folders');
}
function renderRoots() {
  $('#folders').innerHTML = roots.size ? [...roots.values()].map(r =>
    `<span class="tag" style="font-size:13px;padding:3px 9px">📁 ${esc(r.name)} <a href="#" data-rmroot="${r.id}" title="Quitar carpeta y sus documentos del índice">✕</a></span>`).join(' ')
    : '<span class="m">ninguna (elige una carpeta de documentos y/o una de correos)</span>';
  $('#scan').disabled = !roots.size;
}
async function addRoot(h, remember = true) {
  for (const r of roots.values()) if (await r.handle.isSameEntry(h)) return r;   // ya añadida
  const id = (Math.max(0, ...roots.keys()) || 0) + 1, r = { id, name: h.name, handle: h };
  roots.set(id, r); renderRoots(); if (remember) await saveRoots(); return r;
}
async function removeRoot(id) {
  const r = roots.get(id); if (!r) return;
  if (!confirm(`Se quitará la carpeta «${r.name}» y sus documentos y correos del índice. No se toca ningún archivo del disco. ¿Continuar?`)) return;
  for (const d of [...docsById.values()]) if (d.rootId === id || (d.parentId && docsById.get(d.parentId)?.rootId === id)) await removeDoc(d.id);
  roots.delete(id); renderRoots(); await saveRoots(); await refresh(); await runSearch();
}
async function pickFolder() {
  if (!window.showDirectoryPicker) return addMsg('error', 'Este navegador no permite elegir carpetas. Usa Edge o Chrome (o arrastra/pega/selecciona archivos).');
  try { const h = await window.showDirectoryPicker({ id: 'feedback-docs', mode: 'read' }); await addRoot(h); await scan(); }
  catch (e) { if (e.name !== 'AbortError') addMsg('error', esc(e.message)); }
}
async function scan() {
  if (!roots.size) return;
  if (busy) return addMsg('error', 'Hay un proceso en marcha; espera a que termine.');
  const ok = [];
  for (const r of roots.values()) { if (await ensurePerm(r.handle)) ok.push(r); else addMsg('error', `Sin permiso de lectura sobre «${esc(r.name)}».`); }
  if (!ok.length) return;
  busy = true; cancel = false; $('#cancel').hidden = false;
  let n = { ok: 0, dup: 0, err: 0, skip: 0, mod: 0 };
  try {
    for (const r of ok) {
      setStatus(`Buscando archivos en «${r.name}»…`, 'info');
      const found = []; for await (const e of walk(r.handle)) found.push(e);
      let i = 0;
      for (const e of found) {
        if (cancel) break; i++;
        const key = `c:${r.id}:${e.path.join('/')}`;
        const file = await e.handle.getFile();
        const fileDate = new Date(file.lastModified).toISOString();
        const prev = (await DB.byIndex('docs', 'key', key))[0];
        if (prev && prev.size === file.size && prev.fileDate === fileDate && prev.status !== 'error') { n.skip++; continue; }
        if (prev) { await removeDoc(prev.id); n.mod++; await DB.addLog('info', file.name, 'Archivo modificado en la carpeta: se reindexa'); }
        setStatus(`«${r.name}» (${i}/${found.length}) ${e.path.join('/')}`, 'info');
        const buf = await file.arrayBuffer();
        const res = await ingest({ file, buf, key, path: e.path, source: 'carpeta', via: 'carpeta', fileDate, rootId: r.id });
        if (res.status === 'ok') n.ok++; else if (res.status === 'duplicado') n.dup++; else n.err++;
        if (res.status !== 'ok') addMsg(res.status, `<b>${esc(r.name + '/' + e.path.join('/'))}</b> — ${esc(res.msg)}`);
      }
      if (cancel) break;
    }
    addMsg(cancel ? 'duplicado' : 'ok', `${cancel ? 'Interrumpido. ' : 'Carpetas procesadas. '}Nuevos: ${n.ok} · ya indexados: ${n.skip} · modificados: ${n.mod} · duplicados: ${n.dup} · errores: ${n.err}`);
  } catch (e) { addMsg('error', 'Error al leer la carpeta: ' + esc(e.message)); }
  finally { busy = false; $('#cancel').hidden = true; setStatus(''); await refresh(); await runSearch(); }
}

// ---- abrir originales ----
async function getFileOfDoc(d) {
  if (d.source !== 'carpeta') {
    const b = await DB.get('blobs', d.id);
    if (!b) throw new Error('El original no está en este navegador (índice importado sin archivos).');
    return b;
  }
  const r = roots.get(d.rootId);
  if (!r) throw new Error('La carpeta de este documento no está añadida: vuelve a elegirla.');
  if (!(await ensurePerm(r.handle))) throw new Error('Sin permiso sobre la carpeta (pulsa de nuevo y acepta).');
  let h = r.handle;
  for (const seg of d.path.slice(0, -1)) h = await h.getDirectoryHandle(seg);
  return (await (await h.getFileHandle(d.path.at(-1))).getFile());
}
async function openOriginal(id, page) {
  const w = window.open('', '_blank');
  try {
    const d = docsById.get(id); let f = await getFileOfDoc(d);
    if (d.kind === 'correo') {   // el navegador no muestra correos: se descarga el original para abrirlo en Outlook
      w?.close(); const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = d.name; a.click(); return;
    }
    if (d.kind === 'pdf') f = new Blob([f], { type: 'application/pdf' });
    else if (!f.type) f = new Blob([f], { type: 'image/' + (extOf(d.name) === 'jpg' ? 'jpeg' : extOf(d.name)) });
    const url = URL.createObjectURL(f) + (d.kind === 'pdf' && page ? `#page=${page}` : '');
    if (d.kind === 'imagen' && ['tif', 'tiff'].includes(extOf(d.name))) { w?.close(); return addMsg('duplicado', 'El navegador no muestra TIFF: abre la versión procesada.'); }
    w.location = url;
  } catch (e) { w?.close(); addMsg('error', esc(e.message)); }
}
async function openProcessed(id, page) {
  const b = await DB.get('pimg', [id, page]); if (!b) return;
  window.open(URL.createObjectURL(b), '_blank');
}

// ---- búsqueda ----
function parseQuery(q) {
  const words = [], phrases = [];
  for (const m of q.matchAll(/"([^"]+)"|(\S+)/g)) { if (m[1]) { phrases.push(m[1]); words.push(m[1]); } else words.push(m[2]); }
  return { words, phrases };
}
function snippet(text, terms) {
  const n = normLen(text); let first = -1; const spans = [];
  for (const t of terms) { const nt = normTerm(t); if (!nt) continue; let i = -1, k = 0; while ((i = n.indexOf(nt, i + 1)) >= 0 && k++ < 20) { spans.push([i, i + nt.length]); if (first < 0 || i < first) first = i; } }
  const start = Math.max(0, (first < 0 ? 0 : first) - 70), end = Math.min(text.length, start + 240);
  let out = '', pos = start;
  for (const [a, b] of spans.filter(s => s[0] >= start && s[1] <= end).sort((x, y) => x[0] - y[0])) { if (a < pos) continue; out += esc(text.slice(pos, a)) + '<mark>' + esc(text.slice(a, b)) + '</mark>'; pos = b; }
  out += esc(text.slice(pos, end));
  return (start > 0 ? '… ' : '') + out.replace(/\n/g, ' ') + (end < text.length ? ' …' : '');
}
async function runSearch() {
  const q = $('#q').value.trim(), kind = $('#kind').value, desde = $('#desde').value, hasta = $('#hasta').value;
  const asu = normTerm($('#asunto').value.trim()), rem = normTerm($('#remitente').value.trim());
  const dd = d => (d.emailDate || d.fileDate).slice(0, 10);
  const okDoc = d => d && d.status === 'ok' && (!kind || d.kind === kind) && (!desde || dd(d) >= desde) && (!hasta || dd(d) <= hasta)
    && (!asu || normTerm(d.subject || '').includes(asu)) && (!rem || normTerm(d.sender || '').includes(rem));
  let rows = [];
  if (q) {
    const { words, phrases } = parseQuery(q);
    const hits = mini.search(words.join(' ')).filter(h => okDoc(docsById.get(h.docId)));
    for (const h of hits) {
      if (rows.length >= 50) break;
      const p = await DB.get('pages', [h.docId, h.pageNo]);
      if (phrases.length && !phrases.every(ph => normLen(p.text).replace(/\s+/g, ' ').includes(normLen(ph).replace(/\s+/g, ' ')))) continue;
      rows.push({ d: docsById.get(h.docId), p, snip: snippet(p.text, words.flatMap(w => w.split(/[\s\p{P}]+/u))) });
    }
  } else {
    for (const d of [...docsById.values()].filter(okDoc).sort((a, b) => b.id - a.id).slice(0, 30)) {
      const p = await DB.get('pages', [d.id, 1]); rows.push({ d, p, snip: esc((p?.text || '').slice(0, 160)) });
    }
  }
  lastResultIds = [...new Set(rows.map(r => r.d.id))];
  $('#results').innerHTML = rows.length ? rows.map(({ d, p, snip }) => {
    const where = d.path ? [roots.get(d.rootId)?.name, ...d.path].filter(Boolean).join(' / ') : d.name, low = p.conf != null && p.conf < LOW_CONF, mail = d.kind === 'correo';
    const par = d.parentId ? docsById.get(d.parentId) : null;
    return `<div class="res"><div class="t"><a href="#" ${mail ? 'data-detail' : 'data-open'}="${d.id}" data-page="${p.pageNo}">${esc(mail ? (d.subject || d.name) : d.name)}</a> <span class="m">· ${mail ? 'correo' : 'pág. ' + p.pageNo}</span></div>
      ${(mail || par) ? `<div class="m">${mail ? '' : 'Adjunto del correo «' + esc(par?.subject || '') + '» · '}De: ${esc(d.sender || '')}${mail ? ' · Para: ' + esc(d.to || '') : ''} · ${fdate(d.emailDate)}</div>` : ''}
      <div class="s">${snip}</div>
      <div class="m"><span class="tag">${d.kind}</span><span class="tag">${p.method === 'ocr' ? 'OCR ' + Math.round(p.conf) + '%' : p.method === 'correo' ? 'cuerpo del correo' : 'texto nativo'}</span>
      ${low ? '<span class="tag warn">⚠ OCR de baja confianza: verificar contra el original</span>' : ''}
      ${esc(where)} · ${mail ? '<a href="#" data-open="' + d.id + '" data-page="1">abrir original (' + esc(d.name.split('.').pop()) + ')</a> · ' : 'archivo de ' + fdate(d.fileDate) + ' · '}<a href="#" data-detail="${d.id}" data-page="${p.pageNo}">ver texto extraído</a>
      ${d.kind === 'imagen' ? ` · <a href="#" data-proc="${d.id}" data-page="${p.pageNo}">versión procesada</a>` : ''}</div></div>`;
  }).join('') : '<div class="empty">Sin resultados.</div>';
}

async function showDoc(id, page) {
  const d = docsById.get(id), pages = (await DB.byIndex('pages', 'docId', id)).sort((a, b) => a.pageNo - b.pageNo);
  const pg = pages.find(p => p.pageNo === page) || pages[0]; if (!pg) return;
  $('#detailcard').hidden = false;
  $('#detail').innerHTML = `<div><b>${esc(d.name)}</b> <span class="m">→ nombre asignado ${esc(d.storedName)} · SHA-256 ${esc(d.sha256.slice(0, 16))}…</span></div>
    ${d.kind === 'correo' ? `<div class="m"><b>Adjuntos:</b> ${(d.attachments || []).length ? d.attachments.map(a => (a.docId ? `<a href="#" data-detail="${a.docId}" data-page="1">${esc(a.name)}</a>` : esc(a.name)) + ' <span class="tag">' + esc(a.note) + '</span>').join(' · ') : 'ninguno'} · <a href="#" data-open="${d.id}" data-page="1">abrir original</a></div>` : ''}
    ${d.parentId && docsById.get(d.parentId) ? `<div class="m">Adjunto del correo <a href="#" data-detail="${d.parentId}" data-page="1">«${esc(docsById.get(d.parentId).subject)}»</a> · <a href="#" data-open="${d.id}" data-page="1">abrir adjunto</a></div>` : ''}
    <div class="m">${d.kind === 'correo' ? 'Correo' : 'Página ' + pg.pageNo + ' de ' + d.pages} · ${pg.method === 'correo' ? 'texto extraído del correo' : pg.method === 'ocr' ? 'OCR (confianza media ' + Math.round(pg.conf) + '%)' : 'texto nativo del PDF'}</div>
    <pre id="pagetext">${esc(pg.text) || '(sin texto)'}</pre>
    <div class="row"><button class="sec" id="markbtn" data-doc="${id}" data-page="${pg.pageNo}">★ Marcar selección como importante</button><span class="m">Selecciona un fragmento del texto y pulsa el botón: irá a la sección «Puntos marcados» del informe.</span></div>
    <div id="marks"></div>
    <div class="m"><b>Transformaciones aplicadas:</b> ${pg.steps?.length ? pg.steps.map(s => esc(s.step) + ' (' + esc(s.detail) + ')').join(' · ') : 'ninguna (texto nativo)'}</div>
    <div style="margin-top:8px">${pages.map(p => `<a href="#" data-detail="${id}" data-page="${p.pageNo}">p.${p.pageNo}</a>`).join(' · ')}</div>`;
  await renderMarks(id);
  $('#detailcard').scrollIntoView({ behavior: 'smooth' });
}

async function renderMarks(docId) {
  const ms = (await DB.byIndex('marks', 'docId', docId)).sort((a, b) => a.pageNo - b.pageNo || a.id - b.id), el = $('#marks'); if (!el) return;
  el.innerHTML = ms.length ? `<div class="m" style="margin-top:8px"><b>★ Puntos marcados (${ms.length})</b></div>` + ms.map(m =>
    `<div class="msg ok" style="background:#fffbea;border-color:#ecd98a">«${esc(m.text.length > 260 ? m.text.slice(0, 257) + '…' : m.text)}» <span class="m">(pág. ${m.pageNo}${m.note ? ' · nota: ' + esc(m.note) : ''})</span>
     <a href="#" data-marknote="${m.id}" title="Añadir o editar nota">✎</a> <a href="#" data-markdel="${m.id}" title="Quitar">✕</a></div>`).join('') : '';
}
async function addMark(docId, pageNo) {
  const pre = $('#pagetext'), sel = getSelection(), text = sel?.toString().replace(/\s+/g, ' ').trim();
  if (!text || !sel.rangeCount || !pre.contains(sel.anchorNode)) return addMsg('error', 'Selecciona primero un fragmento dentro del texto extraído.');
  await DB.put('marks', { docId, pageNo, text: text.slice(0, 1000), note: '', at: new Date().toISOString() });
  sel.removeAllRanges(); await renderMarks(docId);
}

async function refresh() {
  const docs = [...docsById.values()].sort((a, b) => b.id - a.id);
  $('#docs').innerHTML = docs.length ? `<table><tr><th></th><th>#</th><th>Archivo</th><th>Tipo</th><th>Origen</th><th>Págs</th><th>Indexado</th><th>Estado</th></tr>` +
    docs.map(d => `<tr><td>${d.status === 'ok' ? `<input type="checkbox" data-sel="${d.id}" ${selected.has(d.id) ? 'checked' : ''}>` : ''}</td><td>${d.id}</td><td>${esc(d.path ? d.path.join('/') : d.name)}</td><td>${d.kind}</td><td>${esc(d.via)}</td><td>${d.pages}</td><td>${fdate(d.ingestedAt)}</td>
    <td>${d.status === 'ok' ? `<a href="#" data-open="${d.id}" data-page="1">original</a>` : `<span class="tag warn">${d.status}</span>`}</td></tr>`).join('') + '</table>' : '<div class="empty">Aún no hay documentos.</div>';
  $('#rep-sel').textContent = `Informe de los seleccionados (${selected.size})`; $('#rep-sel').disabled = !selected.size;
  const bad = (await DB.all('log')).filter(l => l.level !== 'info').reverse().slice(0, 100);
  $('#log').innerHTML = bad.length ? bad.map(l => `<div class="msg ${l.level}"><b>${esc(l.filename)}</b> — ${esc(l.message)} <span class="m">(${fdate(l.at)})</span></div>`).join('') : '<div class="empty">Sin incidencias.</div>';
}

// ---- exportar / importar índice ----
async function exportIndex() {
  const data = { app: 'feedback-web', version: 1, exportedAt: new Date().toISOString(), docs: await DB.all('docs'), pages: await DB.all('pages'), marks: await DB.all('marks') };
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  a.download = `feedback-indice-${new Date().toISOString().slice(0, 10)}.json`; a.click();
}
async function importIndex(file) {
  const data = JSON.parse(await file.text());
  if (data.app !== 'feedback-web') throw new Error('Archivo de índice no válido');
  const map = new Map(); let added = 0, skipped = 0;
  for (const d of data.docs) {
    if ((await DB.byIndex('docs', 'sha', d.sha256)).some(x => x.status === 'ok') || d.status !== 'ok') { skipped++; continue; }
    const old = d.id; delete d.id; if (d.source === 'importado') d.sinOriginal = true;
    map.set(old, await DB.put('docs', d)); added++;
  }
  for (const p of data.pages) if (map.has(p.docId)) await DB.put('pages', { ...p, docId: map.get(p.docId) });
  for (const m of data.marks || []) if (map.has(m.docId)) { delete m.id; await DB.put('marks', { ...m, docId: map.get(m.docId) }); }
  await loadIndex(); await refresh(); await runSearch();
  addMsg('ok', `Índice importado: ${added} documentos añadidos, ${skipped} omitidos. Los archivos de carpeta se abren al elegir la misma carpeta; los importados por arrastrar/pegar no incluyen el original.`);
}

// ---- eventos ----
document.addEventListener('click', e => {
  const t = e.target.closest('[data-open],[data-detail],[data-proc],[data-rmroot],[data-markdel],[data-marknote]'); if (!t) return;
  e.preventDefault();
  if (t.dataset.markdel) { const m = (+t.dataset.markdel); return DB.get('marks', m).then(async x => { await DB.del('marks', m); await renderMarks(x.docId); }); }
  if (t.dataset.marknote) { const m = +t.dataset.marknote; return DB.get('marks', m).then(async x => { const n = prompt('Nota para este punto (opcional):', x.note || ''); if (n === null) return; x.note = n.trim(); await DB.put('marks', x); await renderMarks(x.docId); }); }
  if (t.dataset.rmroot) return removeRoot(+t.dataset.rmroot);
  if (t.dataset.open) openOriginal(+t.dataset.open, +t.dataset.page);
  else if (t.dataset.detail) showDoc(+t.dataset.detail, +t.dataset.page);
  else openProcessed(+t.dataset.proc, +t.dataset.page);
});
const drop = $('#drop');
drop.onclick = () => $('#file').click();
$('#file').onchange = e => { importFiles([...e.target.files], 'seleccionar'); e.target.value = ''; };
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => {
  const files = [...e.dataTransfer.files];
  if (files.length) importFiles(files, 'arrastrar');
  else addMsg('error', `El origen arrastrado no entregó ningún archivo (tipos recibidos: ${esc([...(e.dataTransfer.types || [])].join(', ') || 'ninguno')}). Pasa con correos arrastrados directamente desde Outlook al navegador. Arrástralos primero a una carpeta del Explorador de Windows (se crean archivos .msg) y desde ahí a esta zona, o añade esa carpeta con «Añadir carpeta…». Imágenes de Teams: prueba Ctrl+V o descárgalas.`);
});
document.addEventListener('paste', e => {
  const files = [...(e.clipboardData?.files || [])]; if (!files.length) return; e.preventDefault();
  importFiles(files.map((f, i) => (f.name && f.name !== 'image.png') ? f : new File([f], `pegado_${Date.now()}_${i}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: f.type })), 'pegar');
});
document.addEventListener('change', e => { const c = e.target.closest('[data-sel]'); if (!c) return; c.checked ? selected.add(+c.dataset.sel) : selected.delete(+c.dataset.sel); const b = $('#rep-sel'); b.textContent = `Informe de los seleccionados (${selected.size})`; b.disabled = !selected.size; });
document.addEventListener('mousedown', e => { if (e.target.closest('#markbtn')) e.preventDefault(); });   // no perder la selección al pulsar
document.addEventListener('click', e => { const b = e.target.closest('#markbtn'); if (b) addMark(+b.dataset.doc, +b.dataset.page); });

// ---- informe resumen ----
let reportHtml = '';
async function makeReport(ids, scope) {
  ids = ids.filter(id => docsById.get(id)?.status === 'ok');
  if (!ids.length) return addMsg('error', 'No hay documentos indexados para el informe.');
  ids.sort((a, b) => ((docsById.get(a).parentId ?? a) - (docsById.get(b).parentId ?? b)) || a - b);   // cada correo seguido de sus adjuntos
  const items = [];
  for (const id of ids) {
    const doc = docsById.get(id);
    items.push({ doc, parent: doc.parentId ? docsById.get(doc.parentId) : null,
      pages: (await DB.byIndex('pages', 'docId', id)).sort((a, b) => a.pageNo - b.pageNo),
      marks: (await DB.byIndex('marks', 'docId', id)).sort((a, b) => a.pageNo - b.pageNo || a.id - b.id) });
  }
  reportHtml = buildReport({ items, scope, opts: { auto: $('#rep-auto').checked, compare: $('#rep-cmp').checked }, rootName: id => roots.get(id)?.name });
  $('#reportcard').hidden = false; $('#reportframe').srcdoc = reportHtml;
  $('#reportcard').scrollIntoView({ behavior: 'smooth' });
}
$('#rep-sel').onclick = () => makeReport([...selected], 'documentos seleccionados');
$('#rep-res').onclick = () => makeReport(lastResultIds, 'resultados de la búsqueda actual');
$('#rep-all').onclick = () => makeReport([...docsById.keys()], 'todos los documentos indexados');
$('#rep-doc').onclick = () => {
  const a = document.createElement('a'); a.download = `informe-feedback-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}.doc`;
  a.href = URL.createObjectURL(new Blob(['\ufeff', reportHtml], { type: 'application/msword' })); a.click();
};
$('#rep-print').onclick = () => { const w = $('#reportframe').contentWindow; w.focus(); w.print(); };

$('#pick').onclick = pickFolder;
$('#scan').onclick = scan;
$('#cancel').onclick = () => { cancel = true; };
$('#sf').onsubmit = e => { e.preventDefault(); runSearch(); };
$('#export').onclick = exportIndex;
$('#import').onchange = async e => { try { await importIndex(e.target.files[0]); } catch (err) { addMsg('error', esc(err.message)); } e.target.value = ''; };
$('#wipe').onclick = async () => {
  if (!confirm('Se borrará el índice y los archivos importados de este navegador. No se toca ninguna carpeta ni original. ¿Continuar?')) return;
  await DB.wipe(); await loadIndex(); await refresh(); await runSearch();
};

// ---- arranque ----
(async () => {
  await DB.open(); await loadIndex();
  navigator.storage?.persist?.();
  if (!window.showDirectoryPicker) $('#nofs').hidden = false;
  let saved = await DB.get('meta', 'folders');
  if (!saved) { const old = await DB.get('meta', 'folder'); saved = old ? [{ id: 1, name: old.name, handle: old.handle }] : []; }
  for (const r of saved) roots.set(r.id, r);
  renderRoots();
  window.__feedback = { addRoot: h => addRoot(h, false), scan, importFiles, ready: true };   // gancho para pruebas automáticas
  await refresh(); await runSearch();
})();
