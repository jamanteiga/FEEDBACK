// Ventana de previsualización: ocupa toda la pantalla (Fullscreen API si el navegador lo permite) y lleva la ✕ de cierre arriba a la derecha.
export function decorate(wrap, close) {
  const x = document.createElement('button'); x.className = 'vx'; x.type = 'button'; x.title = 'Cerrar (Esc)'; x.setAttribute('aria-label', 'Cerrar'); x.textContent = '✕';
  x.onclick = close; wrap.querySelector('.vwin').appendChild(x);
  let entered = false;
  const onFs = () => { if (!wrap.isConnected) { document.removeEventListener('fullscreenchange', onFs); return; } if (entered && !document.fullscreenElement) close(); };
  document.addEventListener('fullscreenchange', onFs);
  try { const p = wrap.requestFullscreen?.(); if (p?.then) p.then(() => { entered = true; }).catch(() => {}); } catch { /* sin pantalla completa: queda a ventana completa */ }
}
export const leaveFs = () => { try { if (document.fullscreenElement) document.exitFullscreen?.(); } catch { /* nada */ } };
