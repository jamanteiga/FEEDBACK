// Copia de la base de datos en una carpeta del disco (por equipo). Si el navegador pierde sus datos
// (limpieza de datos del sitio, otro perfil, ventana privada…), se restaura desde esa carpeta.
// Estructura: manifest.json · roots.json · marks.json · log.json · docs/<id>.json · blobs/<id> · pimg/<id>_<pág>.png
import { DB } from './db.js';

const DELAY = 4000;
const hhmm = d => d.toTimeString().slice(0, 5);

async function sub(dir, parts, create) { let d = dir; for (const p of parts) d = await d.getDirectoryHandle(p, { create }); return d; }
async function writeFile(dir, path, data) {
  const parts = path.split('/'), name = parts.pop(), d = await sub(dir, parts, true);
  const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(data); await w.close();
}
async function readFile(dir, path) {
  const parts = path.split('/'), name = parts.pop(), d = await sub(dir, parts, false);
  return (await d.getFileHandle(name)).getFile();
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
  async hasData() { try { await readFile(this.dir, 'manifest.json'); return true; } catch { return false; } },

  // ---- seguimiento de cambios (lo llama DB.onChange) ----
  hook(kind, s, v, k, r) {
    if (this.restoring || !this.dir) return;
    if (kind === 'put') {
      if (s === 'docs') this.dirty.add(r); else if (s === 'pages') this.dirty.add(v.docId); else if (s === 'blobs') this.dirty.add(k);
      else if (s === 'pimg') this.dirty.add(k[0]); else if (s === 'marks') this.flags.marks = true; else if (s === 'log') this.flags.log = true;
      else if (s === 'meta' && k === 'folders') this.flags.roots = true; else if (s === 'meta' && k === 'extras') this.flags.extras = true; else return;
    } else if (kind === 'del') {
      if (s === 'docs') { this.deleted.add(k); this.dirty.delete(k); } else if (s === 'marks') this.flags.marks = true; else return;
    } else if (kind === 'clear' && s === 'docs') { this.flags.wipe = true; this.dirty.clear(); } else return;
    clearTimeout(this.timer); this.timer = setTimeout(() => this.flush().catch(e => this.status('error: ' + e.message)), DELAY);
  },

  async writeDoc(id) {
    const doc = await DB.get('docs', id); if (!doc) return;
    const pages = await DB.byIndex('pages', 'docId', id);
    await writeFile(this.dir, `docs/${id}.json`, JSON.stringify({ doc, pages }));
    if (doc.source !== 'carpeta' && !this.written.has('b' + id)) {
      const b = await DB.get('blobs', id); if (b) { await writeFile(this.dir, `blobs/${id}`, b); this.written.add('b' + id); }
    }
    for (const p of pages) {
      const key = `p${id}_${p.pageNo}`; if (this.written.has(key)) continue;
      const im = await DB.get('pimg', [id, p.pageNo]); if (im) { await writeFile(this.dir, `pimg/${id}_${p.pageNo}.png`, im); this.written.add(key); }
    }
  },
  async removeDocFiles(id) {
    await removeFile(this.dir, `docs/${id}.json`); await removeFile(this.dir, `blobs/${id}`);
    try { const d = await sub(this.dir, ['pimg'], false); for await (const [n] of d.entries()) if (n.startsWith(id + '_')) await d.removeEntry(n); } catch { /* sin pimg */ }
    for (const k of [...this.written]) if (k === 'b' + id || k.startsWith(`p${id}_`)) this.written.delete(k);
  },
  async wipeDir() {
    for (const n of ['docs', 'blobs', 'pimg']) { try { await this.dir.removeEntry(n, { recursive: true }); } catch { /* no existe */ } }
    for (const f of ['manifest.json', 'marks.json', 'log.json', 'roots.json', 'extras.json']) await removeFile(this.dir, f);
    this.written.clear();
  },

  async flush(gesture = false) {
    if (!this.dir) return false;
    if (!(await this.perm(gesture))) { this.status('⏸ en pausa: pulsa «Guardar copia completa ahora» para reconceder permiso'); return false; }
    clearTimeout(this.timer);
    const dirty = [...this.dirty], deleted = [...this.deleted], f = { ...this.flags };
    this.dirty.clear(); this.deleted.clear(); this.flags = { marks: false, log: false, roots: false, wipe: false, extras: false };
    try {
      if (f.wipe) await this.wipeDir();
      for (const id of deleted) await this.removeDocFiles(id);
      for (const id of dirty) await this.writeDoc(id);
      if (f.marks) await writeFile(this.dir, 'marks.json', JSON.stringify(await DB.all('marks')));
      if (f.roots) await writeFile(this.dir, 'roots.json', JSON.stringify(this.getRoots()));
      if (f.extras) await writeFile(this.dir, 'extras.json', JSON.stringify(await DB.get('meta', 'extras') || {}));
      if (f.log) await writeFile(this.dir, 'log.json', JSON.stringify((await DB.all('log')).slice(-300)));
      await writeFile(this.dir, 'manifest.json', JSON.stringify({ app: 'feedback-web-data', version: 1, savedAt: new Date().toISOString() }));
      this.lastSave = new Date(); this.status(); return true;
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

  async restore() {
    if (!(await this.perm(true))) throw new Error('Sin permiso de lectura/escritura sobre la carpeta de datos.');
    if (!(await this.hasData())) throw new Error('La carpeta no contiene una copia de FEEDBACK.');
    this.restoring = true; let n = 0;
    try {
      await DB.wipe();
      const dd = await sub(this.dir, ['docs'], false);
      for await (const [name] of dd.entries()) {
        if (!name.endsWith('.json')) continue;
        const { doc, pages } = JSON.parse(await (await dd.getFileHandle(name)).getFile().then(f => f.text()));
        await DB.put('docs', doc); n++;
        for (const p of pages) await DB.put('pages', p);
        if (doc.source !== 'carpeta') { try { const f = await readFile(this.dir, `blobs/${doc.id}`); await DB.put('blobs', new Blob([await f.arrayBuffer()], { type: doc.mime || '' }), doc.id); } catch { /* sin blob */ } }
        for (const p of pages) { try { const f = await readFile(this.dir, `pimg/${doc.id}_${p.pageNo}.png`); await DB.put('pimg', new Blob([await f.arrayBuffer()], { type: 'image/png' }), [doc.id, p.pageNo]); } catch { /* sin imagen */ } }
      }
      for (const [file, st] of [['marks.json', 'marks'], ['log.json', 'log']]) {
        try { for (const x of JSON.parse(await (await readFile(this.dir, file)).text())) await DB.put(st, x); } catch { /* opcional */ }
      }
      try { await DB.put('meta', JSON.parse(await (await readFile(this.dir, 'extras.json')).text()), 'extras'); } catch { /* opcional */ }
      try { this.setGhosts(JSON.parse(await (await readFile(this.dir, 'roots.json')).text())); } catch { /* opcional */ }
    } finally { this.restoring = false; }
    this.written.clear(); for (const d of await DB.all('docs')) { if (d.source !== 'carpeta') this.written.add('b' + d.id); }
    this.lastSave = new Date(); this.status(); return n;
  },
};
