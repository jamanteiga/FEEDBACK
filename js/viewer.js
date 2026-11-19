// Visor de PDF integrado: muestra la página exacta con los términos buscados resaltados (solo lectura; el original no se modifica).
import { openPdfDoc, pdfjsLib } from './proc.js';
import { decorate, leaveFs } from './vwin.js';
const norm = s => Array.from(s).map(c => { const d = c.normalize('NFD')[0].toLowerCase(); return d.length === 1 ? d : c.toLowerCase()[0]; }).join('');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function openViewer({ blob, name, pageNo = 1, terms = [] }) {
  document.getElementById('viewer')?.remove();
  const wrap = document.createElement('div'); wrap.id = 'viewer';
  wrap.innerHTML = `<div class="vwin"><div class="vbar"><b class="vname">${esc(name)}</b><button class="sec" data-v="prev">◀</button><span class="vpg"></span><button class="sec" data-v="next">▶</button>
    <button class="sec" data-v="out">−</button><button class="sec" data-v="in">＋</button><span class="m vhits"></span><span style="flex:1"></span><button class="sec" data-v="tab">Abrir en pestaña</button></div>
    <div class="vbody"><div class="vpage"><canvas></canvas><div class="vhl"></div></div></div></div>`;
  document.body.appendChild(wrap);
  const cv = wrap.querySelector('canvas'), hl = wrap.querySelector('.vhl'), body = wrap.querySelector('.vbody');
  const ts = [...new Set(terms.map(t => norm(t.trim())).filter(t => t.length >= 2))];
  let pdf, n = pageNo, zoom = 1.3, busy = false, again = false, task;
  const close = () => { document.removeEventListener('keydown', onKey); task?.cancel?.(); pdf?.destroy?.(); leaveFs(); wrap.remove(); };
  const onKey = e => { if (e.key === 'Escape') close(); else if (e.key === 'ArrowRight') go(1); else if (e.key === 'ArrowLeft') go(-1); };
  document.addEventListener('keydown', onKey); decorate(wrap, close);
  const go = d => { n = Math.min(pdf.numPages, Math.max(1, n + d)); render(); };
  async function render() {
    if (busy) { again = true; return; } busy = true;
    try {
      const page = await pdf.getPage(n), vp = page.getViewport({ scale: zoom }), dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.floor(vp.width * dpr); cv.height = Math.floor(vp.height * dpr); cv.style.width = vp.width + 'px'; cv.style.height = vp.height + 'px';
      hl.style.width = vp.width + 'px'; hl.style.height = vp.height + 'px'; hl.innerHTML = '';
      await page.render({ canvasContext: cv.getContext('2d'), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise;
      let hits = 0;
      for (const it of (await page.getTextContent()).items) {
        if (!it.str || !it.width) continue;
        const s = norm(it.str), tx = pdfjsLib.Util.transform(vp.transform, it.transform), h = Math.hypot(tx[2], tx[3]), w = it.width * vp.scale, L = s.length;
        for (const t of ts) { let i = -1; while ((i = s.indexOf(t, i + 1)) >= 0) {
          const d = document.createElement('div'); d.style.cssText = `position:absolute;left:${tx[4] + w * i / L}px;top:${tx[5] - h}px;width:${Math.max(3, w * t.length / L)}px;height:${h * 1.15}px;background:rgba(255,214,0,.45);mix-blend-mode:multiply;pointer-events:none`;
          hl.appendChild(d); hits++; } }
      }
      wrap.querySelector('.vpg').textContent = `pág. ${n} de ${pdf.numPages}`; wrap.querySelector('.vhits').textContent = ts.length ? `${hits} coincidencia(s) resaltadas en esta página` : '';
      const first = hl.firstElementChild; if (first) body.scrollTop = Math.max(0, first.offsetTop - 120); else body.scrollTop = 0;
    } catch (e) { wrap.querySelector('.vpg').textContent = 'Error: ' + e.message; }
    busy = false; if (again) { again = false; render(); }
  }
  wrap.addEventListener('click', e => {
    const a = e.target.closest('[data-v]')?.dataset.v; if (!a) { if (e.target === wrap) close(); return; }
    if (a === 'close') close(); else if (a === 'prev') go(-1); else if (a === 'next') go(1);
    else if (a === 'in') { zoom = Math.min(3, zoom + .25); render(); } else if (a === 'out') { zoom = Math.max(.6, zoom - .25); render(); }
    else if (a === 'tab') window.open(URL.createObjectURL(new Blob([blob], { type: 'application/pdf' })) + `#page=${n}`, '_blank');
  });
  try { task = openPdfDoc(await blob.arrayBuffer()); pdf = await task.promise; n = Math.min(Math.max(1, n), pdf.numPages); await render(); }
  catch (e) { wrap.querySelector('.vpg').textContent = 'No se pudo abrir el PDF: ' + e.message; }
}
