// Revisión asistida del OCR: la imagen con las palabras dudosas marcadas, el recorte de cada una y un campo para corregirla.
// La corrección se aplica al texto indexado de esa página (queda el texto original guardado y el cambio en el registro).
import { decorate, leaveFs } from './vwin.js';
import { cachedBoxes } from './locate.js';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const lev = (a, b) => { const m = a.length, n = b.length; if (!m) return n; const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]); for (let j = 1; j <= n; j++) d[0][j] = j; for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[m][n]; };
// sustituye en el texto de la página la palabra más parecida a «ocr» por «ok»; devuelve el texto nuevo o null si no hay candidata
export function replaceClosest(text, ocr, ok) {
  const re = /[\p{L}\p{N}][\p{L}\p{N}'’./%°-]*/gu; let best = null, m;
  while ((m = re.exec(text))) { const dd = lev(m[0].toLowerCase(), ocr.toLowerCase()); if (dd <= Math.max(1, Math.floor(ocr.length * .5)) && (!best || dd < best.d)) best = { d: dd, i: m.index, w: m[0] }; }
  return best ? text.slice(0, best.i) + ok + text.slice(best.i + best.w.length) : null;
}
export async function openOcrReview({ docId, pageNo, name, makeCanvas, getText, setText, thr = 75 }) {
  document.getElementById('viewer')?.remove();
  const wrap = document.createElement('div'); wrap.id = 'viewer';
  wrap.innerHTML = `<div class="vwin"><div class="vbar"><b class="vname">Revisión de OCR · ${esc(name)} · parte ${pageNo}</b><span class="m vst">Leyendo la imagen…</span></div>
    <div class="vbody" style="padding:0;display:flex;overflow:hidden"><div class="pvimg" style="flex:1 1 55%"><div class="pvwrap"><canvas class="rvimg" style="width:100%;display:block"></canvas><div class="vhl locl"></div></div></div><div class="pvtxt" style="flex:1 1 45%"><div class="rvlist"></div></div></div></div>`;
  document.body.appendChild(wrap);
  const close = () => { document.removeEventListener('keydown', onKey); leaveFs(); wrap.remove(); }, onKey = e => { if (e.key === 'Escape' && !e.target.closest?.('input')) close(); };
  document.addEventListener('keydown', onKey); decorate(wrap, close);
  const st = wrap.querySelector('.vst'), list = wrap.querySelector('.rvlist'), cv = wrap.querySelector('.rvimg'), lay = wrap.querySelector('.locl');
  try {
    const src = await makeCanvas(); cv.width = src.width; cv.height = src.height; cv.getContext('2d').drawImage(src, 0, 0);
    const boxes = await cachedBoxes(docId, pageNo, async () => src, x => { st.textContent = 'Leyendo la imagen… ' + (x || ''); }, true);
    const bad = boxes.filter(b => b[5] != null && b[5] < thr && b[0].length >= 2).sort((a, b) => a[2] - b[2] || a[1] - b[1]);
    st.textContent = `${bad.length} palabra(s) con confianza < ${thr} % de ${boxes.length}`;
    lay.innerHTML = bad.map((b, i) => `<div class="locbox" data-i="${i}" style="position:absolute;left:${b[1] * 100}%;top:${b[2] * 100}%;width:${b[3] * 100}%;height:${b[4] * 100}%;border:2px solid ${b[5] < 50 ? '#d32f2f' : '#ff9800'};box-sizing:border-box"></div>`).join('');
    list.innerHTML = bad.length ? bad.map((b, i) => {
      const t = document.createElement('canvas'), px = Math.round(b[3] * src.width), py = Math.round(b[4] * src.height), pad = Math.round(py * .6);
      const sx = Math.max(0, Math.round(b[1] * src.width) - pad), sy = Math.max(0, Math.round(b[2] * src.height) - pad), sw = Math.min(src.width - sx, px + 2 * pad), sh = Math.min(src.height - sy, py + 2 * pad);
      const k = Math.min(4, 90 / Math.max(10, sh)); t.width = Math.max(1, Math.round(sw * k)); t.height = Math.max(1, Math.round(sh * k)); t.getContext('2d').drawImage(src, sx, sy, sw, sh, 0, 0, t.width, t.height);
      return `<div class="rvrow" data-i="${i}" style="display:flex;gap:8px;align-items:center;margin:6px 0;border-bottom:1px solid #ddd;padding-bottom:6px"><img src="${t.toDataURL('image/png')}" style="max-width:240px;border:1px solid #bbb;background:#fff"><div><div class="m">leído «${esc(b[0])}» · confianza ${b[5]} %</div><input class="rvin" value="${esc(b[0])}" style="width:180px"> <button class="sec rvap" data-i="${i}">Aplicar</button> <span class="m rvmsg"></span></div></div>`;
    }).join('') : '<div class="empty">No hay palabras dudosas en esta página.</div>';
    list.addEventListener('click', async e => {
      const bt = e.target.closest('.rvap'); if (!bt) return; const row = bt.closest('.rvrow'), b = bad[+bt.dataset.i], v = row.querySelector('.rvin').value.trim(), msg = row.querySelector('.rvmsg');
      if (!v || v === b[0]) { msg.textContent = 'Escribe la lectura correcta'; return; }
      const nt = replaceClosest(await getText(), b[0], v); if (!nt) { msg.textContent = 'No encuentro esa palabra en el texto indexado de la página'; return; }
      await setText(nt); msg.textContent = '✔ aplicada'; bt.disabled = true;
    });
    list.addEventListener('mouseover', e => { const r = e.target.closest('.rvrow'); lay.querySelectorAll('.locbox').forEach(x => x.style.background = r && x.dataset.i === r.dataset.i ? 'rgba(255,214,0,.5)' : ''); if (r) lay.querySelector(`[data-i="${r.dataset.i}"]`)?.scrollIntoView({ block: 'center' }); });
  } catch (e) { st.textContent = 'No se pudo preparar la revisión: ' + (e.message || e); }
}
