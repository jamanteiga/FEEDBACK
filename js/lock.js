// Bloqueo con contraseña: pantalla de desbloqueo al abrir, activar/cambiar/quitar y bloqueo automático por inactividad.
import { DB } from './db.js';
import { Vault, b64, unb64 } from './vault.js';
import { Store } from './store.js';
const $ = s => document.querySelector(s), OK = new TextEncoder().encode('FEEDBACK-OK');
const getLock = () => DB.get('meta', 'lock');
const say = (id, t, err) => { const e = $(id); if (e) { e.textContent = t; e.className = 'msg ' + (err ? 'error' : 'info'); e.hidden = !t; } };
const busy = (on, t) => { $('#lk-busy').hidden = !on; $('#lk-busy').textContent = t || ''; for (const b of document.querySelectorAll('#lockcfg button')) b.disabled = on; };

export const Lock = {
  async gate() {   // se llama tras abrir la base de datos y antes de leer nada
    const lk = await getLock(); if (!lk) return;
    const ov = $('#lock'); ov.hidden = false; $('#lk-pass').focus();
    await new Promise(res => {
      $('#lk-form').onsubmit = async e => {
        e.preventDefault(); const btn = $('#lk-go'); btn.disabled = true; say('#lk-err', '');
        try {
          const k = await Vault.derive($('#lk-pass').value, unb64(lk.salt));
          if (new TextDecoder().decode(await Vault.open(unb64(lk.check), k)) !== 'FEEDBACK-OK') throw 0;
          Vault.use(k); $('#lk-pass').value = ''; ov.hidden = true; res();
        } catch { say('#lk-err', 'Contraseña incorrecta.', true); $('#lk-pass').select(); }
        btn.disabled = false;
      };
      $('#lk-forgot').onclick = async () => {
        if (!confirm('Sin la contraseña los datos cifrados NO se pueden recuperar. Se borrará todo lo guardado en este navegador (índice, marcas y archivos importados) para empezar de cero. La copia cifrada de la carpeta de datos, si la hay, no se toca. ¿Borrar todo?')) return;
        indexedDB.deleteDatabase('feedback-web'); await new Promise(r => setTimeout(r, 400)); location.reload();
      };
    });
  },
  init() {
    const refresh = async () => { const lk = await getLock(); $('#lk-state').textContent = lk ? '🔐 Activada: los datos de este navegador y de la copia en disco están cifrados.' : 'Desactivada: los datos se guardan sin cifrar (el disco del equipo puede estar cifrado con BitLocker/FileVault).'; $('#lk-off').hidden = $('#lk-now').hidden = $('#lk-idlew').hidden = !lk; $('#lk-old').hidden = !lk; $('#lk-set').textContent = lk ? 'Cambiar contraseña' : 'Activar contraseña'; };
    refresh();
    const diskRewrite = async () => {   // la copia en disco se regenera con el nuevo cifrado (las versiones antiguas se descartan: estaban con el cifrado anterior)
      if (!Store.dir) return;
      try { if (await Store.perm(true)) { await Store.wipeDir(true); await Store.snapshotAll(true); await Store.writeVersion(Vault.on ? 'tras cifrar' : 'tras quitar el cifrado'); } else say('#lk-msg', 'Aviso: sin permiso sobre la carpeta de datos; pulsa «Guardar copia completa ahora» para regenerarla.', true); }
      catch (e) { say('#lk-msg', 'Aviso: no se pudo regenerar la copia en disco: ' + e.message, true); }
    };
    const run = async (fn, okMsg) => {
      busy(true, 'Procesando… no cierres la pestaña.');
      try { await fn(); await diskRewrite(); say('#lk-msg', okMsg); await refresh(); }
      catch (e) { say('#lk-msg', e.message || String(e), true); }
      busy(false); for (const i of ['#lk-old', '#lk-new', '#lk-new2']) $(i).value = '';
    };
    const checkOld = async lk => { const k = await Vault.derive($('#lk-old').value, unb64(lk.salt)); try { await Vault.open(unb64(lk.check), k); } catch { throw new Error('La contraseña actual no es correcta.'); } return k; };
    $('#lk-set').onclick = async () => {
      const p = $('#lk-new').value; if (p.length < 8) return say('#lk-msg', 'La nueva contraseña debe tener al menos 8 caracteres.', true);
      if (p !== $('#lk-new2').value) return say('#lk-msg', 'Las dos contraseñas nuevas no coinciden.', true);
      const lk = await getLock();
      if (!confirm((lk ? 'Se volverán a cifrar todos los datos con la nueva contraseña.' : 'Se cifrarán todos los datos de este navegador y de la copia en disco.') + '\n\nSi olvidas la contraseña NO hay forma de recuperarlos. Durante el proceso no cierres la pestaña. ¿Continuar?')) return;
      await run(async () => {
        const oldK = lk ? await checkOld(lk) : null, salt = Vault.newSalt(), newK = await Vault.derive(p, salt);
        await DB.recrypt(oldK, newK, (s, n, t) => busy(true, `Cifrando ${s}… ${n}/${t}`));
        await DB.put('meta', { salt: b64(salt), check: b64(await Vault.seal(OK, newK)) }, 'lock'); Vault.use(newK);
      }, lk ? 'Contraseña cambiada.' : 'Contraseña activada. A partir de ahora se pedirá al abrir la aplicación.');
    };
    $('#lk-off').onclick = async () => {
      const lk = await getLock(); if (!lk) return;
      if (!confirm('Se descifrarán todos los datos y la aplicación dejará de pedir contraseña. ¿Continuar?')) return;
      await run(async () => { const oldK = await checkOld(lk); await DB.recrypt(oldK, null, (s, n, t) => busy(true, `Descifrando ${s}… ${n}/${t}`)); await DB.del('meta', 'lock'); Vault.use(null); }, 'Contraseña quitada: los datos ya no están cifrados.');
    };
    $('#lk-now').onclick = () => { Vault.use(null); location.reload(); };
    // bloqueo automático por inactividad
    const sel = $('#lk-idle'); sel.value = localStorage.getItem('fb-idle') || '0'; let t;
    const arm = () => { clearTimeout(t); const m = +sel.value; if (m && Vault.on) t = setTimeout(() => { Vault.use(null); location.reload(); }, m * 60e3); };
    sel.onchange = () => { localStorage.setItem('fb-idle', sel.value); arm(); };
    for (const ev of ['pointerdown', 'keydown', 'wheel']) addEventListener(ev, arm, { passive: true }); arm();
  },
};
