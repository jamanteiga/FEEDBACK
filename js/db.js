// Almacén local (IndexedDB). Todo queda en este navegador y este equipo.
// Con contraseña activada, cada registro se guarda cifrado (_enc); solo quedan en claro las claves de acceso (ids) y un índice ciego (HMAC) para detectar duplicados.
import { Vault } from './vault.js';
import { es } from './es.js';
const te = new TextEncoder(), td = new TextDecoder();
const PLAIN = { docs: ['id'], pages: ['docId', 'pageNo'], marks: ['id', 'docId'], log: ['id'] };
async function pack(s, v, k, K = Vault) {
  if (!K.enc || v == null) return v;
  if (s === 'blobs' || s === 'pimg') return { _enc: await Vault.seal(new Uint8Array(await v.arrayBuffer()), K), _t: v.type || '' };
  if (s === 'meta') return k === 'extras' ? { _enc: await Vault.seal(te.encode(JSON.stringify(v)), K) } : v;
  const o = { _enc: await Vault.seal(te.encode(JSON.stringify(v)), K) };
  for (const f of PLAIN[s] || []) if (v[f] !== undefined) o[f] = v[f];
  if (s === 'docs') { if (v.sha256 != null) o.sha256 = await Vault.hash(v.sha256, K); if (v.key != null) o.key = await Vault.hash(v.key, K); }
  return o;
}
async function unpack(s, r, K = Vault) {
  if (r == null || r._enc === undefined) return r;   // en claro (sin contraseña, o registro aún sin migrar)
  if (!K.enc) throw new Error('Datos cifrados: desbloquea la aplicación.');
  const u = await Vault.open(r._enc, K);
  if (s === 'blobs' || s === 'pimg') return new Blob([u], { type: r._t || '' });
  const o = JSON.parse(td.decode(u)); if (s !== 'meta' && r.id !== undefined) o.id = r.id; return o;
}
const NAME = 'feedback-web';
let db;

const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const store = (n, mode = 'readonly') => db.transaction(n, mode).objectStore(n);

export const DB = {
  async open() {
    db = await new Promise((res, rej) => {
      const r = indexedDB.open(NAME, 2);
      r.onupgradeneeded = () => {
        const d = r.result, has = n => d.objectStoreNames.contains(n);
        if (!has('meta')) d.createObjectStore('meta');
        if (!has('docs')) { const docs = d.createObjectStore('docs', { keyPath: 'id', autoIncrement: true }); docs.createIndex('sha', 'sha256'); docs.createIndex('key', 'key'); }
        if (!has('pages')) { const pg = d.createObjectStore('pages', { keyPath: ['docId', 'pageNo'] }); pg.createIndex('docId', 'docId'); }
        if (!has('blobs')) d.createObjectStore('blobs');   // originales importados (arrastrar/pegar/seleccionar)
        if (!has('pimg')) d.createObjectStore('pimg');     // copias procesadas de imágenes
        if (!has('log')) d.createObjectStore('log', { keyPath: 'id', autoIncrement: true });
        if (!has('marks')) d.createObjectStore('marks', { keyPath: 'id', autoIncrement: true }).createIndex('docId', 'docId');   // puntos marcados por el usuario
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  onChange: null,   // gancho para la copia en disco
  async get(s, k) { return unpack(s, await req(store(s).get(k))); },
  async put(s, v, k) { const w = await pack(s, v, k); const r = await req(store(s, 'readwrite').put(w, k)); DB.onChange?.('put', s, v, k, r); return r; },
  async del(s, k) { await req(store(s, 'readwrite').delete(k)); DB.onChange?.('del', s, null, k); },
  async all(s) { return Promise.all((await req(store(s).getAll())).map(r => unpack(s, r))); },
  async clear(s) { await req(store(s, 'readwrite').clear()); DB.onChange?.('clear', s); },
  async byIndex(s, idx, val) {
    if (Vault.on && s === 'docs' && (idx === 'sha' || idx === 'key')) val = await Vault.hash(val);
    return Promise.all((await req(store(s).index(idx).getAll(IDBKeyRange.only(val)))).map(r => unpack(s, r)));
  },
  // Cambia el cifrado de todos los registros: oldK/newK = claves (o null = en claro). No dispara la copia en disco.
  async recrypt(oldK, newK, onProgress) {
    for (const s of ['docs', 'pages', 'blobs', 'pimg', 'marks', 'log', 'meta']) {
      const keys = s === 'meta' ? ['extras'] : await req(store(s).getAllKeys());
      let n = 0;
      for (const k of keys) {
        const raw = await req(store(s).get(k)); if (raw === undefined) continue;
        const plain = await unpack(s, raw, oldK || {}), w = await pack(s, plain, k, newK || {});
        const inline = store(s).keyPath != null; await req(inline ? store(s, 'readwrite').put(w) : store(s, 'readwrite').put(w, k));
        if (++n % 25 === 0) onProgress?.(s, n, keys.length);
      }
    }
  },

  async addLog(level, filename, message) {
    await this.put('log', { at: new Date().toISOString(), level, filename, message: level === 'error' ? es(message) : message });
  },

  async deleteDoc(id) {
    const pages = await this.byIndex('pages', 'docId', id);
    for (const p of pages) { await this.del('pages', [id, p.pageNo]); await this.del('pimg', [id, p.pageNo]); }
    for (const m of await this.byIndex('marks', 'docId', id)) await this.del('marks', m.id);
    await this.del('blobs', id);
    await this.del('docs', id);
    return pages.map(p => p.pageNo);
  },
  async purgeContent(id) {   // deja el documento sin contenido (lápida); devuelve los números de página purgados
    const pages = await this.byIndex('pages', 'docId', id);
    for (const p of pages) { await this.del('pages', [id, p.pageNo]); await this.del('pimg', [id, p.pageNo]); }
    for (const m of await this.byIndex('marks', 'docId', id)) await this.del('marks', m.id);
    await this.del('blobs', id);
    return pages.map(p => p.pageNo);
  },
  async wipe() { for (const s of ['docs', 'pages', 'blobs', 'pimg', 'log', 'marks']) await this.clear(s); },
};
