// Flujo de trabajo: novedades desde la última visita, bandeja de revisión, edición en bloque y modo solo lectura.
import { DB } from './db.js';
import { Extras } from './extras.js';
import { CHK } from './trace.js';

export function initFlow(c) {
  const { $, esc, docsById, inProj, selected, addMsg, fdate } = c;
  const LV = 'fb-lastvisit';
  let lastVisit = +(localStorage.getItem(LV) || 0), known = null, session = Date.now();
  const okDocs = () => [...docsById.values()].filter(d => d.status === 'ok' && inProj(d) && !d.hidden);

  async function setCheck(d, k, on) {
    d.check = { ...(d.check || {}) };
    if (on) d.check[k] = { by: Extras.user(), at: new Date().toISOString() }; else delete d.check[k];
    if (!Object.keys(d.check).length) delete d.check;
    await DB.put('docs', d);
  }
  const link = d => `<a href="#" data-detail="${d.id}" data-page="1">${esc(d.title || (d.path ? d.path.join('/') : d.name))}</a>`;

  function renderInbox() {
    const box = $('#inbox'); if (!box) return;
    const ds = okDocs(), nuevos = ds.filter(d => lastVisit && Date.parse(d.ingestedAt) > lastVisit).sort((a, b) => b.id - a.id);
    const sinRev = ds.filter(d => !d.check?.rev && !d.parentId).sort((a, b) => b.id - a.id), pen = ds.filter(d => d.check?.pen);
    const reqs = Extras.d.reqs.filter(r => r.status === 'pendiente' && docsById.get(r.docId) && inProj(docsById.get(r.docId)));
    const err = [...docsById.values()].filter(d => d.status === 'error' && inProj(d));
    const sect = (t, n, body) => `<details ${n ? 'open' : ''} style="margin:6px 0"><summary><b>${t}</b> <span class="m">(${n})</span></summary>${n ? body : '<div class="m">Nada pendiente.</div>'}</details>`;
    box.innerHTML = `<h2>Novedades y bandeja de revisión</h2>
      <div class="row"><button id="inb-next" class="sec" ${sinRev.length ? '' : 'disabled'} title="Abre el siguiente documento sin revisar. Dentro del detalle: tecla R = marcar como revisado y pasar al siguiente">Revisar siguiente (${sinRev.length} sin revisar)</button>
        <button id="nv-seen" class="sec" ${nuevos.length ? '' : 'disabled'}>Marcar novedades como vistas</button><span class="m">Última visita: ${lastVisit ? fdate(new Date(lastVisit).toISOString()) : 'primera vez'}</span></div>
      ${sect('Nuevos desde tu última visita', nuevos.length, `<ul style="margin:4px 0">${nuevos.slice(0, 15).map(d => `<li>${link(d)} <span class="m">${esc(d.kind)} · ${fdate(d.ingestedAt)}</span></li>`).join('')}</ul>${nuevos.length > 15 ? `<div class="m">… y ${nuevos.length - 15} más</div>` : ''}`)}
      ${sect('Sin revisar', sinRev.length, `<ul style="margin:4px 0">${sinRev.slice(0, 10).map(d => `<li>${link(d)} <a href="#" data-inb-rev="${d.id}" title="Marcar como revisado">✓ revisado</a></li>`).join('')}</ul>${sinRev.length > 10 ? `<div class="m">… y ${sinRev.length - 10} más (usa «Revisar siguiente»)</div>` : ''}`)}
      ${sect('Pendientes de respuesta o aclaración', pen.length, `<ul style="margin:4px 0">${pen.slice(0, 10).map(d => `<li>${link(d)}</li>`).join('')}</ul>`)}
      ${sect('Requisitos pendientes', reqs.length, `<div class="m">Revísalos en la pestaña <a href="#" data-go="requisitos">Requisitos</a>.</div>`)}
      ${sect('Documentos con error de lectura', err.length, `<ul style="margin:4px 0">${err.slice(0, 10).map(d => `<li>${esc(d.name)} <span class="m">${esc(d.error || '')}</span></li>`).join('')}</ul>`)}`;
  }
  function notifyNew() {   // avisa de documentos que entran mientras trabajas (escaneo automático, importaciones)
    const ids = new Set(okDocs().map(d => d.id));
    if (known) { const nw = [...ids].filter(i => !known.has(i)); if (nw.length) addMsg('ok', `${nw.length} documento(s) nuevo(s) indexado(s): ${nw.slice(0, 4).map(i => esc(docsById.get(i).name)).join(', ')}${nw.length > 4 ? '…' : ''}`); }
    known = ids;
  }
  document.addEventListener('click', async e => {
    const r = e.target.closest('[data-inb-rev]'); if (r) { e.preventDefault(); const d = docsById.get(+r.dataset.inbRev); if (d) { await setCheck(d, 'rev', true); await Extras.log('Lista de comprobación', d.name, 'Revisado: marcado (bandeja)'); await c.refresh(); } return; }
    if (e.target.closest('#nv-seen')) { lastVisit = Date.now(); localStorage.setItem(LV, String(lastVisit)); renderInbox(); return; }
    if (e.target.closest('#inb-next')) return openNext(0);
  });
  const openNext = async (afterId) => {
    const q = okDocs().filter(d => !d.check?.rev && !d.parentId && d.id !== afterId).sort((a, b) => a.id - b.id);
    if (!q.length) return addMsg('ok', 'No quedan documentos sin revisar.');
    await c.showDoc(q[0].id, 1);
  };
  document.addEventListener('keydown', async e => {   // R en el detalle = revisado y siguiente
    if (e.key.toLowerCase() !== 'r' || e.ctrlKey || e.metaKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || !$('#chkbox')) return;
    const id = +($('#chkbox [data-chk]')?.dataset.doc || 0), d = docsById.get(id); if (!d || $('#viewer')) return;
    e.preventDefault(); if (!d.check?.rev) { await setCheck(d, 'rev', true); await Extras.log('Lista de comprobación', d.name, 'Revisado: marcado (atajo R)'); await c.refresh(); }
    await openNext(id);
  });
  // la última visita se actualiza al cerrar/recargar, para que «novedades» sobreviva a la sesión actual
  addEventListener('pagehide', () => localStorage.setItem(LV, String(Date.now())));
  if (!lastVisit) localStorage.setItem(LV, String(Date.now()));

  // ---- edición en bloque ----
  function fillBulk() {
    const sel = $('#be-proj'); if (!sel) return; const cur = sel.value;
    sel.innerHTML = '<option value="">Proyecto: no cambiar</option>' + Extras.d.projects.map(p => `<option>${esc(p)}</option>`).join(''); sel.value = cur;
  }
  $('#be-go')?.addEventListener('click', async () => {
    const ds = [...selected].map(i => docsById.get(i)).filter(Boolean); if (!ds.length) return addMsg('error', 'Marca primero los documentos en la tabla.');
    const tags = $('#be-tags').value.split(',').map(t => t.trim()).filter(Boolean), proj = $('#be-proj').value, chk = $('#be-chk').value, note = $('#be-note').value.trim();
    if (!tags.length && !proj && !chk && !note) return addMsg('error', 'Indica qué quieres aplicar: etiquetas, proyecto, control o nota.');
    if (!confirm(`Se aplicará a ${ds.length} documento(s). ¿Continuar?`)) return;
    for (const d of ds) {
      if (tags.length) { const cur = (d.tags || '').split(',').map(t => t.trim()).filter(Boolean); for (const t of tags) if (!cur.some(x => x.toLowerCase() === t.toLowerCase())) cur.push(t); d.tags = cur.join(', '); }
      if (proj) d.project = proj;
      if (note) d.note = d.note ? d.note + '\n' + note : note;
      if (chk) { const [k, on] = chk.split(':'); await setCheck(d, k, on === '1'); }
      await DB.put('docs', d);
    }
    await Extras.log('Edición en bloque', `${ds.length} documento(s)`, [tags.length && 'etiquetas: ' + tags.join(', '), proj && 'proyecto: ' + proj, chk && 'control: ' + chk, note && 'nota'].filter(Boolean).join(' · '));
    for (const i of ['#be-tags', '#be-note']) $(i).value = ''; $('#be-chk').value = '';
    await c.afterChange(); addMsg('ok', `Aplicado a ${ds.length} documento(s).`);
  });
  const chkOpts = $('#be-chk'); if (chkOpts) chkOpts.innerHTML = '<option value="">Control: no cambiar</option>' + CHK.flatMap(([k, l]) => [`<option value="${k}:1">Marcar: ${l}</option>`, `<option value="${k}:0">Desmarcar: ${l}</option>`]).join('');

  // ---- modo solo lectura ----
  const ro = $('#ro');
  const applyRo = on => { DB.readonly = on; Extras.readonly = on; document.body.dataset.ro = on ? '1' : ''; try { localStorage.setItem('fb-ro', on ? '1' : ''); } catch { /* sin almacenamiento */ } if (ro) ro.checked = on; $('#robar').hidden = !on; };
  ro?.addEventListener('change', () => applyRo(ro.checked)); applyRo(localStorage.getItem('fb-ro') === '1');


  // ---- vínculos entre documentos ----
  const LT = ['responde a', 'sustituye a', 'complementa a', 'hace referencia a', 'contradice a'], LCOL = { 'responde a': '#1f5fbf', 'sustituye a': '#b45309', 'complementa a': '#2e7d32', 'hace referencia a': '#6b7585', 'contradice a': '#c62828' };
  const nm = d => d.title || (d.path ? d.path.at(-1) : d.name);
  function linksHtml(d) {
    const out = (d.links || []).filter(l => docsById.get(l.to)), inc = [...docsById.values()].flatMap(x => (x.links || []).filter(l => l.to === d.id && docsById.has(x.id)).map(l => ({ from: x, type: l.type })));
    const opts = [...docsById.values()].filter(x => x.id !== d.id && x.status === 'ok' && inProj(x)).sort((a, b) => b.id - a.id).map(x => `<option value="${x.id}">#${x.id} · ${esc(nm(x).slice(0, 70))}</option>`).join('');
    return `<div id="lkbox"><details style="margin-top:8px" ${out.length || inc.length ? 'open' : ''}><summary><b>🔗 Vínculos con otros documentos</b> <span class="m">${out.length + inc.length ? `${out.length} salientes · ${inc.length} entrantes` : 'sin vínculos'}</span></summary>
      <ul style="margin:6px 0">${out.map((l, i) => `<li>Este documento <b>${esc(l.type)}</b> <a href="#" data-detail="${l.to}" data-page="1">${esc(nm(docsById.get(l.to)))}</a> <a href="#" data-lk-del="${i}" data-doc="${d.id}" title="Quitar vínculo">✕</a></li>`).join('')}
        ${inc.map(x => `<li><a href="#" data-detail="${x.from.id}" data-page="1">${esc(nm(x.from))}</a> <b>${esc(x.type)}</b> este documento</li>`).join('')}</ul>
      <div class="row"><span class="m">Este documento</span><select id="lk-type">${LT.map(t => `<option>${t}</option>`).join('')}</select><select id="lk-to" style="max-width:340px"><option value="">(elige documento)</option>${opts}</select><button id="lk-add" class="sec" data-doc="${d.id}">Vincular</button></div></details></div>`;
  }
  document.addEventListener('click', async e => {
    const add = e.target.closest('#lk-add'), del = e.target.closest('[data-lk-del]'); if (!add && !del) return; e.preventDefault();
    const d = docsById.get(+(add || del).dataset.doc); if (!d) return;
    if (add) { const to = +$('#lk-to').value; if (!to) return addMsg('error', 'Elige el documento con el que vincular.'); const type = $('#lk-type').value; d.links = [...(d.links || []).filter(l => !(l.to === to && l.type === type)), { to, type }]; await DB.put('docs', d); await Extras.log('Vínculo creado', d.name, `${type} ${docsById.get(to)?.name}`); }
    else { d.links = (d.links || []).filter((_, i) => i !== +del.dataset.lkDel); if (!d.links.length) delete d.links; await DB.put('docs', d); await Extras.log('Vínculo quitado', d.name); }
    const box = $('#lkbox'); if (box) box.outerHTML = linksHtml(d); renderGraph();
  });
  function renderGraph() {
    const box = $('#graph'); if (!box || !box.open) return;
    const edges = []; for (const d of docsById.values()) { if (!inProj(d) || d.status === 'papelera') continue;
      for (const l of d.links || []) if (docsById.has(l.to)) edges.push({ a: d.id, b: l.to, t: l.type });
      if (d.superseded?.by && docsById.has(d.superseded.by)) edges.push({ a: d.superseded.by, b: d.id, t: 'sustituye a' });
      if (d.parentId && docsById.has(d.parentId)) edges.push({ a: d.id, b: d.parentId, t: 'adjunto de' }); }
    const ids = [...new Set(edges.flatMap(x => [x.a, x.b]))];
    if (!ids.length) { $('#graph-svg').innerHTML = '<div class="m">Aún no hay vínculos. Créalos en el detalle de cada documento («🔗 Vínculos»); las revisiones sustituidas y los adjuntos aparecen solos.</div>'; return; }
    const W = 900, H = Math.max(420, Math.min(900, ids.length * 26)), R = Math.min(W, H) / 2 - 90, pos = new Map(ids.map((id, i) => { const a = i / ids.length * 2 * Math.PI - Math.PI / 2; return [id, [W / 2 + R * 1.25 * Math.cos(a), H / 2 + R * Math.sin(a)]]; }));
    const col = t => LCOL[t] || '#8a94a6', short = id => { const n = nm(docsById.get(id)); return n.length > 26 ? n.slice(0, 25) + '…' : n; };
    const lines = edges.map(x => { const [x1, y1] = pos.get(x.a), [x2, y2] = pos.get(x.b); const mx = (x1 + x2) / 2, my = (y1 + y2) / 2; return `<g><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col(x.t)}" stroke-width="1.6" marker-end="url(#ar)"/><text x="${mx}" y="${my}" font-size="10" fill="${col(x.t)}" text-anchor="middle">${esc(x.t)}</text></g>`; }).join('');
    const nodes = ids.map(id => { const [x, y] = pos.get(id); return `<g data-detail="${id}" data-page="1" style="cursor:pointer"><circle cx="${x}" cy="${y}" r="6" fill="#1c2430"/><text x="${x + (x > W / 2 ? 10 : -10)}" y="${y + 4}" font-size="11" text-anchor="${x > W / 2 ? 'start' : 'end'}" fill="currentColor">${esc(short(id))}</text></g>`; }).join('');
    $('#graph-svg').innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-height:70vh"><defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#8a94a6"/></marker></defs>${lines}${nodes}</svg><div class="m">${Object.entries(LCOL).map(([t, c]) => `<span style="color:${c}">■</span> ${t}`).join(' · ')} · <span style="color:#8a94a6">■</span> adjunto de</div>`;
  }
  $('#graph')?.addEventListener('toggle', renderGraph);

  return { render() { fillBulk(); renderInbox(); notifyNew(); renderGraph(); }, setCheck, linksHtml };
}
