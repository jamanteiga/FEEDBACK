import { DB } from './db.js';
import { sha256, processPdf, processImage } from './proc.js';

const $ = s => document.querySelector(s);
const esc = s => (s ?? '').toString().replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fdate = s => s ? s.replace('T', ' ').slice(0, 16) : '';
const PDF_EXT = ['pdf'], IMG_EXT = ['jpg', 'jpeg', 'png', 'tif', 'tiff'];
const LOW_CONF = 60;
const extOf = n => (n.split('.').pop() || '').toLowerCase();

// ---- normalización (misma longitud: permite localizar posiciones en el texto original) ----
const normChar = c => { const d = c.normalize('NFD')[0].toLowerCase(); return d.length === 1 ? d : c.toLowerCase()[0]; };
const normLen = s => Array.from(s).map(normChar).join('');
const normTerm = t => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

let mini, root = null, cancel = false, busy = false;
const docsById = new Map();

function newMini() {
  mini = new MiniSearch({
    fields: ['text'], storeFields: ['docId', 'pageNo'], idField: 'id',
    processTerm: t => normTerm(t) || null,
    searchOptions: { prefix: true, combineWith: 'AND', processTerm: t => normTerm(t) || null },
  });
}
const pid = (d, p) => `${d}:${p}`;

async function loadIndex() {
  newMini(); docsById.clear();
  for (const d of await DB.all('docs')) docsById.set(d.id, d);
  const pages = await DB.all('pages');
  mini.addAll(pages.map(p => ({ id: pid(p.docId, p.pageNo), docId: p.docId, pageNo: p.pageNo, text: p.text })));
}

// ---- estado / mensajes ----
const setStatus = (t, cls = '') => { const e = $('#status'); e.className = 'msg ' + cls; e.textContent = t; e.hidden = !t; };
const addMsg = (cls, html) => { $('#upmsgs').insertAdjacentHTML('afterbegin', `<div class="msg ${cls}">${html}</div>`); };

// ---- ingesta ----
async function ingest({ file, buf, key, path, source, via, fileDate }) {
  const name = file.name, ext = extOf(name);
  if (![...PDF_EXT, ...IMG_EXT].includes(ext)) { await DB.addLog('error', name, `Formato no admitido: .${ext}`); return { status: 'error', msg: `Formato no admitido: .${ext}` }; }
  if (!buf.byteLength) { await DB.addLog('error', name, 'Archivo vacío'); return { status: 'error', msg: 'Archivo vacío' }; }
  const sha = await sha256(buf);
  const dups = await DB.byIndex('docs', 'sha', sha);
  const dup = dups.find(d => d.key !== key && d.status === 'ok');
  const kind = PDF_EXT.includes(ext) ? 'pdf' : 'imagen';
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const doc = {
    sha256: sha, key, name, path: path || null, storedName: `${stamp}_${kind}_${sha.slice(0, 8)}.${ext}`,
    kind, mime: file.type || '', source, via, size: buf.byteLength, fileDate, ingestedAt: new Date().toISOString(), pages: 0, status: 'ok',
  };
  if (dup) {
    doc.status = 'duplicado'; doc.error = `Duplicado exacto de #${dup.id} (${dup.path ? dup.path.join('/') : dup.name})`;
    doc.id = await DB.put('docs', doc); docsById.set(doc.id, doc);
    await DB.addLog('duplicado', name, doc.error);
    return { status: 'duplicado', msg: doc.error };
  }
  doc.id = await DB.put('docs', doc);
  try {
    if (source === 'importado') await DB.put('blobs', new Blob([buf], { type: file.type }), doc.id);
    const onP = t => setStatus(`${name}: ${t}`, 'info'), onS = t => setStatus(t, 'info');
    const pages = kind === 'pdf' ? await processPdf(buf, onP, onS) : await processImage(file, buf, onP, onS);
    let low = 0; const mini_docs = [];
    for (const p of pages) {
      await DB.put('pages', { docId: doc.id, pageNo: p.pageNo, method: p.method, conf: p.conf, text: p.text, steps: p.steps });
      if (p.processed) await DB.put('pimg', p.processed, [doc.id, p.pageNo]);
      mini_docs.push({ id: pid(doc.id, p.pageNo), docId: doc.id, pageNo: p.pageNo, text: p.text });
      if (p.conf != null && p.conf < LOW_CONF) low++;
    }
    mini.addAll(mini_docs);
    doc.pages = pages.length; await DB.put('docs', doc); docsById.set(doc.id, doc);
    const msg = `Indexado (${pages.length} pág.)` + (low ? ` — ${low} pág. con OCR de baja confianza` : '');
    await DB.addLog('info', name, msg);
    return { status: 'ok', msg };
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
    else if ([...PDF_EXT, ...IMG_EXT].includes(extOf(name))) yield { handle: h, path: [...path, name] };
  }
}
async function ensurePerm(handle) {
  if (!handle.queryPermission) return true;
  if ((await handle.queryPermission({ mode: 'read' })) === 'granted') return true;
  return (await handle.requestPermission({ mode: 'read' })) === 'granted';
}
async function setRoot(h, remember = true) {
  root = h; $('#foldername').textContent = h.name; $('#scan').disabled = false;
  if (remember) await DB.put('meta', { handle: h, name: h.name }, 'folder');
}
async function pickFolder() {
  if (!window.showDirectoryPicker) return addMsg('error', 'Este navegador no permite elegir carpetas. Usa Edge o Chrome (o arrastra/pega/selecciona archivos).');
  try { const h = await window.showDirectoryPicker({ id: 'feedback-docs', mode: 'read' }); await setRoot(h); await scan(); }
  catch (e) { if (e.name !== 'AbortError') addMsg('error', esc(e.message)); }
}
async function scan() {
  if (!root) return;
  if (busy) return addMsg('error', 'Hay un proceso en marcha; espera a que termine.');
  if (!(await ensurePerm(root))) return addMsg('error', 'Sin permiso de lectura sobre la carpeta.');
  busy = true; cancel = false; $('#cancel').hidden = false;
  let n = { ok: 0, dup: 0, err: 0, skip: 0, mod: 0 };
  try {
    setStatus('Buscando archivos en la carpeta…', 'info');
    const found = []; for await (const e of walk(root)) found.push(e);
    let i = 0;
    for (const e of found) {
      if (cancel) break; i++;
      const key = 'c:' + e.path.join('/');
      const file = await e.handle.getFile();
      const fileDate = new Date(file.lastModified).toISOString();
      const prev = (await DB.byIndex('docs', 'key', key))[0];
      if (prev && prev.size === file.size && prev.fileDate === fileDate && prev.status !== 'error') { n.skip++; continue; }
      if (prev) { await removeDoc(prev.id); n.mod++; await DB.addLog('info', file.name, 'Archivo modificado en la carpeta: se reindexa'); }
      setStatus(`(${i}/${found.length}) ${e.path.join('/')}`, 'info');
      const buf = await file.arrayBuffer();
      const r = await ingest({ file, buf, key, path: e.path, source: 'carpeta', via: 'carpeta', fileDate });
      if (r.status === 'ok') n.ok++; else if (r.status === 'duplicado') n.dup++; else n.err++;
      if (r.status !== 'ok') addMsg(r.status, `<b>${esc(e.path.join('/'))}</b> — ${esc(r.msg)}`);
    }
    addMsg(cancel ? 'duplicado' : 'ok', `${cancel ? 'Interrumpido. ' : 'Carpeta procesada. '}Nuevos: ${n.ok} · ya indexados: ${n.skip} · modificados: ${n.mod} · duplicados: ${n.dup} · errores: ${n.err}`);
  } catch (e) { addMsg('error', 'Error al leer la carpeta: ' + esc(e.message)); }
  finally { busy = false; $('#cancel').hidden = true; setStatus(''); await refresh(); await runSearch(); }
}

// ---- abrir originales ----
async function getFileOfDoc(d) {
  if (d.source === 'importado') {
    const b = await DB.get('blobs', d.id);
    if (!b) throw new Error('El original no está en este navegador (índice importado sin archivos).');
    return b;
  }
  if (!root) throw new Error('Elige primero la carpeta de documentos.');
  if (!(await ensurePerm(root))) throw new Error('Sin permiso sobre la carpeta (pulsa de nuevo y acepta).');
  let h = root;
  for (const seg of d.path.slice(0, -1)) h = await h.getDirectoryHandle(seg);
  return (await (await h.getFileHandle(d.path.at(-1))).getFile());
}
async function openOriginal(id, page) {
  const w = window.open('', '_blank');
  try {
    const d = docsById.get(id); let f = await getFileOfDoc(d);
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
  const okDoc = d => d && d.status === 'ok' && (!kind || d.kind === kind) && (!desde || d.fileDate.slice(0, 10) >= desde) && (!hasta || d.fileDate.slice(0, 10) <= hasta);
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
  $('#results').innerHTML = rows.length ? rows.map(({ d, p, snip }) => {
    const where = d.path ? d.path.join(' / ') : d.name, low = p.conf != null && p.conf < LOW_CONF;
    return `<div class="res"><div class="t"><a href="#" data-open="${d.id}" data-page="${p.pageNo}">${esc(d.name)}</a> <span class="m">· pág. ${p.pageNo}</span></div>
      <div class="s">${snip}</div>
      <div class="m"><span class="tag">${d.kind}</span><span class="tag">${p.method === 'ocr' ? 'OCR ' + Math.round(p.conf) + '%' : 'texto nativo'}</span>
      ${low ? '<span class="tag warn">⚠ OCR de baja confianza: verificar contra el original</span>' : ''}
      ${esc(where)} · archivo de ${fdate(d.fileDate)} · <a href="#" data-detail="${d.id}" data-page="${p.pageNo}">ver texto extraído</a>
      ${d.kind === 'imagen' ? ` · <a href="#" data-proc="${d.id}" data-page="${p.pageNo}">versión procesada</a>` : ''}</div></div>`;
  }).join('') : '<div class="empty">Sin resultados.</div>';
}

async function showDoc(id, page) {
  const d = docsById.get(id), pages = (await DB.byIndex('pages', 'docId', id)).sort((a, b) => a.pageNo - b.pageNo);
  const pg = pages.find(p => p.pageNo === page) || pages[0]; if (!pg) return;
  $('#detailcard').hidden = false;
  $('#detail').innerHTML = `<div><b>${esc(d.name)}</b> <span class="m">→ nombre asignado ${esc(d.storedName)} · SHA-256 ${esc(d.sha256.slice(0, 16))}…</span></div>
    <div class="m">Página ${pg.pageNo} de ${d.pages} · ${pg.method === 'ocr' ? 'OCR (confianza media ' + Math.round(pg.conf) + '%)' : 'texto nativo del PDF'}</div>
    <pre>${esc(pg.text) || '(sin texto)'}</pre>
    <div class="m"><b>Transformaciones aplicadas:</b> ${pg.steps?.length ? pg.steps.map(s => esc(s.step) + ' (' + esc(s.detail) + ')').join(' · ') : 'ninguna (texto nativo)'}</div>
    <div style="margin-top:8px">${pages.map(p => `<a href="#" data-detail="${id}" data-page="${p.pageNo}">p.${p.pageNo}</a>`).join(' · ')}</div>`;
  $('#detailcard').scrollIntoView({ behavior: 'smooth' });
}

async function refresh() {
  const docs = [...docsById.values()].sort((a, b) => b.id - a.id);
  $('#docs').innerHTML = docs.length ? `<table><tr><th>#</th><th>Archivo</th><th>Tipo</th><th>Origen</th><th>Págs</th><th>Indexado</th><th>Estado</th></tr>` +
    docs.map(d => `<tr><td>${d.id}</td><td>${esc(d.path ? d.path.join('/') : d.name)}</td><td>${d.kind}</td><td>${esc(d.via)}</td><td>${d.pages}</td><td>${fdate(d.ingestedAt)}</td>
    <td>${d.status === 'ok' ? `<a href="#" data-open="${d.id}" data-page="1">original</a>` : `<span class="tag warn">${d.status}</span>`}</td></tr>`).join('') + '</table>' : '<div class="empty">Aún no hay documentos.</div>';
  const bad = (await DB.all('log')).filter(l => l.level !== 'info').reverse().slice(0, 100);
  $('#log').innerHTML = bad.length ? bad.map(l => `<div class="msg ${l.level}"><b>${esc(l.filename)}</b> — ${esc(l.message)} <span class="m">(${fdate(l.at)})</span></div>`).join('') : '<div class="empty">Sin incidencias.</div>';
}

// ---- exportar / importar índice ----
async function exportIndex() {
  const data = { app: 'feedback-web', version: 1, exportedAt: new Date().toISOString(), docs: await DB.all('docs'), pages: await DB.all('pages') };
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
  await loadIndex(); await refresh(); await runSearch();
  addMsg('ok', `Índice importado: ${added} documentos añadidos, ${skipped} omitidos. Los archivos de carpeta se abren al elegir la misma carpeta; los importados por arrastrar/pegar no incluyen el original.`);
}

// ---- eventos ----
document.addEventListener('click', e => {
  const t = e.target.closest('[data-open],[data-detail],[data-proc]'); if (!t) return;
  e.preventDefault();
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
  else addMsg('error', 'El origen arrastrado no entregó ningún archivo (típico al arrastrar desde Teams). Prueba Ctrl+V o descarga la imagen.');
});
document.addEventListener('paste', e => {
  const files = [...(e.clipboardData?.files || [])]; if (!files.length) return; e.preventDefault();
  importFiles(files.map((f, i) => (f.name && f.name !== 'image.png') ? f : new File([f], `pegado_${Date.now()}_${i}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: f.type })), 'pegar');
});
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
  const m = await DB.get('meta', 'folder');
  if (m?.handle) { root = m.handle; $('#foldername').textContent = m.name; $('#scan').disabled = false; }
  window.__feedback = { setRoot: h => setRoot(h, false), scan, importFiles, ready: true };   // gancho para pruebas automáticas
  await refresh(); await runSearch();
})();
