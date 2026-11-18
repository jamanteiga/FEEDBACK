// Paneles de control de requisitos: requisitos con estado, revisión de valores/discrepancias, búsquedas guardadas, hilos y sinónimos.
import { Extras } from './extras.js';
import { analyze } from './report.js';
import { packXlsx } from './export.js';

const normTerm = t => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const DEF_SYN = ['caudal, flujo, gasto', 'conducto, tubería, canalización', 'ventilador, extractor', 'temperatura, tª', 'aislamiento, aislante', 'm3/h, m³/h', 'presión, presion'];
export const synGroups = () => (Extras.d.syn ?? DEF_SYN).map(l => l.split(',').map(x => x.trim()).filter(Boolean)).filter(g => g.length > 1);
export function synVariants(word) {   // devuelve la palabra y sus sinónimos (si los tiene)
  const w = normTerm(word.trim()); if (w.includes(' ')) return [word];
  const g = synGroups().find(g => g.some(x => normTerm(x) === w)); return g ? g : [word];
}
export const STATUS = ['pendiente', 'aceptado', 'descartado', 'conflicto'];
const CATS = ['Velocidades', 'Caudales', 'Presiones', 'Temperaturas', 'Espesores / dimensiones', 'Requisitos acústicos', 'Normativa y referencias'];
const numsOf = s => (s.match(/\d+(?:[.,]\d+)?/g) || []).map(x => +x.replace(',', '.'));
const unitOf = s => normTerm(s.replace(/-?\d+(?:[.,]\d+)?(?:\s*[-–a]\s*\d+(?:[.,]\d+)?)?/, '')).replace(/[\s³]/g, m => m === '³' ? '3' : '').replace(/^º/, '°');

export function initPanels(c) {
  const { $, esc, DB, docsById, inProj, pj, fdate, addMsg, runSearch, refreshReport, download, getProject, readSpec } = c;
  const docName = id => { const d = docsById.get(id); return d ? (d.title || d.subject || d.name) : null; };
  const reqsInProj = () => Extras.d.reqs.filter(r => { const d = docsById.get(r.docId); return d ? inProj(d) : !getProject(); });

  // ---------- requisitos ----------
  async function addReq({ docId, pageNo, text, status = 'pendiente', group = '', note = '' }) {
    text = (text || '').replace(/\s+/g, ' ').trim(); if (!text) return null;
    if (Extras.d.reqs.some(r => r.docId === docId && r.pageNo === pageNo && r.text === text)) return null;
    const r = { id: Extras.d.nextReq++, docId, pageNo, text: text.slice(0, 1000), status, group, note, link: '', owner: '', due: '', at: new Date().toISOString(), by: Extras.user() };
    Extras.d.reqs.push(r); await Extras.log('Requisito añadido', docName(docId) || '', `${status}: ${text.slice(0, 80)}`); return r;
  }
  const today = () => new Date().toISOString().slice(0, 10), open = r => r.status === 'pendiente' || r.status === 'conflicto';
  const overdue = r => open(r) && r.due && r.due < today();
  const reqRow = r => {
    const d = docsById.get(r.docId);
    return `<tr><td>${r.id}</td><td>${esc(r.text.length > 320 ? r.text.slice(0, 317) + '…' : r.text)}</td>
      <td>${d ? `<a href="#" data-detail="${r.docId}" data-page="${r.pageNo}">${esc(docName(r.docId))}</a> <span class="m">pág. ${r.pageNo}</span>` : '<span class="tag warn">origen eliminado</span>'}</td>
      <td><select data-reqstatus="${r.id}">${STATUS.map(s => `<option ${s === r.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
      <td>${esc(r.group || '')} <a href="#" data-reqgroup="${r.id}" title="Editar concepto">✎</a></td>
      <td>${esc(r.link || '')} <a href="#" data-reqlink="${r.id}" title="Vincular a equipo, sistema, plano o cálculo (separa varios con comas)">✎</a></td>
      <td>${esc(r.owner || '')} <a href="#" data-reqowner="${r.id}" title="Responsable">✎</a><br><input type="date" data-reqdue="${r.id}" value="${esc(r.due || '')}" style="padding:2px 4px;font-size:12px;${overdue(r) ? 'border-color:#b42318;color:#b42318' : ''}" title="Fecha límite"></td>
      <td>${esc(r.note || '')} <a href="#" data-reqnote="${r.id}" title="Editar nota">✎</a></td><td><a href="#" data-reqdel="${r.id}" title="Eliminar requisito">✕</a></td></tr>`;
  };
  const HEAD = '<tr><th>#</th><th>Requisito (texto literal)</th><th>Origen</th><th>Estado</th><th>Concepto</th><th>Vinculado a</th><th>Resp. / vence</th><th>Nota</th><th></th></tr>';
  async function renderReqs() {
    const fs = $('#rq-status').value, ft = normTerm($('#rq-txt').value.trim()), fd = $('#rq-due').value, view = $('#rq-view').value, t0 = today(), t14 = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
    const rs = reqsInProj().filter(r => (!fs || (fs === 'abiertos' ? open(r) : r.status === fs)) && (!ft || normTerm([r.text, r.group, r.note, r.link, r.owner].join(' ')).includes(ft))
      && (!fd || (fd === 'vencidos' ? overdue(r) : fd === 'proximos' ? open(r) && r.due && r.due >= t0 && r.due <= t14 : !r.due)));
    const nOver = reqsInProj().filter(overdue).length;
    $('#rq-count').textContent = `${rs.length} de ${reqsInProj().length}${nOver ? ` · ${nOver} vencido(s)` : ''}`;
    if (!rs.length) { $('#reqs').innerHTML = '<div class="empty">Sin requisitos. Selecciona texto en el detalle de un documento y pulsa «Añadir selección como requisito», o añádelos desde la revisión de valores.</div>'; return; }
    if (view !== 'sistema') { $('#reqs').innerHTML = `<table>${HEAD}${rs.map(reqRow).join('')}</table>`; return; }
    const g = new Map(); for (const r of rs) for (const k of (r.link ? r.link.split(',').map(x => x.trim()).filter(Boolean) : ['(sin vincular)'])) (g.get(k) || g.set(k, []).get(k)).push(r);
    $('#reqs').innerHTML = [...g].sort((a, b) => a[0].localeCompare(b[0], 'es')).map(([k, l]) => {
      const ab = l.filter(open).length; return `<details open style="margin-top:6px"><summary><b>${esc(k)}</b> — ${l.length} requisito(s) · <span class="${ab ? 'tag warn' : 'tag'}">${ab} abierto(s)</span>${l.some(overdue) ? ' <span class="tag warn">hay vencidos</span>' : ''}</summary><table>${HEAD}${l.map(reqRow).join('')}</table></details>`;
    }).join('');
  }
  const reqById = id => Extras.d.reqs.find(r => r.id === id);
  async function changed() { await Extras.save(); await renderReqs(); c.renderDash?.(); await refreshReport(); }
  document.addEventListener('change', async e => {
    const dd = e.target.closest('[data-reqdue]');
    if (dd) { const r = reqById(+dd.dataset.reqdue); if (!r) return; r.due = dd.value; await Extras.log('Fecha límite de requisito', `#${r.id}`, r.due); return changed(); }
    const s = e.target.closest('[data-reqstatus]'); if (!s) return;
    const r = reqById(+s.dataset.reqstatus); if (!r) return; const old = r.status; r.status = s.value;
    await Extras.log('Estado de requisito', `#${r.id}`, `${old} → ${r.status}`); await changed();
  });
  document.addEventListener('click', async e => {
    const t = e.target.closest('[data-reqdel],[data-reqnote],[data-reqgroup],[data-reqlink],[data-reqowner],[data-reqmark],#rq-add'); if (!t) return;
    e.preventDefault();
    if (t.id === 'rq-add') return;
    if (t.dataset.reqmark) { const m = await DB.get('marks', +t.dataset.reqmark); const r = await addReq({ docId: m.docId, pageNo: m.pageNo, text: m.text }); await changed(); return addMsg(r ? 'ok' : 'duplicado', r ? 'Añadido a requisitos.' : 'Ese texto ya está en requisitos.'); }
    const r = reqById(+(t.dataset.reqdel || t.dataset.reqnote || t.dataset.reqgroup || t.dataset.reqlink || t.dataset.reqowner)); if (!r) return;
    if (t.dataset.reqdel) { if (!confirm('¿Eliminar este requisito de la lista?')) return; Extras.d.reqs = Extras.d.reqs.filter(x => x !== r); await Extras.log('Requisito eliminado', `#${r.id}`); }
    else if (t.dataset.reqnote) { const n = prompt('Nota:', r.note || ''); if (n === null) return; r.note = n.trim(); await Extras.log('Nota de requisito', `#${r.id}`); }
    else if (t.dataset.reqlink) { const n = prompt('Vincular a (equipo, sistema, plano, cálculo…; varios separados por comas). Ej.: VEN-101, Cocina – extracción', r.link || ''); if (n === null) return; r.link = n.split(',').map(x => x.trim()).filter(Boolean).join(', '); await Extras.log('Requisito vinculado', `#${r.id}`, r.link); }
    else if (t.dataset.reqowner) { const n = prompt('Responsable:', r.owner || ''); if (n === null) return; r.owner = n.trim(); await Extras.log('Responsable de requisito', `#${r.id}`, r.owner); }
    else { const n = prompt('Concepto / sistema al que se refiere (p. ej. «Cocina – extracción»):', r.group || ''); if (n === null) return; r.group = n.trim(); await Extras.log('Concepto de requisito', `#${r.id}`, r.group); }
    await changed();
  });
  for (const id of ['rq-status', 'rq-txt', 'rq-due', 'rq-view']) $('#' + id).oninput = renderReqs;
  $('#rq-xlsx').onclick = () => {
    const rs = reqsInProj(); if (!rs.length) return addMsg('error', 'No hay requisitos que exportar.');
    download(packXlsx([{ name: 'Requisitos', widths: [6, 70, 34, 8, 14, 26, 26, 18, 12, 28, 18], rows: [['#', 'Requisito (literal)', 'Documento', 'Pág.', 'Estado', 'Concepto', 'Vinculado a', 'Responsable', 'Vence', 'Nota', 'Añadido'], ...rs.map(r => [r.id, r.text, docName(r.docId) || '(origen eliminado)', r.pageNo, r.status, r.group || '', r.link || '', r.owner || '', r.due || '', r.note || '', fdate(r.at)])] }]), `feedback-requisitos-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // ---------- revisión de valores y discrepancias ----------
  let rvRows = [];
  $('#rv-cat').innerHTML = '<option value="">Todas las categorías</option>' + CATS.map(x => `<option>${x}</option>`).join('');
  function parseRange(s) {
    s = s.trim().replace(',', '.'); if (!s) return null;
    const m = s.match(/^(>=|<=|>|<)?\s*(-?\d+(?:\.\d+)?)\s*(?:[-–]|a|y)?\s*(\d+(?:\.\d+)?)?\s*(.*)$/i); if (!m) return null;
    let min = +m[2], max = m[3] != null ? +m[3] : +m[2];
    if (m[1] === '>' || m[1] === '>=') max = Infinity; else if (m[1] === '<' || m[1] === '<=') { max = min; min = -Infinity; }
    return { min, max, unit: unitOf(' ' + (m[4] || '')) };
  }
  async function renderRv() {
    const cat = $('#rv-cat').value, ft = normTerm($('#rv-txt').value.trim()), rg = parseRange($('#rv-range').value);
    rvRows = [];
    for (const d of docsById.values()) {
      if (d.status !== 'ok' || !inProj(d)) continue;
      const pages = (await DB.byIndex('pages', 'docId', d.id)).sort((a, b) => a.pageNo - b.pageNo);
      for (const v of analyze(pages).values) {
        if (v.value === '—' || (cat && v.cat !== cat) || !CATS.includes(v.cat)) continue;
        const nums = numsOf(v.value), unit = v.cat === 'Normativa y referencias' ? '' : unitOf(v.value);
        if (ft && !normTerm(v.ctx + ' ' + (d.title || d.name)).includes(ft)) continue;
        if (rg) { if (!nums.length || (rg.unit && unit !== rg.unit)) continue; const lo = Math.min(...nums), hi = Math.max(...nums); if (hi < rg.min || lo > rg.max) continue; }
        rvRows.push({ ...v, docId: d.id, doc: d.title || d.subject || d.name, date: (d.emailDate || d.fileDate || '').slice(0, 10), nums, unit });
        if (rvRows.length >= 600) break;
      }
      if (rvRows.length >= 600) break;
    }
    const groups = new Map(); rvRows.forEach((r, i) => { const k = r.cat + (r.unit ? ' · ' + r.unit : ''); (groups.get(k) || groups.set(k, []).get(k)).push(i); });
    $('#rv').innerHTML = rvRows.length ? [...groups].map(([k, idx]) => {
      const vals = new Set(idx.map(i => rvRows[i].nums.join('-') || rvRows[i].value)), docs = new Set(idx.map(i => rvRows[i].docId)), diff = vals.size > 1 && docs.size > 1;
      return `<details ${idx.length < 25 || diff ? 'open' : ''} style="margin-top:8px"><summary><b>${esc(k)}</b> — ${idx.length} valor(es) en ${docs.size} documento(s) ${diff ? `<span class="tag warn">${vals.size} valores distintos: revisar</span>` : ''}</summary>
      <table><tr><th></th><th>Valor</th><th>Texto literal</th><th>Documento</th><th>Fecha</th></tr>${idx.map(i => { const r = rvRows[i]; return `<tr><td><input type="checkbox" data-rv="${i}"></td><td><b>${esc(r.value)}</b></td><td>${esc(r.ctx)}</td><td><a href="#" data-detail="${r.docId}" data-page="${r.pageNo}">${esc(r.doc)}</a> <span class="m">${esc(String(r.page))}</span></td><td>${esc(r.date)}</td></tr>`; }).join('')}</table></details>`;
    }).join('') + `<div class="m" style="margin-top:6px">${rvRows.length >= 600 ? 'Se muestran los primeros 600. ' : ''}«Valores distintos» solo indica que el mismo tipo de magnitud aparece con cifras diferentes en documentos distintos; puede no referirse al mismo local o sistema. Acota con el filtro de texto. No se decide cuál prevalece.</div>` : '<div class="empty">Sin valores con ese filtro.</div>';
  }
  async function rvToReq(status) {
    const sel = [...document.querySelectorAll('[data-rv]:checked')].map(x => rvRows[+x.dataset.rv]); if (!sel.length) return addMsg('error', 'Marca antes las filas de la tabla.');
    const grp = status === 'conflicto' ? (prompt('Concepto común de estos valores (p. ej. «Local de máquinas – caudal»):', sel[0].cat) || sel[0].cat) : '';
    let n = 0; for (const r of sel) if (await addReq({ docId: r.docId, pageNo: r.pageNo, text: r.ctx, status, group: grp })) n++;
    await changed(); addMsg('ok', `${n} requisito(s) añadidos${status === 'conflicto' ? ' con estado «conflicto»' : ''}.`);
  }
  $('#rv-go').onclick = renderRv; $('#rv-req').onclick = () => rvToReq('pendiente'); $('#rv-conf').onclick = () => rvToReq('conflicto');
  $('#rv-range').onkeydown = $('#rv-txt').onkeydown = e => { if (e.key === 'Enter') renderRv(); };
  $('#syn').value = (Extras.d.syn ?? DEF_SYN).join('\n');
  $('#syn-save').onclick = async () => { Extras.d.syn = $('#syn').value.split('\n').map(x => x.trim()).filter(Boolean); await Extras.save(); await Extras.log('Sinónimos actualizados'); await runSearch(); addMsg('ok', 'Sinónimos guardados: se aplican a las búsquedas.'); };

  // ---------- búsquedas guardadas ----------
  async function updateBadges() {
    const sel = $('#ss'), cur = sel.value; const list = Extras.d.searches.filter(s => !s.project || !getProject() || s.project === getProject());
    const opts = [];
    for (const s of list) { const ids = await runSearch(s.spec, false); const n = ids.filter(i => !(s.seen || []).includes(i)).length; opts.push(`<option value="${s.id}">${esc(s.name)}${n ? ` (+${n} nuevos)` : ''}</option>`); }
    sel.innerHTML = '<option value="">Búsquedas guardadas…</option>' + opts.join(''); sel.value = cur;
  }
  $('#ss-save').onclick = async () => {
    const spec = readSpec(); if (!spec.q && !spec.asunto && !spec.remitente && !spec.etiqueta) return addMsg('error', 'Escribe primero algo que buscar.');
    const name = (prompt('Nombre de la búsqueda guardada:', spec.q || spec.asunto || spec.remitente) || '').trim(); if (!name) return;
    const ids = await runSearch(spec, false);
    Extras.d.searches.push({ id: Date.now(), name, spec, project: getProject(), seen: ids, at: new Date().toISOString() }); await Extras.log('Búsqueda guardada', name); await Extras.save(); await updateBadges();
  };
  $('#ss').onchange = async e => {
    const s = Extras.d.searches.find(x => String(x.id) === e.target.value); if (!s) return;
    c.writeSpec(s.spec); const ids = await runSearch(s.spec, true); const nuevos = ids.filter(i => !(s.seen || []).includes(i));
    addMsg(nuevos.length ? 'duplicado' : 'ok', nuevos.length ? `«${esc(s.name)}»: ${nuevos.length} documento(s) nuevos desde la última vez: ${nuevos.map(i => esc(docName(i) || i)).join(', ')}` : `«${esc(s.name)}»: sin documentos nuevos desde la última vez.`);
    s.seen = ids; await Extras.save(); await updateBadges();
  };
  $('#ss-del').onclick = async () => { const id = $('#ss').value; if (!id || !confirm('¿Borrar esta búsqueda guardada?')) return; Extras.d.searches = Extras.d.searches.filter(x => String(x.id) !== id); await Extras.save(); await updateBadges(); };

  // ---------- hilos de correo ----------
  function renderThreads() {
    const mails = [...docsById.values()].filter(d => d.kind === 'correo' && d.status === 'ok' && inProj(d));
    const th = new Map(); for (const m of mails) { const k = normTerm((m.subject || '(sin asunto)').replace(/^\s*((re|rv|fw|fwd|enc|r)\s*:\s*)+/i, '')).trim(); (th.get(k) || th.set(k, []).get(k)).push(m); }
    const list = [...th.values()].map(a => a.sort((x, y) => (x.emailDate || '').localeCompare(y.emailDate || ''))).sort((a, b) => (b.at(-1).emailDate || '').localeCompare(a.at(-1).emailDate || ''));
    $('#threads').innerHTML = list.length ? list.map(a => `<div style="margin:6px 0"><b>${esc((a[0].subject || '(sin asunto)').replace(/^\s*((re|rv|fw|fwd|enc|r)\s*:\s*)+/i, ''))}</b> <span class="m">${a.length} correo(s) · ${esc((a[0].emailDate || '').slice(0, 10))} → ${esc((a.at(-1).emailDate || '').slice(0, 10))}</span>
      <div class="m" style="margin-left:12px">${a.map(m => `<a href="#" data-detail="${m.id}" data-page="1">${esc((m.emailDate || '').slice(0, 10))} ${esc((m.sender || '').replace(/<.*>/, '').trim() || m.sender || '')}</a> (${(m.attachments || []).filter(x => x.docId).length} adj.)`).join(' → ')}</div></div>`).join('') : '<div class="empty">Sin correos.</div>';
  }

  // ---------- revisión de OCR (imagen / texto lado a lado) ----------
  let oc = [], ocI = 0;
  async function renderOcr() {
    const det = $('#ocrdet'); if (!det.open) return;
    oc = []; for (const pg of await DB.all('pages')) { const d = docsById.get(pg.docId); if (d && d.status === 'ok' && inProj(d) && pg.conf != null && pg.conf < 60 && !pg.reviewed && !pg.edited) oc.push({ docId: pg.docId, pageNo: pg.pageNo }); }
    oc.sort((a, b) => a.docId - b.docId || a.pageNo - b.pageNo); ocI = Math.min(ocI, Math.max(0, oc.length - 1));
    $('#oc-count').textContent = oc.length ? `${oc.length} página(s) con confianza < 60 % pendientes` : 'ninguna pendiente';
    if (!oc.length) { $('#ocr').innerHTML = '<div class="empty">No hay páginas de OCR dudoso pendientes de revisar.</div>'; return; }
    const cur = oc[ocI], pg = await DB.get('pages', [cur.docId, cur.pageNo]), im = await DB.get('pimg', [cur.docId, cur.pageNo]), d = docsById.get(cur.docId);
    if (ocUrl) URL.revokeObjectURL(ocUrl); ocUrl = im ? URL.createObjectURL(im) : '';
    $('#ocr').innerHTML = `<div class="row" style="margin:6px 0"><button class="sec" data-oc="prev">◀</button><b>${ocI + 1} / ${oc.length}</b><button class="sec" data-oc="next">▶</button><span class="m">${esc(docName(cur.docId))} · pág. ${cur.pageNo} · confianza ${Math.round(pg.conf)} %</span></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div style="max-height:380px;overflow:auto;border:1px solid var(--line);border-radius:6px;background:#fff">${ocUrl ? `<img src="${ocUrl}" style="width:100%">` : '<div class="m" style="padding:10px">No hay imagen procesada guardada. <a href="#" data-oc="view">Abrir en el visor</a></div>'}</div>
      <textarea id="oc-text" style="width:100%;height:380px;font-family:monospace">${esc(pg.text)}</textarea></div>
      <div class="row" style="margin-top:6px"><button data-oc="save">Guardar corrección y siguiente</button><button class="sec" data-oc="ok">Está bien: marcar como revisada</button>${ocUrl ? '' : ''}<a href="#" data-oc="view">abrir original en visor</a></div>`;
  }
  let ocUrl = '';
  $('#ocrdet').addEventListener('toggle', renderOcr);
  document.addEventListener('click', async e => {
    const t = e.target.closest('[data-oc]'); if (!t) return; e.preventDefault(); const a = t.dataset.oc, cur = oc[ocI];
    if (a === 'prev') ocI = (ocI - 1 + oc.length) % oc.length; else if (a === 'next') ocI = (ocI + 1) % oc.length;
    else if (a === 'view' && cur && docsById.get(cur.docId)?.kind === 'pdf') { c.openViewer({ blob: await c.getFile(cur.docId), name: docName(cur.docId), pageNo: cur.pageNo }); return; }
    else if (a === 'save') { await c.setPageText(cur.docId, cur.pageNo, $('#oc-text').value); await Extras.log('OCR corregido', docName(cur.docId), `pág. ${cur.pageNo}`); return; }
    else if (a === 'ok') { const pg = await DB.get('pages', [cur.docId, cur.pageNo]); pg.reviewed = true; await DB.put('pages', pg); await Extras.log('OCR revisado sin cambios', docName(cur.docId), `pág. ${cur.pageNo}`); }
    await renderOcr();
  });

  return { overdueCount: () => reqsInProj().filter(overdue).length, renderOcr, renderReqs, renderRv, updateBadges, renderThreads, addReq, reqsInProj, changed, STATUS };
}
