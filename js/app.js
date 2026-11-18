import { embeddedImages } from './extract.js';
import { DB } from './db.js';
import { sha256, processPdf, processImage } from './proc.js';
import { buildModel, renderHtml } from './report.js';
import { toDocx, toPdf, toXlsx, download, reportName } from './export.js';
import { Store } from './store.js';
import { Extras, encryptBytes, decryptBytes } from './extras.js';
import { packXlsx } from './export.js';
import { initPanels, synVariants } from './panels.js';
import { openViewer } from './viewer.js';
import { compareDocs, hunks } from './compare.js';
import { DOC_EXT, LEGACY_EXT, extractDocument, zipEntries, htmlToText, FORMAT_NAME } from './extract.js';

const $ = s => document.querySelector(s);
const esc = s => (s ?? '').toString().replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fdate = s => s ? s.replace('T', ' ').slice(0, 16) : '';
const PDF_EXT = ['pdf'], IMG_EXT = ['jpg', 'jpeg', 'png', 'tif', 'tiff'], MAIL_EXT = ['eml', 'msg'];
const ALL_EXT = [...PDF_EXT, ...IMG_EXT, ...MAIL_EXT, ...DOC_EXT];
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
let curProject = localStorage.getItem('fb-proj') || '';   // '' = todos los proyectos
const pj = d => d.project || 'General', inProj = d => !curProject || pj(d) === curProject;
const selected = new Set();   // documentos marcados para el informe
let lastResultIds = [], lastTerms = [];

const tokenize = t => t.split(/[^\p{L}\p{N}]+/u).filter(Boolean);   // separa por cualquier carácter que no sea letra o número (también tabuladores)
function newMini() {
  mini = new MiniSearch({
    fields: ['text'], storeFields: ['docId', 'pageNo'], idField: 'id',
    tokenize: tokenize, processTerm: t => normTerm(t) || null,
    searchOptions: { prefix: t => t.length > 2, combineWith: 'AND', tokenize: tokenize, processTerm: t => normTerm(t) || null },
  });
}
const pid = (d, p) => `${d}:${p}`;

async function loadIndex() {
  await Extras.load(); fillProjects();
  newMini(); docsById.clear();
  for (const d of await DB.all('docs')) { if (d.source === 'carpeta' && d.rootId == null) d.rootId = 1; docsById.set(d.id, d); }
  const pages = await DB.all('pages');
  mini.addAll(pages.map(p => ({ id: pid(p.docId, p.pageNo), docId: p.docId, pageNo: p.pageNo, text: p.text })));
}

// ---- proyectos, tema, usuario ----
function fillProjects() {
  const sel = $('#proj'); if (!sel) return;
  sel.innerHTML = `<option value="">Todos los proyectos</option>` + Extras.d.projects.map(p => `<option ${p === curProject ? 'selected' : ''}>${esc(p)}</option>`).join('');
  if (curProject && !Extras.d.projects.includes(curProject)) { curProject = ''; sel.value = ''; }
}
// ---- estado / mensajes ----
const setStatus = (t, cls = '') => { const e = $('#status'); e.className = 'msg ' + cls; e.textContent = t; e.hidden = !t; const b = $('#busy'); if (b) b.textContent = t ? '⏳ ' + t.slice(0, 80) : ''; };
const addMsg = (cls, html) => {
  $('#upmsgs').insertAdjacentHTML('afterbegin', `<div class="msg ${cls}">${html}</div>`);
  if (!$('#toasts')) return;   // aviso flotante: se ve aunque estés en otra pestaña
  const t = document.createElement('div'); t.className = 'msg ' + cls; t.innerHTML = html; t.onclick = () => t.remove(); $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), cls === 'error' ? 14000 : 7000); while ($('#toasts').children.length > 4) $('#toasts').firstChild.remove();
};
// ---- pestañas (una pantalla de altura) ----
function goTab(name) {
  localStorage.setItem('fb-tab', name);
  document.querySelectorAll('[data-tab]').forEach(s => s.classList.toggle('on', s.dataset.tab === name));
  document.querySelectorAll('#tabs .tab').forEach(b => b.classList.toggle('on', b.dataset.go === name));
}
document.querySelectorAll('#tabs .tab').forEach(b => b.onclick = () => goTab(b.dataset.go));
goTab(localStorage.getItem('fb-tab') || 'inicio');

// ---- correos (.eml / .msg) ----
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
const tick = () => new Promise(r => setTimeout(r));   // cede el control para que la página siga respondiendo
async function ingest({ file, buf, key, path, source, via, fileDate, parent, rootId, depth = 0, keep }) {
  const name = file.name, ext = extOf(name);
  if (!ALL_EXT.includes(ext)) { await DB.addLog('error', name, `Formato no admitido: .${ext}`); return { status: 'error', msg: `Formato no admitido: .${ext}` }; }
  if (!buf.byteLength) { await DB.addLog('error', name, 'Archivo vacío'); return { status: 'error', msg: 'Archivo vacío' }; }
  const sha = await sha256(buf);
  const dups = await DB.byIndex('docs', 'sha', sha);
  const dup = dups.find(d => d.key !== key && d.status === 'ok');
  const kind = PDF_EXT.includes(ext) ? 'pdf' : MAIL_EXT.includes(ext) ? 'correo' : DOC_EXT.includes(ext) ? 'documento' : 'imagen';
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const doc = {
    sha256: sha, key, name, path: path || null, storedName: `${stamp}_${kind}_${sha.slice(0, 8)}.${ext}`,
    kind, mime: file.type || '', source, via, size: buf.byteLength, fileDate, parentId: parent?.id ?? null, rootId: rootId ?? null,
    project: parent?.project ?? (rootId != null ? roots.get(rootId)?.project : null) ?? keep?.project ?? (curProject || 'General'),
    subject: parent?.subject ?? null, sender: parent?.sender ?? null, emailDate: parent?.emailDate ?? null, ingestedAt: new Date().toISOString(), pages: 0, status: 'ok',
    ...(keep ? { title: keep.title, tags: keep.tags, note: keep.note } : {}),
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
      Object.assign(doc, { subject: keep?.subject || m.subject, sender: keep?.sender || m.from, to: keep?.to || m.to, emailDate: keep?.emailDate || m.date });
      pages = [{ pageNo: 1, method: 'correo', conf: null, text: mailText(m), steps: [{ step: 'extraccion_correo', detail: m.method }], processed: null }];
      mailAtts = m.atts;
    } else if (kind === 'documento') {
      const note = { step: 'extraccion_texto', detail: `${FORMAT_NAME[ext] || ext}: texto extraído directamente, sin convertir a PDF` };
      if (ext === 'zip') {
        const ents = zipEntries(buf);
        pages = [{ pageNo: 1, label: '', method: 'documento', conf: null, text: 'Contenido del ZIP:\n' + ents.map(e => e.path).join('\n'), steps: [note], processed: null }];
        mailAtts = ents.map(e => ({ name: e.name, mime: '', bytes: e.bytes, inline: false }));
      } else { pages = extractDocument(ext, buf).map(x => ({ pageNo: x.pageNo, label: x.label, method: 'documento', conf: null, text: x.text, steps: [note], processed: null })); mailAtts = embeddedImages(ext, buf); }   // imágenes incrustadas: se les pasa OCR solas
    } else pages = kind === 'pdf' ? await processPdf(buf, onP, onS) : await processImage(file, buf, onP, onS);
    let low = 0; const mini_docs = [];
    for (const p of pages) {
      await tick();
      await DB.put('pages', { docId: doc.id, pageNo: p.pageNo, label: p.label || '', method: p.method, conf: p.conf, text: p.text, steps: p.steps });
      if (p.processed) await DB.put('pimg', p.processed, [doc.id, p.pageNo]);
      mini_docs.push({ id: pid(doc.id, p.pageNo), docId: doc.id, pageNo: p.pageNo, text: p.text });
      if (p.conf != null && p.conf < LOW_CONF) low++;
    }
    mini.addAll(mini_docs);
    doc.pages = pages.length; await DB.put('docs', doc); docsById.set(doc.id, doc);
    let msg = kind === 'correo' ? 'Correo indexado' : kind === 'documento' ? `Indexado (${FORMAT_NAME[ext] || ext}, ${pages.length} ${pages.length === 1 ? 'parte' : 'partes'})` : `Indexado (${pages.length} pág.)`;
    if (low) msg += ` — ${low} pág. con OCR de baja confianza`;
    if (kind === 'correo' || mailAtts.length) {
      doc.attachments = []; let nOk = 0, nSkip = 0, nInl = 0;
      for (const [i, a] of mailAtts.entries()) {
        const aext = extOf(a.name), entry = { name: a.name, size: a.bytes.byteLength, docId: null, note: '' };
        if (depth >= 3) { entry.note = 'anidamiento excesivo (máx. 3 niveles)'; nSkip++; }
        else if (!ALL_EXT.includes(aext)) {
          entry.note = LEGACY_EXT.includes(aext) ? `formato antiguo .${aext}: guárdalo como .${aext}x o PDF para indexarlo` : 'formato no indexable'; nSkip++;
          await DB.addLog('info', name, `Adjunto no indexado (${aext || 'sin extensión'}): ${a.name}`);
        }
        else if (a.inline && IMG_EXT.includes(aext) && a.bytes.byteLength < INLINE_MAX) { entry.note = 'imagen incrustada pequeña (firma/logo)'; nInl++; }
        else {
          const ab = a.bytes.buffer.slice(a.bytes.byteOffset, a.bytes.byteOffset + a.bytes.byteLength);
          const r = await ingest({ file: new File([ab], a.name, { type: a.mime }), buf: ab, key: `a:${doc.sha256}:${i}`, source: 'adjunto', via: `adjunto de #${doc.id}`, fileDate: doc.emailDate || doc.fileDate, parent: doc, depth: depth + 1 });
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
// ---- editar / eliminar / reindexar ----
const children = id => [...docsById.values()].filter(c => c.parentId === id);
const descendants = id => children(id).flatMap(c => [c.id, ...descendants(c.id)]);
async function afterChange() {
  await refresh(); await runSearch(); await refreshReport();
  const dc = $('#detail').dataset.doc; if (dc && docsById.has(+dc) && !$('#detailcard').hidden) await showDoc(+dc, +$('#detail').dataset.page || 1); else if (dc) { $('#detailcard').hidden = true; $('#detail').dataset.doc = ''; }
}
async function excludeDoc(id) {
  const d = docsById.get(id); if (!d) return;
  const kids = descendants(id), n = kids.length;
  if (!confirm(`¿Eliminar «${d.title || d.name}» del índice?${n ? `\n\nTambién se eliminarán sus ${n} adjunto(s) indexado(s).` : ''}\n\nNo se borra ningún archivo del disco. Dejará de aparecer en búsquedas e informes.${d.source === 'carpeta' ? '\nPodrás restaurarlo desde la tabla de documentos.' : '\nAl ser un archivo importado, se elimina también la copia guardada en este navegador.'}`)) return;
  for (const k of kids) await removeDoc(k);
  if (d.source === 'carpeta') {   // lápida: el reescaneo no lo vuelve a indexar mientras el archivo no cambie
    for (const p of await DB.purgeContent(id)) mini.discard(pid(id, p));
    if (Store.dir) await Store.removeDocFiles(id);
    Object.assign(d, { status: 'excluido', pages: 0, attachments: [], error: 'Excluido del índice por el usuario' }); delete d.title; delete d.tags; delete d.note;
    await DB.put('docs', d);
  } else await removeDoc(id);
  selected.delete(id); kids.forEach(k => selected.delete(k));
  await DB.addLog('info', d.name, 'Eliminado del índice por el usuario'); await Extras.log('Eliminado del índice', d.name, n ? `con ${n} adjunto(s)` : ''); await afterChange();
}
async function bulkDelete() {
  const ids = [...selected].filter(id => docsById.has(id)); if (!ids.length) return;
  if (!confirm(`¿Eliminar ${ids.length} documento(s) del índice (y sus adjuntos)?\nNo se borra ningún archivo del disco.`)) return;
  for (const id of ids) {
    const d = docsById.get(id); if (!d) continue;
    for (const k of descendants(id)) await removeDoc(k);
    if (d.source === 'carpeta') { for (const p of await DB.purgeContent(id)) mini.discard(pid(id, p)); if (Store.dir) await Store.removeDocFiles(id); Object.assign(d, { status: 'excluido', pages: 0, attachments: [], error: 'Excluido del índice por el usuario' }); delete d.title; delete d.tags; delete d.note; await DB.put('docs', d); }
    else await removeDoc(id);
    selected.delete(id);
  }
  await DB.addLog('info', 'varios', `${ids.length} documento(s) eliminados del índice por el usuario`); await Extras.log('Eliminados varios', `${ids.length} documentos`); await afterChange();
}
async function restoreDoc(id) {
  const d = docsById.get(id); if (!d || d.status !== 'excluido') return;
  await removeDoc(id); await Extras.log('Restaurado', d.name); await refresh(); await scan();
}
async function reindexDoc(id) {
  const d = docsById.get(id); if (!d) return;
  if (d.parentId) return addMsg('error', 'Un adjunto se reindexa desde el correo o documento que lo contiene.');
  if (busy) return addMsg('error', 'Hay un proceso en marcha; espera a que termine.');
  let f; try { f = await getFileOfDoc(d); } catch (e) { return addMsg('error', esc(e.message)); }
  if (!confirm(`¿Reindexar «${d.name}» desde el archivo original?\nSe descartan las correcciones manuales de texto; se conservan título, etiquetas, nota y puntos marcados.`)) return;
  busy = true;
  try {
    const marks = await DB.byIndex('marks', 'docId', id), keep = { project: d.project, title: d.title, tags: d.tags, note: d.note, subject: d.edited?.subject ? d.subject : null, sender: d.edited?.sender ? d.sender : null, to: d.edited?.to ? d.to : null, emailDate: d.edited?.emailDate ? d.emailDate : null };
    const buf = await f.arrayBuffer(), file = d.source === 'carpeta' ? f : new File([f], d.name, { type: f.type });
    const info = { file, buf, key: d.key, path: d.path, source: d.source, via: d.via, fileDate: d.fileDate, rootId: d.rootId, keep };
    for (const k of descendants(id)) await removeDoc(k);
    await removeDoc(id);
    const r = await ingest(info);
    if (r.status === 'ok') {
      const nd = docsById.get(r.docId); if (d.edited && nd) { nd.edited = d.edited; await DB.put('docs', nd); }
      for (const m of marks) { const { id: _o, ...rest } = m; await DB.put('marks', { ...rest, docId: r.docId }); }
      addMsg('ok', `<b>${esc(d.name)}</b> reindexado. ${esc(r.msg)}`); await Extras.log('Reindexado', d.name);
    } else addMsg(r.status, `<b>${esc(d.name)}</b> — ${esc(r.msg)}`);
  } catch (e) { addMsg('error', 'Error al reindexar: ' + esc(e.message)); }
  finally { busy = false; setStatus(''); await afterChange(); }
}
async function editMeta(id) {   // título, etiquetas, nota (y datos del correo) desde el formulario del detalle
  const d = docsById.get(id), g = k => ($('#ed-' + k)?.value ?? '').trim();
  d.title = g('title'); d.tags = g('tags'); d.note = g('note');
  if (g('project') && g('project') !== pj(d) && !d.parentId) { d.project = g('project'); for (const c of descendants(id)) { const cd = docsById.get(c); cd.project = d.project; await DB.put('docs', cd); } }
  for (const k of ['title', 'tags', 'note']) if (!d[k]) delete d[k];
  if (d.kind === 'correo') {
    d.edited = { ...(d.edited || {}) };
    for (const k of ['subject', 'sender', 'to']) if (g(k) !== (d[k] || '')) { d[k] = g(k); d.edited[k] = true; }
    if (g('emailDate') && g('emailDate') !== (d.emailDate || '').slice(0, 16)) { d.emailDate = g('emailDate'); d.edited.emailDate = true; }
    for (const c of descendants(id)) { const cd = docsById.get(c); Object.assign(cd, { subject: d.subject, sender: d.sender, emailDate: d.emailDate }); await DB.put('docs', cd); }
  }
  await DB.put('docs', d); await Extras.log('Datos editados', d.name, [d.title && 'título', d.tags && 'etiquetas', d.note && 'nota'].filter(Boolean).join(', ')); await afterChange(); addMsg('ok', 'Datos del documento actualizados.');
}
async function savePageText(id, pageNo) { await setPageText(id, pageNo, $('#ed-text').value); }
async function setPageText(id, pageNo, t) {
  const p = await DB.get('pages', [id, pageNo]);
  if (t === p.text) return;
  if (!p.origText) p.origText = p.text;
  p.text = t; p.edited = true; await DB.put('pages', p);
  try { mini.discard(pid(id, pageNo)); } catch { /* no estaba */ }
  mini.add({ id: pid(id, pageNo), docId: id, pageNo, text: t });
  await DB.addLog('info', docsById.get(id).name, `Texto de la parte ${pageNo} corregido manualmente`); await Extras.log('Texto corregido', docsById.get(id).name, `parte ${pageNo}`); await afterChange();
}
async function restorePageText(id, pageNo) {
  const p = await DB.get('pages', [id, pageNo]); if (!p?.origText) return;
  if (!confirm('¿Volver al texto extraído originalmente? Se perderá tu corrección.')) return;
  p.text = p.origText; delete p.origText; delete p.edited; await DB.put('pages', p);
  try { mini.discard(pid(id, pageNo)); } catch { /* */ }
  mini.add({ id: pid(id, pageNo), docId: id, pageNo, text: p.text }); await afterChange();
}

async function importFiles(files, via) {
  if (busy) return addMsg('error', 'Hay un proceso en marcha; espera a que termine.');
  busy = true; cancel = false; $('#cancel').hidden = false;
  try {
    for (const f of files) {
      if (cancel) break;
      const buf = await f.arrayBuffer();
      const r = await ingest({ file: f, buf, key: 'i:' + f.name + ':' + f.size + ':' + f.lastModified, source: 'importado', via, fileDate: new Date(f.lastModified).toISOString() });
      addMsg(r.status, `<b>${esc(f.name)}</b> — ${esc(r.msg)}`); await Extras.log('Importado (' + via + ')', f.name, r.status);
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
  await DB.put('meta', [...roots.values()].map(r => ({ id: r.id, name: r.name, handle: r.handle, project: r.project })), 'folders');
}
function renderRoots() {
  $('#folders').innerHTML = roots.size ? [...roots.values()].map(r =>
    `<span class="tag${r.handle ? '' : ' warn'}" style="font-size:13px;padding:3px 9px">📁 ${esc(r.name)} <span class="m">[${esc(r.project || 'General')}]</span>${r.handle ? '' : ' (volver a elegir)'} <a href="#" data-rmroot="${r.id}" title="Quitar carpeta y sus documentos del índice">✕</a></span>`).join(' ')
    : '<span class="m">ninguna (elige una carpeta de documentos y/o una de correos)</span>';
  $('#scan').disabled = !roots.size;
}
async function addRoot(h, remember = true) {
  for (const r of roots.values()) if (r.handle && await r.handle.isSameEntry(h)) return r;   // ya añadida
  for (const r of roots.values()) if (!r.handle && r.name === h.name) { r.handle = h; renderRoots(); if (remember) await saveRoots(); return r; }   // carpeta restaurada desde la copia en disco
  const id = (Math.max(0, ...roots.keys()) || 0) + 1, r = { id, name: h.name, handle: h, project: curProject || 'General' };
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
async function scan(quiet = false) {   // quiet: pasada automática, sin mensajes si no hay novedades ni peticiones de permiso
  if (!roots.size) return;
  if (busy) return quiet ? undefined : addMsg('error', 'Hay un proceso en marcha; espera a que termine.');
  const ok = [];
  for (const r of roots.values()) {
    if (!r.handle) { if (!quiet) addMsg('duplicado', `La carpeta «${esc(r.name)}» no está enlazada en este equipo: vuelve a elegirla con «Añadir carpeta…».`); continue; }
    const granted = quiet ? (await r.handle.queryPermission({ mode: 'read' })) === 'granted' : await ensurePerm(r.handle);
    if (granted) ok.push(r); else if (!quiet) addMsg('error', `Sin permiso de lectura sobre «${esc(r.name)}».`);
  }
  $('#autohint').textContent = quiet && ok.length < roots.size ? '⏸ Reescaneo en pausa: pulsa «Buscar nuevos o modificados» para reconceder permiso a las carpetas.' : '';
  if (!ok.length) return;
  busy = true; cancel = false; $('#cancel').hidden = false;
  let n = { ok: 0, dup: 0, err: 0, skip: 0, mod: 0 }, changed = false;
  try {
    for (const r of ok) {
      if (!quiet) setStatus(`Buscando archivos en «${r.name}»…`, 'info');
      const found = []; for await (const e of walk(r.handle)) found.push(e);
      let i = 0;
      for (const e of found) {
        if (cancel) break; i++; await tick();
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
    changed = n.ok + n.mod + n.dup + n.err > 0;
    if (!quiet || changed) addMsg(cancel ? 'duplicado' : 'ok', `${quiet ? 'Reescaneo automático. ' : ''}${cancel ? 'Interrumpido. ' : 'Carpetas procesadas. '}Nuevos: ${n.ok} · ya indexados: ${n.skip} · modificados: ${n.mod} · duplicados: ${n.dup} · errores: ${n.err}`);
  } catch (e) { addMsg('error', 'Error al leer la carpeta: ' + esc(e.message)); }
  finally { busy = false; $('#cancel').hidden = true; setStatus(''); if (!quiet || changed) { await refresh(); await runSearch(); } }
}

// ---- abrir originales ----
async function getFileOfDoc(d) {
  if (d.source !== 'carpeta') {
    const b = await DB.get('blobs', d.id);
    if (!b) throw new Error('El original no está en este navegador (índice importado sin archivos).');
    return b;
  }
  const r = roots.get(d.rootId);
  if (!r || !r.handle) throw new Error('La carpeta de este documento no está enlazada: vuelve a elegirla con «Añadir carpeta…».');
  if (!(await ensurePerm(r.handle))) throw new Error('Sin permiso sobre la carpeta (pulsa de nuevo y acepta).');
  let h = r.handle;
  for (const seg of d.path.slice(0, -1)) h = await h.getDirectoryHandle(seg);
  return (await (await h.getFileHandle(d.path.at(-1))).getFile());
}
async function openOriginal(id, page) {
  const w = window.open('', '_blank');
  try {
    const d = docsById.get(id); let f = await getFileOfDoc(d);
    if (d.kind === 'correo' || d.kind === 'documento') {   // el navegador no los muestra: se descarga el original para abrirlo con su programa
      w?.close(); const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = d.name; a.click(); return;
    }
    if (d.kind === 'pdf') { w?.close(); return openViewer({ blob: new Blob([f], { type: 'application/pdf' }), name: d.title || d.name, pageNo: page || 1, terms: lastTerms }); }
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
const readSpec = () => ({ q: $('#q').value.trim(), kind: $('#kind').value, desde: $('#desde').value, hasta: $('#hasta').value, asunto: $('#asunto').value.trim(), remitente: $('#remitente').value.trim(), etiqueta: $('#etiqueta').value.trim() });
const writeSpec = sp => { $('#q').value = sp.q || ''; $('#kind').value = sp.kind || ''; $('#desde').value = sp.desde || ''; $('#hasta').value = sp.hasta || ''; $('#asunto').value = sp.asunto || ''; $('#remitente').value = sp.remitente || ''; $('#etiqueta').value = sp.etiqueta || ''; };
async function runSearch(spec, render = true) {   // render=false: solo devuelve los ids de documento (búsquedas guardadas)
  const sp = spec || readSpec(), q = sp.q, kind = sp.kind || '', desde = sp.desde || '', hasta = sp.hasta || '';
  const asu = normTerm(sp.asunto || ''), rem = normTerm(sp.remitente || ''), tag = normTerm(sp.etiqueta || '');
  const dd = d => (d.emailDate || d.fileDate).slice(0, 10);
  const okDoc = d => d && d.status === 'ok' && inProj(d) && (!kind || d.kind === kind) && (!desde || dd(d) >= desde) && (!hasta || dd(d) <= hasta)
    && (!asu || normTerm(d.subject || '').includes(asu)) && (!rem || normTerm(d.sender || '').includes(rem)) && (!tag || normTerm((d.tags || '') + ' ' + (d.title || '')).includes(tag));
  const CAP = render ? 100 : 500;
  let rows = [], terms = [];
  if (q) {
    const { words, phrases } = parseQuery(q);
    terms = words.flatMap(w => synVariants(w)).flatMap(w => w.split(/[\s\p{P}]+/u));
    const hits = mini.search({ combineWith: 'AND', queries: words.map(w => ({ combineWith: 'OR', queries: synVariants(w) })) }).filter(h => okDoc(docsById.get(h.docId)));
    for (const h of hits) {
      if (rows.length >= CAP) break;
      const p = await DB.get('pages', [h.docId, h.pageNo]);
      if (phrases.length && !phrases.every(ph => normLen(p.text).replace(/\s+/g, ' ').includes(normLen(ph).replace(/\s+/g, ' ')))) continue;
      rows.push({ d: docsById.get(h.docId), p, score: h.score, snip: render ? snippet(p.text, terms) : '' });
    }
  } else {
    for (const d of [...docsById.values()].filter(okDoc).sort((a, b) => b.id - a.id).slice(0, render ? 30 : CAP)) {
      const p = await DB.get('pages', [d.id, 1]); rows.push({ d, p, score: 0, snip: render ? esc((p?.text || '').slice(0, 160)) : '' });
    }
  }
  if (!render) return [...new Set(rows.map(r => r.d.id))];
  lastTerms = terms;
  const sort = $('#sort').value, when = r => r.d.emailDate || r.d.fileDate || '';
  if (sort === 'fecha-desc') rows.sort((a, b) => when(b).localeCompare(when(a))); else if (sort === 'fecha-asc') rows.sort((a, b) => when(a).localeCompare(when(b)));
  const total = rows.length, extra = new Map();
  if ($('#grp').checked) { const seen = new Map(); rows = rows.filter(r => { if (seen.has(r.d.id)) { extra.set(r.d.id, (extra.get(r.d.id) || 0) + 1); return false; } seen.set(r.d.id, 1); return true; }); }
  lastResultIds = [...new Set(rows.map(r => r.d.id))];
  const kc = {}; rows.forEach(r => kc[r.d.kind] = (kc[r.d.kind] || 0) + 1);
  $('#rescount').textContent = rows.length ? `${total} coincidencia(s) en ${new Set(rows.map(r => r.d.id)).size} documento(s) · ` + Object.entries(kc).map(([k, n]) => `${n} ${k}`).join(' · ') : '';
  $('#results').innerHTML = rows.length ? rows.map(({ d, p, snip }) => {
    const where = d.path ? [roots.get(d.rootId)?.name, ...d.path].filter(Boolean).join(' / ') : d.name, low = p.conf != null && p.conf < LOW_CONF, mail = d.kind === 'correo';
    const par = d.parentId ? docsById.get(d.parentId) : null;
    return `<div class="res"><div class="t"><a href="#" ${mail ? 'data-detail' : 'data-open'}="${d.id}" data-page="${p.pageNo}">${esc(d.title || (mail ? (d.subject || d.name) : d.name))}</a> <span class="m">· ${mail ? 'correo' : (p.label || 'pág. ' + p.pageNo)}${extra.get(d.id) ? ` · +${extra.get(d.id)} coincidencia(s) más` : ''}</span> <span class="tag">${esc(pj(d))}</span></div>
      ${(mail || par) ? `<div class="m">${mail ? '' : 'Adjunto del correo «' + esc(par?.subject || '') + '» · '}De: ${esc(d.sender || '')}${mail ? ' · Para: ' + esc(d.to || '') : ''} · ${fdate(d.emailDate)}</div>` : ''}
      <div class="s">${snip}</div>
      <div class="m"><span class="tag">${d.kind}</span><span class="tag">${p.method === 'ocr' ? 'OCR ' + Math.round(p.conf) + '%' : p.method === 'correo' ? 'cuerpo del correo' : p.method === 'documento' ? 'texto del documento' : 'texto nativo'}</span>
      ${low ? '<span class="tag warn">⚠ OCR de baja confianza: verificar contra el original</span>' : ''}
      ${esc(where)} · ${mail ? '<a href="#" data-open="' + d.id + '" data-page="1">abrir original (' + esc(d.name.split('.').pop()) + ')</a> · ' : 'archivo de ' + fdate(d.fileDate) + ' · '}<a href="#" data-detail="${d.id}" data-page="${p.pageNo}">ver / editar</a> · <a href="#" data-act="exclude" data-id="${d.id}">eliminar</a>${p.edited ? ' <span class="tag warn">texto corregido</span>' : ''}${d.tags ? ' ' + d.tags.split(',').map(t => '<span class="tag">' + esc(t.trim()) + '</span>').join('') : ''}
      ${d.kind === 'imagen' ? ` · <a href="#" data-proc="${d.id}" data-page="${p.pageNo}">versión procesada</a>` : ''}</div></div>`;
  }).join('') : '<div class="empty">Sin resultados.</div>';
  return lastResultIds;
}

async function showDoc(id, page) {
  const d = docsById.get(id), pages = (await DB.byIndex('pages', 'docId', id)).sort((a, b) => a.pageNo - b.pageNo);
  const pg = pages.find(p => p.pageNo === page) || pages[0]; if (!pg) return;
  $('#detailcard').hidden = false; $('#detail').dataset.doc = id; $('#detail').dataset.page = pg.pageNo;
  $('#detail').innerHTML = `<div><b>${esc(d.title || d.name)}</b>${d.title ? ` <span class="m">(${esc(d.name)})</span>` : ''}${d.tags ? ' ' + d.tags.split(',').map(t => `<span class="tag">${esc(t.trim())}</span>`).join('') : ''} <span class="m">→ nombre asignado ${esc(d.storedName)} · SHA-256 ${esc(d.sha256.slice(0, 16))}…</span></div>
    ${d.kind === 'correo' ? `<div class="m"><b>Adjuntos:</b> ${(d.attachments || []).length ? d.attachments.map(a => (a.docId ? `<a href="#" data-detail="${a.docId}" data-page="1">${esc(a.name)}</a>` : esc(a.name)) + ' <span class="tag">' + esc(a.note) + '</span>').join(' · ') : 'ninguno'} · <a href="#" data-open="${d.id}" data-page="1">abrir original</a></div>` : ''}
    ${d.parentId && docsById.get(d.parentId) ? `<div class="m">Adjunto del correo <a href="#" data-detail="${d.parentId}" data-page="1">«${esc(docsById.get(d.parentId).subject)}»</a> · <a href="#" data-open="${d.id}" data-page="1">abrir adjunto</a></div>` : ''}
    <div class="m">${d.kind === 'correo' ? 'Correo' : (pg.label ? pg.label[0].toUpperCase() + pg.label.slice(1) : 'Página ' + pg.pageNo) + ' · parte ' + pg.pageNo + ' de ' + d.pages} · ${pg.method === 'correo' ? 'texto extraído del correo' : pg.method === 'documento' ? 'texto extraído del documento' : pg.method === 'ocr' ? 'OCR (confianza media ' + Math.round(pg.conf) + '%)' : 'texto nativo del PDF'}</div>
    ${d.note ? `<div class="msg ok" style="background:#fffbea;border-color:#ecd98a;color:#1c2430">📝 ${esc(d.note)}</div>` : ''}
    ${pg.edited ? '<div class="m"><span class="tag warn">texto corregido manualmente</span> <a href="#" data-restxt="1">volver al texto extraído originalmente</a></div>' : ''}
    <pre id="pagetext">${esc(pg.text) || '(sin texto)'}</pre>
    <div class="row"><button class="sec" id="markbtn" data-doc="${id}" data-page="${pg.pageNo}">★ Marcar selección como importante</button><button class="sec" id="reqbtn" data-doc="${id}" data-page="${pg.pageNo}">☑ Añadir selección como requisito</button><span class="m">Selecciona un fragmento del texto y pulsa el botón: irá a la sección «Puntos marcados» del informe.</span></div>
    <div id="marks"></div>
    <details style="margin-top:8px"><summary><b>✎ Editar este documento</b></summary>
      <div class="row" style="margin-top:6px"><label class="m">Título visible <input id="ed-title" value="${esc(d.title || '')}" style="min-width:260px"></label><label class="m">Etiquetas (separadas por comas) <input id="ed-tags" value="${esc(d.tags || '')}" style="min-width:220px"></label></div>
      <div class="row"><label class="m" style="flex:1">Nota <input id="ed-note" value="${esc(d.note || '')}" style="width:100%"></label></div>
      ${d.kind === 'correo' ? `<div class="row"><label class="m">Asunto <input id="ed-subject" value="${esc(d.subject || '')}"></label><label class="m">De <input id="ed-sender" value="${esc(d.sender || '')}"></label><label class="m">Para <input id="ed-to" value="${esc(d.to || '')}"></label><label class="m">Fecha <input id="ed-emailDate" type="datetime-local" value="${esc((d.emailDate || '').slice(0, 16))}"></label></div>` : ''}
      <div class="row"><label class="m">Proyecto <select id="ed-project">${Extras.d.projects.map(p => `<option ${p === pj(d) ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label></div>
      <div class="row"><button id="ed-savemeta" data-doc="${id}">Guardar datos</button></div>
      <div class="m" style="margin-top:8px">Corregir el texto de esta parte (p. ej. errores de OCR). Se reindexa al guardar; se conserva el texto original por si quieres volver a él.</div>
      <textarea id="ed-text" style="width:100%;min-height:160px;font-family:monospace">${esc(pg.text)}</textarea>
      <div class="row"><button id="ed-savetext" data-doc="${id}" data-page="${pg.pageNo}">Guardar texto corregido</button></div>
    </details>
    <div class="row" style="margin-top:6px"><button class="sec" data-act="reindex" data-id="${id}">Reindexar desde el original</button><button class="sec" data-act="exclude" data-id="${id}">Eliminar del índice</button></div>
    <div class="m"><b>Transformaciones aplicadas:</b> ${pg.steps?.length ? pg.steps.map(s => esc(s.step) + ' (' + esc(s.detail) + ')').join(' · ') : 'ninguna (texto nativo)'}</div>
    <div style="margin-top:8px">${pages.map(p => `<a href="#" data-detail="${id}" data-page="${p.pageNo}">p.${p.pageNo}</a>`).join(' · ')}</div>`;
  await renderMarks(id);
  goTab('buscar'); $('#detailcard').scrollIntoView({ behavior: 'smooth' });
}

async function renderMarks(docId) {
  const ms = (await DB.byIndex('marks', 'docId', docId)).sort((a, b) => a.pageNo - b.pageNo || a.id - b.id), el = $('#marks'); if (!el) return;
  el.innerHTML = ms.length ? `<div class="m" style="margin-top:8px"><b>★ Puntos marcados (${ms.length})</b></div>` + ms.map(m =>
    `<div class="msg ok" style="background:#fffbea;border-color:#ecd98a;color:#1c2430">«${esc(m.text.length > 260 ? m.text.slice(0, 257) + '…' : m.text)}» <span class="m">(pág. ${m.pageNo}${m.note ? ' · nota: ' + esc(m.note) : ''})</span>
     <a href="#" data-marknote="${m.id}" title="Añadir o editar nota">✎</a> <a href="#" data-reqmark="${m.id}" title="Añadir este punto a la lista de requisitos">→ requisito</a> <a href="#" data-markdel="${m.id}" title="Quitar">✕</a></div>`).join('') : '';
}
async function addMark(docId, pageNo) {
  const pre = $('#pagetext'), sel = getSelection(), text = sel?.toString().replace(/\s+/g, ' ').trim();
  if (!text || !sel.rangeCount || !pre.contains(sel.anchorNode)) return addMsg('error', 'Selecciona primero un fragmento dentro del texto extraído.');
  await DB.put('marks', { docId, pageNo, text: text.slice(0, 1000), note: '', at: new Date().toISOString() }); await Extras.log('Punto marcado', docsById.get(docId)?.name, `parte ${pageNo}`);
  sel.removeAllRanges(); await renderMarks(docId);
}

function renderDash() {
  const ds = [...docsById.values()].filter(inProj), ok = ds.filter(d => d.status === 'ok'), by = k => ok.filter(d => d.kind === k).length;
  const st = Extras.d.reqs.filter(r => !curProject || (docsById.get(r.docId) && inProj(docsById.get(r.docId))));
  const stale = !Store.dir ? 'No hay carpeta de datos: la copia solo existe en este navegador.' : (Store.dirty.size ? 'Cambios pendientes de guardar en disco…' : (!Store.lastSave ? 'Copia en disco aún no guardada en esta sesión.' : (Date.now() - Store.lastSave > 864e5 ? 'La última copia en disco tiene más de 24 h.' : '')));
  const edited = ok.reduce((n, d) => n + (d.edited ? 1 : 0), 0);
  $('#dash').innerHTML = `<h2>Panel · ${esc(curProject || 'todos los proyectos')}</h2><div class="row" style="gap:18px">
    <div><b style="font-size:22px">${ok.length}</b><div class="m">documentos<br>${by('pdf')} PDF · ${by('imagen')} img · ${by('correo')} correos · ${by('documento')} otros</div></div>
    <div><b style="font-size:22px">${ok.reduce((n, d) => n + (d.pages || 0), 0)}</b><div class="m">páginas/partes indexadas</div></div>
    <div><b style="font-size:22px">${ds.filter(d => d.status === 'error').length}</b><div class="m">con error · ${ds.filter(d => d.status === 'excluido').length} excluidos</div></div>
    <div><b style="font-size:22px">${st.length}</b><div class="m">requisitos · ${st.filter(r => r.status === 'pendiente').length} pendientes · ${st.filter(r => r.status === 'conflicto').length} en conflicto${panels?.overdueCount?.() ? ` · <b style="color:#b42318">${panels.overdueCount()} vencidos</b>` : ''}</div></div></div>
    ${stale ? `<div class="msg duplicado">⚠ ${esc(stale)}</div>` : ''}`;
}
async function refresh() {
  renderDash(); renderAudit(); panels.renderReqs(); panels.renderThreads(); panels.renderOcr(); panels.updateBadges();
  const docs = [...docsById.values()].filter(d => inProj(d) && !d.hidden).sort((a, b) => b.id - a.id);
  $('#docs').innerHTML = docs.length ? `<table><tr><th></th><th>#</th><th>Archivo</th><th>Tipo</th><th>Origen</th><th>Págs</th><th>Indexado</th><th>Estado</th><th>Acciones</th></tr>` +
    docs.map(d => `<tr><td>${d.status === 'ok' ? `<input type="checkbox" data-sel="${d.id}" ${selected.has(d.id) ? 'checked' : ''}>` : ''}</td><td>${d.id}</td><td>${esc(d.path ? d.path.join('/') : d.name)}${d.title ? `<div class="m">${esc(d.title)}</div>` : ''}</td><td>${d.kind}</td><td>${esc(d.via)}</td><td>${d.pages}</td><td>${fdate(d.ingestedAt)}</td>
    <td>${d.status === 'ok' ? `<a href="#" data-open="${d.id}" data-page="1">original</a>` : `<span class="tag warn">${d.status}</span>`}</td>
    <td>${d.status === 'ok' ? `<a href="#" data-detail="${d.id}" data-page="1">ver/editar</a>${d.parentId ? '' : ` · <a href="#" data-act="reindex" data-id="${d.id}">reindexar</a>`} · <a href="#" data-act="exclude" data-id="${d.id}">eliminar</a>` : d.status === 'excluido' ? `<a href="#" data-act="restore" data-id="${d.id}">restaurar</a>` : `<a href="#" data-act="exclude" data-id="${d.id}">eliminar</a>`}</td></tr>`).join('') + '</table>' : '<div class="empty">Aún no hay documentos.</div>';
  $('#rep-sel').textContent = `Informe de los seleccionados (${selected.size})`; $('#rep-sel').disabled = !selected.size;
  $('#bulk-del').textContent = `Eliminar seleccionados del índice (${selected.size})`; $('#bulk-del').disabled = !selected.size; $('#cmp-btn').disabled = selected.size !== 2; $('#cmp-btn').textContent = `Comparar versiones (${selected.size}/2)`;
  const bad = (await DB.all('log')).filter(l => l.level !== 'info').reverse().slice(0, 100);
  $('#log').innerHTML = bad.length ? bad.map(l => `<div class="msg ${l.level}"><b>${esc(l.filename)}</b> — ${esc(l.message)} <span class="m">(${fdate(l.at)})</span></div>`).join('') : '<div class="empty">Sin incidencias.</div>';
}

// ---- exportar / importar índice ----
async function buildIndexData() {
  return { app: 'feedback-web', version: 3, exportedAt: new Date().toISOString(), docs: await DB.all('docs'), pages: await DB.all('pages'), marks: await DB.all('marks'), extras: Extras.d };
}
async function exportIndex() {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(await buildIndexData())], { type: 'application/json' }));
  a.download = `feedback-indice-${new Date().toISOString().slice(0, 10)}.json`; a.click(); await Extras.log('Índice exportado', '.json');
}
async function exportEnc() {
  const pw = $('#enc-pass').value; if (pw.length < 6) return addMsg('error', 'Escribe una contraseña de al menos 6 caracteres para cifrar.');
  const bytes = await encryptBytes(pako.gzip(JSON.stringify(await buildIndexData())), pw);
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  a.download = `feedback-indice-${new Date().toISOString().slice(0, 10)}.fbk`; a.click(); await Extras.log('Índice exportado', '.fbk cifrado');
  addMsg('ok', 'Índice cifrado guardado (.fbk). Sin la contraseña no se puede abrir: no hay forma de recuperarla.');
}
async function importIndex(file) {
  let data;
  if (/\.fbk$/i.test(file.name)) {
    const pw = $('#enc-pass').value; if (!pw) throw new Error('Escribe la contraseña en el campo «Contraseña» antes de importar el .fbk.');
    data = JSON.parse(new TextDecoder().decode(pako.ungzip(await decryptBytes(await file.arrayBuffer(), pw))));
  } else data = JSON.parse(await file.text());
  if (data.app !== 'feedback-web') throw new Error('Archivo de índice no válido');
  const map = new Map(); let added = 0, skipped = 0;
  for (const d of data.docs) {
    if ((await DB.byIndex('docs', 'sha', d.sha256)).some(x => x.status === 'ok') || d.status !== 'ok') { skipped++; continue; }
    const old = d.id; delete d.id; if (d.source === 'importado') d.sinOriginal = true;
    map.set(old, await DB.put('docs', d)); added++;
  }
  for (const p of data.pages) if (map.has(p.docId)) await DB.put('pages', { ...p, docId: map.get(p.docId) });
  for (const m of data.marks || []) if (map.has(m.docId)) { delete m.id; await DB.put('marks', { ...m, docId: map.get(m.docId) }); }
  const x = data.extras;
  if (x) {
    await Extras.load();
    for (const p of x.projects || []) if (!Extras.d.projects.includes(p)) Extras.d.projects.push(p);
    for (const r of x.reqs || []) if (map.has(r.docId)) Extras.d.reqs.push({ ...r, id: Extras.d.nextReq++, docId: map.get(r.docId) });
    for (const q of x.searches || []) if (!Extras.d.searches.some(z => z.q === q.q && z.name === q.name)) Extras.d.searches.push(q);
    for (const [k, v] of Object.entries(x.cfg || {})) Extras.d.cfg[k] ??= v;
    await Extras.save();
  }
  await Extras.log('Índice importado', file.name, `${added} añadidos, ${skipped} omitidos`);
  await loadIndex(); await refresh(); await runSearch();
  addMsg('ok', `Índice importado: ${added} documentos añadidos, ${skipped} omitidos. Los archivos de carpeta se abren al elegir la misma carpeta; los importados por arrastrar/pegar no incluyen el original.`);
}

// ---- eventos ----
document.addEventListener('click', e => {
  const t = e.target.closest('[data-open],[data-detail],[data-proc],[data-rmroot],[data-markdel],[data-marknote],[data-act],[data-restxt]'); if (!t) return;
  e.preventDefault();
  if (t.dataset.act) { const id = +t.dataset.id; return t.dataset.act === 'exclude' ? excludeDoc(id) : t.dataset.act === 'reindex' ? reindexDoc(id) : restoreDoc(id); }
  if (t.dataset.restxt) return restorePageText(+$('#detail').dataset.doc, +$('#detail').dataset.page);
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
document.addEventListener('change', e => { const c = e.target.closest('[data-sel]'); if (!c) return; c.checked ? selected.add(+c.dataset.sel) : selected.delete(+c.dataset.sel); const b = $('#rep-sel'); b.textContent = `Informe de los seleccionados (${selected.size})`; b.disabled = !selected.size; $('#bulk-del').textContent = `Eliminar seleccionados del índice (${selected.size})`; $('#bulk-del').disabled = !selected.size; $('#cmp-btn').disabled = selected.size !== 2; $('#cmp-btn').textContent = `Comparar versiones (${selected.size}/2)`; });
document.addEventListener('click', e => { const b = e.target.closest('#ed-savemeta,#ed-savetext'); if (!b) return; b.id === 'ed-savemeta' ? editMeta(+b.dataset.doc) : savePageText(+b.dataset.doc, +b.dataset.page); });
document.addEventListener('mousedown', e => { if (e.target.closest('#markbtn,#reqbtn')) e.preventDefault(); });
document.addEventListener('click', async e => {
  const b = e.target.closest('#reqbtn'); if (!b) return;
  const pre = $('#pagetext'), sel = getSelection(), text = sel?.toString().replace(/\s+/g, ' ').trim();
  if (!text || !sel.rangeCount || !pre.contains(sel.anchorNode)) return addMsg('error', 'Selecciona primero un fragmento dentro del texto extraído.');
  const r = await panels.addReq({ docId: +b.dataset.doc, pageNo: +b.dataset.page, text }); sel.removeAllRanges();
  await panels.changed(); addMsg(r ? 'ok' : 'duplicado', r ? 'Añadido a la lista de requisitos (estado: pendiente).' : 'Ese texto ya está en requisitos.');
});   // no perder la selección al pulsar
document.addEventListener('click', e => { const b = e.target.closest('#markbtn'); if (b) addMark(+b.dataset.doc, +b.dataset.page); });

// ---- comparar dos versiones de un documento ----
let cmpSwap = false, cmpData = null;
async function compareSelected() {
  const ids = [...selected].filter(id => docsById.get(id)?.status === 'ok'); if (ids.length !== 2) return addMsg('error', 'Marca exactamente 2 documentos en la tabla.');
  let [x, y] = ids.map(id => docsById.get(id)).sort((p, q) => (p.emailDate || p.fileDate || '').localeCompare(q.emailDate || q.fileDate || '') || p.id - q.id);
  if (cmpSwap) [x, y] = [y, x];
  const pg = async d => (await DB.byIndex('pages', 'docId', d.id)).sort((p, q) => p.pageNo - q.pageNo);
  const r = compareDocs(await pg(x), await pg(y)); cmpData = { x, y, r };
  const nm = d => esc(d.title || d.subject || d.name), loc = o => esc((o.a || o.b).loc);
  const hs = r.ops ? hunks(r.ops) : [];
  $('#cmp').innerHTML = `<div class="row"><b>A (anterior):</b> ${nm(x)} <span class="m">${fdate(x.emailDate || x.fileDate)}</span> · <b>B (posterior):</b> ${nm(y)} <span class="m">${fdate(y.emailDate || y.fileDate)}</span><button class="sec" id="cmp-swap">Intercambiar A y B</button><button class="sec" id="cmp-xlsx">Descargar (.xlsx)</button></div>
    ${r.ops ? `<p class="m"><span class="tag" style="color:#15803d">+${r.added} líneas añadidas</span><span class="tag" style="color:#b42318">−${r.removed} líneas eliminadas</span><span class="tag">${r.same} iguales</span> · Comparación literal por líneas: un cambio de formato o de saltos de línea puede aparecer como diferencia.</p>` : '<p class="msg error">Los documentos son demasiado distintos o grandes para compararlos línea a línea.</p>'}
    <h2 style="margin-top:10px">Valores técnicos que cambian</h2>${r.values.length ? `<table><tr><th>Dónde</th><th>Categoría</th><th>Valor</th><th>Texto literal</th><th>Ubicación</th></tr>${r.values.map(v => `<tr><td>${v.side}</td><td>${esc(v.cat)}</td><td><b>${esc(v.value)}</b></td><td>${esc(v.ctx)}</td><td>${esc(String(v.page))}</td></tr>`).join('')}</table>` : '<div class="empty">Los mismos valores detectados en ambas versiones.</div>'}
    <h2 style="margin-top:10px">Cambios de texto</h2>${hs.length ? hs.map(h => `<div style="border:1px solid var(--line);border-radius:6px;margin:6px 0;padding:4px 8px;font-size:13px">${h.map(o => o.op === '=' ? `<div class="m">&nbsp;&nbsp;${esc(o.a.t)}</div>` : o.op === '-' ? `<div style="background:#fde8e6;color:#7a1b12"><span class="m">A · ${loc(o)}</span> − ${esc(o.a.t)}</div>` : `<div style="background:#e5f6ea;color:#0f5a2a"><span class="m">B · ${loc(o)}</span> + ${esc(o.b.t)}</div>`).join('')}</div>`).join('') : '<div class="empty">Sin cambios de texto.</div>'}`;
  goTab('documentos'); $('#cmpcard').hidden = false; $('#cmpcard').scrollIntoView({ behavior: 'smooth' });
  await Extras.log('Comparación de versiones', `${x.name} ↔ ${y.name}`, `+${r.added} −${r.removed}`);
}
document.addEventListener('click', e => {
  if (e.target.closest('#cmp-swap')) { cmpSwap = !cmpSwap; compareSelected(); }
  else if (e.target.closest('#cmp-xlsx') && cmpData) {
    const { x, y, r } = cmpData, rows = r.ops.filter(o => o.op !== '=').map(o => [o.op === '+' ? 'Añadido en B' : 'Eliminado de A', (o.a || o.b).loc, (o.a || o.b).t]);
    download(packXlsx([{ name: 'Cambios de texto', widths: [18, 16, 110], rows: [['Tipo', 'Ubicación', 'Texto literal'], ...rows] }, { name: 'Valores', widths: [12, 24, 16, 80, 16], rows: [['Dónde', 'Categoría', 'Valor', 'Texto literal', 'Ubicación'], ...r.values.map(v => [v.side, v.cat, v.value, v.ctx, String(v.page)])] }, { name: 'Documentos', widths: [8, 60], rows: [['', 'Documento'], ['A (anterior)', x.name], ['B (posterior)', y.name]] }]), `feedback-comparacion-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }
});

// ---- comprobador de integridad ----
async function checkIntegrity() {
  const ds = [...docsById.values()].filter(d => d.status === 'ok' && inProj(d) && !d.parentId), res = [], perm = new Map();
  setStatus('Comprobando integridad…', 'info');
  for (const d of ds) {
    let st = 'ok', note = '';
    if (d.source === 'carpeta') {
      const r = roots.get(d.rootId);
      if (!r?.handle) { st = 'sin comprobar'; note = 'carpeta no enlazada en este equipo'; }
      else {
        if (!perm.has(r.id)) perm.set(r.id, await ensurePerm(r.handle));
        if (!perm.get(r.id)) { st = 'sin comprobar'; note = 'sin permiso sobre la carpeta'; }
        else try { let h = r.handle; for (const seg of d.path.slice(0, -1)) h = await h.getDirectoryHandle(seg); const f = await (await h.getFileHandle(d.path.at(-1))).getFile();
          if (f.size !== d.size || new Date(f.lastModified).toISOString() !== d.fileDate) { st = 'modificado'; note = 'el archivo ha cambiado desde que se indexó'; } } catch { st = 'no encontrado'; note = 'el archivo ya no está en la carpeta'; }
      }
    } else if (d.sinOriginal || !(await DB.get('blobs', d.id))) { st = 'sin original'; note = 'el original no está guardado en este navegador (solo se conserva el texto)'; }
    res.push({ d, st, note });
  }
  setStatus('');
  const bad = res.filter(r => r.st !== 'ok');
  $('#integ').innerHTML = `<div class="msg ${bad.length ? 'duplicado' : 'ok'}">${res.length} documento(s) comprobados: ${res.length - bad.length} correctos · ${bad.length} con incidencias.</div>` +
    (bad.length ? `<table><tr><th>Documento</th><th>Estado</th><th>Detalle</th><th>Acciones</th></tr>${bad.map(({ d, st, note }) => `<tr><td>${esc(d.path ? d.path.join('/') : d.name)}</td><td><span class="tag warn">${st}</span></td><td>${note}</td><td>${st === 'modificado' ? `<a href="#" data-act="reindex" data-id="${d.id}">reindexar</a> · ` : ''}<a href="#" data-act="exclude" data-id="${d.id}">eliminar</a></td></tr>`).join('')}</table>` : '');
  await Extras.log('Comprobación de integridad', '', `${bad.length} incidencia(s) de ${res.length}`);
}
$('#integ-btn').onclick = () => checkIntegrity().catch(e => { setStatus(''); addMsg('error', esc(e.message)); });
$('#cmp-btn').onclick = () => { cmpSwap = false; compareSelected(); };

// ---- duplicados en bloque ----
const dupDocs = () => [...docsById.values()].filter(d => d.status === 'duplicado' && inProj(d));
async function clearDuplicates() {
  const dups = dupDocs(), logs = (await DB.all('log')).filter(l => l.level === 'duplicado');
  if (!dups.length && !logs.length) return addMsg('ok', 'No hay duplicados en el registro.');
  if (!confirm(`¿Quitar ${dups.length} duplicado(s) del registro y de la tabla?\n\nNo se borra ningún archivo del disco; los duplicados no estaban indexados. Los archivos de carpeta seguirán reconociéndose como duplicados sin volver a mostrarse.`)) return;
  for (const d of dups) { if (d.source === 'carpeta') { d.hidden = true; await DB.put('docs', d); } else await removeDoc(d.id); }
  for (const l of logs) await DB.del('log', l.id);
  await Extras.log('Duplicados quitados del registro', `${dups.length} documento(s)`); await afterChange();
}
async function deleteDupFiles() {
  const plan = []; for (const d of dupDocs().filter(x => x.source === 'carpeta' && x.path)) { const keep = [...docsById.values()].find(x => x.sha256 === d.sha256 && x.status === 'ok'); if (keep) plan.push({ d, keep }); }
  if (!plan.length) return addMsg('ok', 'No hay archivos duplicados en carpetas enlazadas con copia original indexada.');
  const lista = plan.slice(0, 12).map(p => `• ${p.d.path.join('/')}\n   (se conserva: ${(p.keep.path || [p.keep.name]).join('/')})`).join('\n');
  if (!confirm(`Se van a BORRAR DEL DISCO ${plan.length} archivo(s) duplicado(s) exactos (mismo contenido que otro ya indexado). No van a la Papelera y no se pueden recuperar.\n\n${lista}${plan.length > 12 ? `\n… y ${plan.length - 12} más` : ''}\n\n¿Continuar?`)) return;
  let ok = 0, fail = 0; const perm = new Map();
  for (const { d, keep } of plan) {
    const r = roots.get(d.rootId); try {
      if (!r?.handle) throw new Error('carpeta no enlazada');
      if (!perm.has(r.id)) perm.set(r.id, (await r.handle.requestPermission({ mode: 'readwrite' })) === 'granted'); if (!perm.get(r.id)) throw new Error('sin permiso de escritura');
      if (keep.source === 'carpeta') { const kr = roots.get(keep.rootId); if (!kr?.handle) throw new Error('no se puede verificar la copia que se conserva'); let kh = kr.handle; for (const s of keep.path.slice(0, -1)) kh = await kh.getDirectoryHandle(s); const kf = await (await kh.getFileHandle(keep.path.at(-1))).getFile(); if (kf.size !== keep.size) throw new Error('la copia que se conserva ha cambiado'); }
      let dh = r.handle; for (const s of d.path.slice(0, -1)) dh = await dh.getDirectoryHandle(s); await dh.removeEntry(d.path.at(-1)); await removeDoc(d.id); ok++;
    } catch (e) { fail++; await DB.addLog('error', d.path.join('/'), 'No se pudo borrar el duplicado: ' + e.message); }
  }
  for (const l of (await DB.all('log')).filter(l => l.level === 'duplicado')) await DB.del('log', l.id);
  await Extras.log('Duplicados borrados del disco', `${ok} archivo(s)`, fail ? `${fail} con error` : ''); addMsg(fail ? 'duplicado' : 'ok', `${ok} duplicado(s) borrados del disco${fail ? ` · ${fail} no se pudieron borrar (ver registro)` : ''}.`); await afterChange();
}
$('#dup-clear').onclick = () => clearDuplicates().catch(e => addMsg('error', esc(e.message)));
$('#dup-disk').onclick = () => deleteDupFiles().catch(e => addMsg('error', esc(e.message)));

// ---- registro de cambios ----
function renderAudit() {
  const a = Extras.d.audit.slice(-200).reverse();
  $('#audit').innerHTML = a.length ? `<table><tr><th>Fecha</th><th>Usuario/equipo</th><th>Acción</th><th>Objeto</th><th>Detalle</th></tr>${a.map(x => `<tr><td>${fdate(x.at)}</td><td>${esc(x.user)}</td><td>${esc(x.action)}</td><td>${esc(x.target)}</td><td>${esc(x.detail)}</td></tr>`).join('')}</table>` : '<div class="empty">Sin cambios registrados.</div>';
}
$('#audit-csv').onclick = () => download(new Blob([Extras.auditCsv()], { type: 'text/csv;charset=utf-8' }), `feedback-registro-${new Date().toISOString().slice(0, 10)}.csv`);

// ---- plantilla del informe (por proyecto) ----
const cfgKey = () => curProject || 'General';
const cfg = () => (Extras.d.cfg[cfgKey()] ??= { co: '', no: '', rev: 'A', au: '', logo: '' });
function loadCfg() { const c = cfg(); $('#rc-co').value = c.co; $('#rc-no').value = c.no; $('#rc-rev').value = c.rev; $('#rc-au').value = c.au || Extras.user().replace('(sin nombre)', ''); $('#rc-logoprev').innerHTML = c.logo ? `<img src="${c.logo}" style="height:32px;vertical-align:middle">` : ''; }
for (const [id, k] of [['rc-co', 'co'], ['rc-no', 'no'], ['rc-rev', 'rev'], ['rc-au', 'au']]) $('#' + id).onchange = async e => { cfg()[k] = e.target.value.trim(); await Extras.save(); refreshReport(); };
$('#rc-revup').onclick = async () => { const c = cfg(), r = c.rev || 'A'; c.rev = /^\d+$/.test(r) ? String(+r + 1) : r.length === 1 && /[A-Y]/i.test(r) ? String.fromCharCode(r.charCodeAt(0) + 1) : r + '+'; await Extras.save(); loadCfg(); await Extras.log('Nueva revisión de informe', cfgKey(), c.rev); refreshReport(); };
$('#rc-logoclear').onclick = async () => { cfg().logo = ''; await Extras.save(); loadCfg(); refreshReport(); };
$('#rc-logo').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  const img = await createImageBitmap(f), k = Math.min(1, 300 / img.width, 100 / img.height), cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); cfg().logo = cv.toDataURL('image/png'); cfg().lw = Math.round(cv.width / 2); cfg().lh = Math.round(cv.height / 2); await Extras.save(); loadCfg(); refreshReport(); e.target.value = '';
};

// ---- informe resumen ----
let reportModel = null, reportSpec = null;   // reportSpec: 'sel' | 'res' | 'all' (para regenerar tras editar/eliminar)
const SPEC = { sel: ['documentos seleccionados', () => [...selected]], res: ['resultados de la búsqueda actual', () => lastResultIds], all: ['todos los documentos indexados' + (curProject ? ` (proyecto ${curProject})` : ''), () => [...docsById.values()].filter(inProj).map(d => d.id)] };
async function makeReport(spec, quiet) {
  const [scope0, get] = SPEC[spec]; reportSpec = spec; const scope = spec === 'all' ? 'todos los documentos indexados' + (curProject ? ` (proyecto ${curProject})` : '') : scope0;
  const ids = get().filter(id => docsById.get(id)?.status === 'ok');
  if (!ids.length) { $('#reportcard').hidden = true; reportModel = null; return quiet ? null : addMsg('error', 'No hay documentos indexados para el informe.'); }
  ids.sort((a, b) => ((docsById.get(a).parentId ?? a) - (docsById.get(b).parentId ?? b)) || a - b);   // cada correo seguido de sus adjuntos
  const items = [];
  for (const id of ids) {
    const doc = docsById.get(id);
    items.push({ doc, parent: doc.parentId ? docsById.get(doc.parentId) : null,
      pages: (await DB.byIndex('pages', 'docId', id)).sort((a, b) => a.pageNo - b.pageNo),
      marks: (await DB.byIndex('marks', 'docId', id)).sort((a, b) => a.pageNo - b.pageNo || a.id - b.id) });
  }
  const reqs = panels.reqsInProj().filter(r => docsById.get(r.docId)?.status === 'ok').map(r => { const d = docsById.get(r.docId); return { id: r.id, text: r.text, doc: d.title || d.subject || d.name, loc: 'pág. ' + r.pageNo, status: r.status, group: [r.group, r.link && 'Vinculado a: ' + r.link, r.owner && 'Resp.: ' + r.owner, r.due && 'Vence: ' + r.due].filter(Boolean).join(' · '), note: r.note || '' }; });
  reportModel = buildModel({ reqs, header: { project: cfgKey(), ...cfg() }, items, scope, opts: { auto: $('#rep-auto').checked, compare: $('#rep-cmp').checked }, rootName: id => roots.get(id)?.name });
  $('#reportcard').hidden = false; $('#reportframe').srcdoc = renderHtml(reportModel);
  if (!quiet) { goTab('informes'); $('#reportcard').scrollIntoView({ behavior: 'smooth' }); }
}
const refreshReport = () => reportSpec && !$('#reportcard').hidden ? makeReport(reportSpec, true) : null;
$('#rep-sel').onclick = () => makeReport('sel');
$('#rep-res').onclick = () => makeReport('res');
$('#rep-all').onclick = () => makeReport('all');
const exporter = (id, ext, fn) => { $('#' + id).onclick = async () => { if (!reportModel) return; const b = $('#' + id); b.disabled = true;
  try { download(await fn(reportModel), reportName(ext)); await Extras.log('Informe exportado', '.' + ext, `${reportModel.count} doc., rev. ${reportModel.header?.rev || ''}`); } catch (e) { addMsg('error', `No se pudo generar el .${ext}: ${e.message}`); } b.disabled = false; } };
exporter('rep-docx', 'docx', toDocx); exporter('rep-pdf', 'pdf', toPdf); exporter('rep-xlsx', 'xlsx', toXlsx);
$('#rep-print').onclick = () => { const w = $('#reportframe').contentWindow; w.focus(); w.print(); };

$('#pick').onclick = pickFolder;
$('#scan').onclick = () => scan();
let autoTimer = null;
function setAuto() {
  clearInterval(autoTimer); const on = $('#auto').checked, sec = +$('#autoint').value;
  try { localStorage.setItem('fb-auto', JSON.stringify({ on, sec })); } catch { /* sin almacenamiento: no pasa nada */ }
  if (!on) $('#autohint').textContent = '';
  if (on) autoTimer = setInterval(() => { if (!busy && roots.size) scan(true); }, sec * 1000);
}
$('#auto').onchange = $('#autoint').onchange = setAuto;
try { const a = JSON.parse(localStorage.getItem('fb-auto') || 'null'); if (a) { $('#auto').checked = !!a.on; if ([...$('#autoint').options].some(o => +o.value === a.sec)) $('#autoint').value = a.sec; } } catch { /* ignorar */ }
setAuto();
$('#cancel').onclick = () => { cancel = true; };
$('#sf').onsubmit = e => { e.preventDefault(); runSearch(); };
$('#sort').onchange = $('#grp').onchange = () => runSearch();
$('#bulk-del').onclick = bulkDelete; $('#export').onclick = exportIndex; $('#export-enc').onclick = () => exportEnc().catch(e => addMsg('error', esc(e.message))); $('#export2').onclick = exportIndex;
$('#import').onchange = async e => { try { await importIndex(e.target.files[0]); } catch (err) { addMsg('error', esc(err.message)); } e.target.value = ''; };
$('#wipe').onclick = async () => {
  if (!confirm('Se borrará el índice, las marcas y los archivos importados de este navegador y TAMBIÉN la copia en la carpeta de datos (si la hay). No se toca ninguna carpeta de documentos ni ningún original. ¿Continuar?')) return;
  await DB.wipe(); await Extras.reset(); await loadIndex(); await refresh(); await runSearch();
};

// ---- base de datos en disco ----
Store.getRoots = () => [...roots.values()].map(r => ({ id: r.id, name: r.name, project: r.project }));
Store.setGhosts = async list => { for (const r of list) if (!roots.has(r.id)) roots.set(r.id, { id: r.id, name: r.name, handle: null, project: r.project }); renderRoots(); await saveRoots(); };
Store.onStatus = t => { $('#datastatus').textContent = t; };
async function afterRestore(n) {
  await loadIndex(); renderRoots(); await refresh(); await runSearch();
  addMsg('ok', `Copia restaurada desde la carpeta de datos: ${n} documentos. Las carpetas de documentos hay que volver a elegirlas con «Añadir carpeta…» (se reconocen por su nombre).`);
}
async function pickDataDir() {
  if (!window.showDirectoryPicker) return addMsg('error', 'Este navegador no permite elegir carpetas. Usa Edge o Chrome.');
  try {
    if (!(await Store.pick())) return;
    if (!(await Store.perm(true))) return addMsg('error', 'Sin permiso de escritura sobre la carpeta de datos.');
    const has = await Store.hasData();
    if (has && (!docsById.size || confirm('La carpeta ya contiene una copia de FEEDBACK.\n\nAceptar = CARGAR esa copia (sustituye el índice actual de este navegador).\nCancelar = CONSERVAR el índice actual y copiarlo a la carpeta (sustituye lo que hubiera allí).'))) await afterRestore(await Store.restore());
    else { if (has) await Store.wipeDir(); await Store.snapshotAll(true); addMsg('ok', 'Copia en disco creada. A partir de ahora se guarda sola tras cada cambio.'); }
  } catch (e) { addMsg('error', esc(e.message)); }
}
$('#dd-pick').onclick = pickDataDir;
async function renderVersions() {
  const vs = await Store.listVersions(), f = n => n.replace(/^(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d).*$/, '$3/$2/$1 $4:$5');
  $('#ver').innerHTML = vs.length ? vs.map(v => `<option value="${v.name}">${f(v.name)} · ${Math.round(v.size / 1024)} KB</option>`).join('') : '<option value="">(sin versiones)</option>';
  $('#ver-restore').disabled = !vs.length;
}
Store.onVersions = renderVersions;
$('#ver-save').onclick = async () => { if (!Store.dir) return pickDataDir(); try { await Store.writeVersion('manual'); await Extras.log('Versión guardada', 'manual'); addMsg('ok', 'Versión guardada. Se conservan las últimas ' + Store.KEEP + '.'); } catch (e) { addMsg('error', esc(e.message)); } };
$('#ver-restore').onclick = async () => {
  const n = $('#ver').value; if (!n || !confirm('Se sustituirá el índice actual por el de la versión elegida (antes se guarda una versión de seguridad del estado actual, por si quieres deshacerlo). ¿Continuar?')) return;
  try { const k = await Store.restoreVersion(n); await afterRestore(k); await Extras.log('Versión restaurada', n); } catch (e) { addMsg('error', esc(e.message)); }
};
$('#dd-save').onclick = async () => { if (!Store.dir) return pickDataDir(); try { if (await Store.snapshotAll(true)) addMsg('ok', 'Copia completa guardada en la carpeta de datos.'); } catch (e) { addMsg('error', esc(e.message)); } };
$('#dd-restore').onclick = async () => {
  if (!Store.dir) return pickDataDir();
  if (docsById.size && !confirm('Se sustituirá el índice actual del navegador por la copia de la carpeta de datos. ¿Continuar?')) return;
  try { await afterRestore(await Store.restore()); } catch (e) { addMsg('error', esc(e.message)); }
};
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') Store.flush().catch(() => {}); });

const panels = initPanels({ setPageText, openViewer, getFile: id => getFileOfDoc(docsById.get(id)), afterChange: () => afterChange(), $, esc, DB, docsById, inProj, pj, fdate, addMsg, runSearch, refreshReport: () => refreshReport(), download, getProject: () => curProject, readSpec, writeSpec, renderDash: () => renderDash() });
// ---- cabecera: proyecto, usuario, tema ----
$('#proj').onchange = async e => { curProject = e.target.value; localStorage.setItem('fb-proj', curProject); selected.clear(); await refresh(); await runSearch(); await refreshReport(); loadCfg(); };
$('#projnew').onclick = async () => {
  const n = (prompt('Nombre del nuevo proyecto o buque:') || '').trim(); if (!n) return;
  if (Extras.d.projects.some(p => p.toLowerCase() === n.toLowerCase())) return addMsg('error', 'Ya existe un proyecto con ese nombre.');
  Extras.d.projects.push(n); await Extras.log('Proyecto creado', n); curProject = n; localStorage.setItem('fb-proj', n); fillProjects(); await refresh(); await runSearch(); loadCfg();
};
$('#user').value = localStorage.getItem('fb-user') || ''; $('#user').onchange = e => { localStorage.setItem('fb-user', e.target.value.trim()); };
const setTheme = t => { document.documentElement.dataset.theme = t; localStorage.setItem('fb-theme', t); $('#theme').textContent = t === 'dark' ? '☀' : '🌙'; };
setTheme(localStorage.getItem('fb-theme') || 'light'); $('#theme').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
document.addEventListener('keydown', e => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);
  if (e.key === '/' && !typing) { e.preventDefault(); $('#q').focus(); $('#q').select(); }
  else if (e.key === 'Escape') { if (typing) e.target.blur(); else if (!$('#detailcard').hidden) $('#detailcard').hidden = true; }
  else if (e.altKey && e.key.toLowerCase() === 'r') { e.preventDefault(); makeReport('res'); }
  else if (e.altKey && e.key.toLowerCase() === 'g') { e.preventDefault(); exportIndex(); }
});

// ---- arranque ----
(async () => {
  await DB.open(); await loadIndex();
  await Store.init(); DB.onChange = (...a) => Store.hook(...a); Store.checkMigration().catch(() => {});
  navigator.storage?.persist?.();
  if (!window.showDirectoryPicker) $('#nofs').hidden = false;
  let saved = await DB.get('meta', 'folders');
  if (!saved) { const old = await DB.get('meta', 'folder'); saved = old ? [{ id: 1, name: old.name, handle: old.handle }] : []; }
  for (const r of saved) roots.set(r.id, r);
  renderRoots();
  if (!docsById.size && Store.dir) {   // el navegador ha perdido sus datos: restaurar desde la copia en disco si hay permiso
    try {
      if ((await Store.perm(false)) && (await Store.hasData())) await afterRestore(await Store.restore());
      else if (await Store.hasData().catch(() => false)) Store.status('hay una copia: pulsa «Restaurar desde la carpeta»');
    } catch { /* se mostrará el estado */ }
  }
  window.__feedback = { Store, setDataDir: h => { Store.dir = h; Store.status(); }, addRoot: h => addRoot(h, false), scan, importFiles, ready: true };   // gancho para pruebas automáticas
  loadCfg(); await refresh(); await runSearch(); renderVersions();
})();
