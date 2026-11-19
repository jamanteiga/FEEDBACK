// Copia de la base de datos en una carpeta del disco (por equipo). Si el navegador pierde sus datos
// (limpieza de datos del sitio, otro perfil, ventana privada…), se restaura desde esa carpeta.
// Estructura (v2, mínima): feedback-datos.fbd (índice comprimido) · originales/<id> (solo archivos importados a mano) · versions/*.fbv
// Las copias antiguas (manifest.json, docs/, blobs/, pimg/…) se leen igualmente y se migran solas al formato nuevo.
import { DB } from './db.js';
import { Vault } from './vault.js';

const DELAY = 6000, DATA = 'feedback-datos.fbd';
const hhmm = d => d.toTimeString().slice(0, 5);

async function sub(dir, parts, create) { let d = dir; for (const p of parts) d = await d.getDirectoryHandle(p, { create }); return d; }
async function writeFile(dir, path, data) {
  const parts = path.split('/'), name = parts.pop(), d = await sub(dir, parts, true);
  if (Vault.on) data = await Vault.sealFile(new Uint8Array(data instanceof Blob ? await data.arrayBuffer() : data));
  const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(data); await w.close();
}
async function readFile(dir, path) {
  const parts = path.split('/'), name = parts.pop(), d = await sub(dir, parts, false);
  const f = await (await d.getFileHandle(name)).getFile(), u = new Uint8Array(await f.arrayBuffer()), o = Vault.isSealed(u) ? await Vault.openFile(u) : u;   // descifra si hace falta
  return { size: o.length, arrayBuffer: async () => o.buffer.slice(o.byteOffset, o.byteOffset + o.length), text: async () => new TextDecoder().decode(o) };
}
async function removeFile(dir, path) { try { const parts = path.split('/'), name = parts.pop(); await (await sub(dir, parts, false)).removeEntry(name); } catch { /* no existe */ } }

export const Store = {
  dir: null, restoring: false, timer: null, lastSave: null, written: new Set(),
  dirty: new Set(), deleted: new Set(), flags: { marks: false, log: false, roots: false, wipe: false, extras: false },
  getRoots: () => [], setGhosts: () => {}, onStatus: () => {},

  async init() { const m = await DB.get('meta', 'datadir'); this.dir = m?.handle || null; this.status(); },
  status(extra) {
    this.onStatus(!this.dir ? '⚠ Sin carpeta de datos: elige una para que el índice sobreviva si el navegador lo pierde.'
      : `📀 Copia en disco: «${this.dir.name}»${this.lastSave ? ' · última ' + hhmm(this.lastSave) : ''}${extra ? ' · ' + extra : ''}`);
  },
  async perm(request) {
    if (!this.dir) return false;
    const o = { mode: 'readwrite' };
    if ((await this.dir.queryPermission(o)) === 'granted') return true;
    return request ? (await this.dir.requestPermission(o)) === 'granted' : false;
  },
  async pick() {
    try { this.dir = await window.showDirectoryPicker({ id: 'feedback-datos', mode: 'readwrite' }); }
    catch (e) { if (e.name === 'AbortError') return false; throw e; }
    await DB.put('meta', { handle: this.dir }, 'datadir'); this.status(); return true;
  },
  async hasData() { try { await readFile(this.dir, DATA); return true; } catch { return this.hasLegacy(); } },
  async hasLegacy() { try { await readFile(this.dir, 'manifest.json'); return true; } catch { return false; } },

  // ---- seguimiento de cambios (lo llama DB.onChange) ----
  hook(kind, s, v, k, r) {
    if (this.restoring || !this.dir) return;
    if (kind === 'put') {
      if (s === 'docs') this.dirty.add(r); else if (s === 'pages') this.dirty.add(v.docId); else if (s === 'blobs') this.dirty.add(k);
      else if (s === 'marks') this.flags.marks = true; else if (s === 'log') this.flags.log = true;
      else if (s === 'meta' && k === 'folders') this.flags.roots = true; else if (s === 'meta' && k === 'extras') this.flags.extras = true; else return;
    } else if (kind === 'del') {
      if (s === 'docs') { this.deleted.add(k); this.dirty.delete(k); } else if (s === 'marks') this.flags.marks = true; else return;
    } else if (kind === 'clear' && s === 'docs') { this.flags.wipe = true; this.dirty.clear(); } else return;
    clearTimeout(this.timer); this.timer = setTimeout(() => this.flush().catch(e => this.status('error: ' + e.message)), DELAY);
  },

  async writeBlob(id) {   // solo los originales importados a mano (los de carpeta siguen en su carpeta)
    const doc = await DB.get('docs', id); if (!doc || doc.source === 'carpeta' || this.written.has('b' + id)) return;
    const b = await DB.get('blobs', id); if (b) { await writeFile(this.dir, `originales/${id}`, b); this.written.add('b' + id); }
  },
  async removeDocFiles(id) {
    await removeFile(this.dir, `originales/${id}`); this.written.delete('b' + id);
  },
  async wipeDir(all = false) {
    if (all) { try { await this.dir.removeEntry('versions', { recursive: true }); } catch { /* no existe */ } }
    for (const n of ['originales', 'docs', 'blobs', 'pimg']) { try { await this.dir.removeEntry(n, { recursive: true }); } catch { /* no existe */ } }
    for (const f of [DATA, 'manifest.json', 'marks.json', 'log.json', 'roots.json', 'extras.json']) await removeFile(this.dir, f);
    this.written.clear();
  },
  async snapshot() {
    return { app: 'feedback-web-data', version: 2, savedAt: new Date().toISOString(), docs: await DB.all('docs'), pages: await DB.all('pages'), marks: await DB.all('marks'),
      log: (await DB.all('log')).slice(-300), roots: this.getRoots(), extras: await DB.get('meta', 'extras') || {} };
  },
  async flush(gesture = false) {
    if (!this.dir) return false;
    if (!(await this.perm(gesture))) { this.status('⏸ en pausa: pulsa «Guardar copia completa ahora» para reconceder permiso'); return false; }
    clearTimeout(this.timer);
    const dirty = [...this.dirty], deleted = [...this.deleted], f = { ...this.flags };
    this.dirty.clear(); this.deleted.clear(); this.flags = { marks: false, log: false, roots: false, wipe: false, extras: false };
    try {
      if (f.wipe) await this.wipeDir(true);
      for (const id of deleted) await this.removeDocFiles(id);
      for (const id of dirty) await this.writeBlob(id);
      await writeFile(this.dir, DATA, window.pako.gzip(JSON.stringify(await this.snapshot())));
      if (this.migrate) { for (const n of ['docs', 'blobs', 'pimg']) { try { await this.dir.removeEntry(n, { recursive: true }); } catch { /* no existe */ } } for (const x of ['manifest.json', 'marks.json', 'log.json', 'roots.json', 'extras.json']) await removeFile(this.dir, x); this.migrate = false; }
      this.lastSave = new Date(); try { localStorage.setItem('fb-lastcopy', String(Date.now())); } catch { /* sin almacenamiento */ } this.status(); this.maybeVersion().catch(() => {}); return true;
    } catch (e) {
      dirty.forEach(i => this.dirty.add(i)); deleted.forEach(i => this.deleted.add(i));
      for (const k of Object.keys(f)) if (f[k]) this.flags[k] = true;
      this.status('error al guardar: ' + e.message); throw e;
    }
  },
  async snapshotAll(gesture = true) {
    this.written.clear();
    for (const d of await DB.all('docs')) this.dirty.add(d.id);
    this.flags.marks = this.flags.roots = this.flags.log = this.flags.extras = true;
    return this.flush(gesture);
  },
  async checkMigration() {   // copia antigua (docs/ blobs/ pimg/…): se pasa al formato nuevo en el siguiente guardado
    if (this.dir && !this.migrate && (await this.hasLegacy()) && !(await readFile(this.dir, DATA).then(() => true, () => false))) { this.migrate = true; this.flags.roots = true; for (const d of await DB.all('docs')) this.dirty.add(d.id); clearTimeout(this.timer); this.timer = setTimeout(() => this.flush().catch(() => {}), DELAY); }
  },

  async loadFiles(doc, pages) {   // blobs de originales importados e imágenes procesadas guardados en la carpeta
    if (doc.source !== 'carpeta') { try { const f = await readFile(this.dir, `originales/${doc.id}`).catch(() => readFile(this.dir, `blobs/${doc.id}`)); await DB.put('blobs', new Blob([await f.arrayBuffer()], { type: doc.mime || '' }), doc.id); } catch { /* sin blob */ } }
    for (const p of pages) { try { const f = await readFile(this.dir, `pimg/${doc.id}_${p.pageNo}.png`); await DB.put('pimg', new Blob([await f.arrayBuffer()], { type: 'image/png' }), [doc.id, p.pageNo]); } catch { /* sin imagen */ } }
  },

  // ---- versiones: instantáneas comprimidas del índice (sin originales) para poder volver atrás ----
  KEEP: 7, VER_EVERY: 6 * 3600e3,
  async listVersions() {
    if (!this.dir) return [];
    try { const d = await sub(this.dir, ['versions'], false), out = []; for await (const [n, h] of d.entries()) if (n.endsWith('.fbv')) { const f = await h.getFile(); out.push({ name: n, size: f.size }); } return out.sort((a, b) => b.name.localeCompare(a.name)); } catch { return []; }
  },
  async writeVersion(label = '') {
    const snap = { app: 'feedback-web-version', savedAt: new Date().toISOString(), label, docs: await DB.all('docs'), pages: await DB.all('pages'), marks: await DB.all('marks'), extras: await DB.get('meta', 'extras') || {} };
    const name = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15) + '.fbv';
    await writeFile(this.dir, 'versions/' + name, window.pako.gzip(JSON.stringify(snap)));
    const all = await this.listVersions(); for (const v of all.slice(this.KEEP)) await removeFile(this.dir, 'versions/' + v.name);
    this.lastVersion = Date.now(); this.onVersions?.(); return name;
  },
  async maybeVersion() {   // como mucho una versión automática cada 6 h
    if (this.lastVersion == null) { const v = (await this.listVersions())[0]; const m = v && v.name.match(/^(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)(\d\d)/); this.lastVersion = m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : 0; }
    if (Date.now() - this.lastVersion > this.VER_EVERY && (await DB.all('docs')).length) await this.writeVersion('automática');
  },
  async restoreVersion(name) {
    if (!(await this.perm(true))) throw new Error('Sin permiso sobre la carpeta de datos.');
    const snap = JSON.parse(new TextDecoder().decode(window.pako.ungzip(new Uint8Array(await (await readFile(this.dir, 'versions/' + name)).arrayBuffer()))));
    if (snap.app !== 'feedback-web-version') throw new Error('Versión no válida.');
    await this.writeVersion('antes de restaurar ' + name);   // red de seguridad: se puede deshacer
    this.restoring = true;
    try {
      await DB.wipe();
      for (const d of snap.docs) await DB.put('docs', d);
      for (const p of snap.pages) await DB.put('pages', p);
      for (const m of snap.marks) await DB.put('marks', m);
      await DB.put('meta', snap.extras || {}, 'extras');
      for (const d of snap.docs) await this.loadFiles(d, snap.pages.filter(p => p.docId === d.id));
    } finally { this.restoring = false; }
    await this.wipeDir(); await this.snapshotAll(true); return snap.docs.length;
  },

  async restore() {
    if (!(await this.perm(true))) throw new Error('Sin permiso de lectura/escritura sobre la carpeta de datos.');
    if (!(await this.hasData())) throw new Error('La carpeta no contiene una copia de FEEDBACK.');
    this.restoring = true; let n = 0, legacy = false;
    try {
      await DB.wipe();
      let snap = null;
      try { snap = JSON.parse(new TextDecoder().decode(window.pako.ungzip(new Uint8Array(await (await readFile(this.dir, DATA)).arrayBuffer())))); } catch { /* copia antigua */ }
      if (snap) {
        for (const d of snap.docs) await DB.put('docs', d);
        for (const p of snap.pages) await DB.put('pages', p);
        for (const m of snap.marks || []) await DB.put('marks', m);
        for (const x of snap.log || []) await DB.put('log', x);
        if (snap.extras && Object.keys(snap.extras).length) await DB.put('meta', snap.extras, 'extras');
        for (const d of snap.docs) await this.loadFiles(d, []);
        n = snap.docs.length; try { this.setGhosts(snap.roots || []); } catch { /* opcional */ }
      } else {
        legacy = true;
        const dd = await sub(this.dir, ['docs'], false);
        for await (const [name] of dd.entries()) {
          if (!name.endsWith('.json')) continue;
          const { doc, pages } = JSON.parse(await (await dd.getFileHandle(name)).getFile().then(f => f.text()));
          await DB.put('docs', doc); n++;
          for (const p of pages) await DB.put('pages', p);
          await this.loadFiles(doc, pages);
          for (const p of pages) { try { const f = await readFile(this.dir, `pimg/${doc.id}_${p.pageNo}.png`); await DB.put('pimg', new Blob([await f.arrayBuffer()], { type: 'image/png' }), [doc.id, p.pageNo]); } catch { /* sin imagen */ } }
        }
        for (const [file, st] of [['marks.json', 'marks'], ['log.json', 'log']]) { try { for (const x of JSON.parse(await (await readFile(this.dir, file)).text())) await DB.put(st, x); } catch { /* opcional */ } }
        try { await DB.put('meta', JSON.parse(await (await readFile(this.dir, 'extras.json')).text()), 'extras'); } catch { /* opcional */ }
        try { this.setGhosts(JSON.parse(await (await readFile(this.dir, 'roots.json')).text())); } catch { /* opcional */ }
      }
    } finally { this.restoring = false; }
    this.written.clear(); if (!legacy) for (const d of await DB.all('docs')) { if (d.source !== 'carpeta') this.written.add('b' + d.id); }
    if (legacy) await this.checkMigration();
    this.lastSave = new Date(); this.status(); return n;
  },
};
