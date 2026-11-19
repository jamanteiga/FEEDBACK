// Previsualización universal a pantalla completa: imágenes (con su texto OCR al lado) y documentos/correos/hojas/presentaciones (texto extraído por partes).
// Los términos buscados se resaltan. El original no se modifica.
import { decorate, leaveFs } from './vwin.js';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nch = c => { const d = c.normalize('NFD').charAt(0).toLowerCase(); return d || c; };
const nstr = s => s.split('').map(nch).join('');   // misma longitud que el texto original (unidad a unidad)
export function highlight(text, terms) {
  const n = nstr(text), ts = [...new Set((terms || []).map(t => nstr(t.trim())).filter(t => t.length >= 2))], mark = new Uint8Array(text.length);
  for (const t of ts) { let i = -1; while ((i = n.indexOf(t, i + 1)) >= 0) mark.fill(1, i, i + t.length); }
  let out = '', i = 0, hits = 0;
  while (i < text.length) {
    if (mark[i]) { let j = i; while (j < text.length && mark[j]) j++; out += `<mark class="vm">${esc(text.slice(i, j))}</mark>`; hits++; i = j; }
    else { let j = i; while (j < text.length && !mark[j]) j++; out += esc(text.slice(i, j)); i = j; }
  }
  return { html: out, hits };
}
async function imageUrl(blob, ext) {
  if (ext === 'tif' || ext === 'tiff') {
    const buf = await blob.arrayBuffer(), ifd = UTIF.decode(buf)[0]; UTIF.decodeImage(buf, ifd);
    const c = document.createElement('canvas'); c.width = ifd.width; c.height = ifd.height;
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(UTIF.toRGBA8(ifd)), ifd.width, ifd.height), 0, 0);
    return URL.createObjectURL(await new Promise(r => c.toBlob(r, 'image/png')));
  }
  return URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: 'image/' + (ext === 'jpg' ? 'jpeg' : ext) }));
}
export async function openPreview({ blob, name, file, ext, kind, pages = [], pageNo = 1, terms = [], fmt = p => p.text }) {
  document.getElementById('viewer')?.remove();
  const isImg = kind === 'imagen', wrap = document.createElement('div'); wrap.id = 'viewer';
  wrap.innerHTML = `<div class="vwin"><div class="vbar"><b class="vname">${esc(name)}</b><span class="m">${esc((ext || '').toUpperCase())}</span>
    <button class="sec" data-v="prev">◀</button><span class="vpg"></span><button class="sec" data-v="next">▶</button>
    ${isImg ? '<button class="sec" data-v="out">−</button><button class="sec" data-v="in">＋</button>' : ''}
    <button class="sec" data-v="hp" title="Coincidencia anterior">▲</button><button class="sec" data-v="hn" title="Coincidencia siguiente">▼</button><span class="m vhits"></span>
    <span style="flex:1"></span><button class="sec" data-v="dl">Descargar original</button></div>
    <div class="vbody pv" style="padding:0;display:flex;overflow:hidden">${isImg ? '<div class="pvimg"><img alt=""></div>' : ''}<div class="pvtxt"><pre></pre></div></div></div>`;
  document.body.appendChild(wrap);
  let url = '', zoom = 1, hi = -1, idx = Math.max(0, pages.findIndex(p => p.pageNo === pageNo));
  const pre = wrap.querySelector('pre'), img = wrap.querySelector('img'), pvtxt = wrap.querySelector('.pvtxt');
  const close = () => { document.removeEventListener('keydown', onKey); if (url) URL.revokeObjectURL(url); leaveFs(); wrap.remove(); };
  const marks = () => [...pre.querySelectorAll('mark')];
  const goHit = d => { const m = marks(); if (!m.length) return; m[hi]?.classList.remove('cur'); hi = (hi + d + m.length) % m.length; m[hi].classList.add('cur'); m[hi].scrollIntoView({ block: 'center' }); wrap.querySelector('.vhits').textContent = `coincidencia ${hi + 1} de ${m.length} en esta parte`; };
  const onKey = e => { if (e.target.closest?.('input,textarea')) return; if (e.key === 'Escape') close(); else if (e.key === 'ArrowRight') go(1); else if (e.key === 'ArrowLeft') go(-1); else if (e.key === 'F3' || e.key === 'Enter') { e.preventDefault(); goHit(e.shiftKey ? -1 : 1); } };
  document.addEventListener('keydown', onKey);
  function show() {
    const p = pages[idx]; hi = -1;
    if (!p) { pre.textContent = '(este fichero no tiene texto extraído)'; wrap.querySelector('.vpg').textContent = ''; return; }
    const { html, hits } = highlight(fmt(p) || '(sin texto)', terms);
    pre.innerHTML = html; pvtxt.scrollTop = 0;
    wrap.querySelector('.vpg').textContent = `${p.label ? p.label[0].toUpperCase() + p.label.slice(1) : 'Parte ' + p.pageNo} (${idx + 1} de ${pages.length})`;
    wrap.querySelector('.vhits').textContent = terms.length ? `${hits} coincidencia(s) en esta parte` : '';
    if (hits) goHit(1);
  }
  const go = d => { if (!pages.length) return; idx = Math.min(pages.length - 1, Math.max(0, idx + d)); show(); };
  wrap.addEventListener('click', e => {
    const a = e.target.closest('[data-v]')?.dataset.v; if (!a) return;
    if (a === 'prev') go(-1); else if (a === 'next') go(1); else if (a === 'hn') goHit(1); else if (a === 'hp') goHit(-1);
    else if (a === 'in' || a === 'out') { zoom = Math.min(5, Math.max(.25, zoom + (a === 'in' ? .25 : -.25))); img.style.width = (zoom * 100) + '%'; }
    else if (a === 'dl') { const l = document.createElement('a'); l.href = URL.createObjectURL(blob); l.download = file || name; l.click(); }
  });
  decorate(wrap, close);
  if (isImg) { try { url = await imageUrl(blob, ext); img.src = url; } catch (e) { wrap.querySelector('.pvimg').textContent = 'No se pudo mostrar la imagen: ' + e.message; } }
  show();
}
