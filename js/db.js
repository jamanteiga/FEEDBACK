// Almacén local (IndexedDB). Todo queda en este navegador y este equipo.
const NAME = 'feedback-web';
let db;

const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const store = (n, mode = 'readonly') => db.transaction(n, mode).objectStore(n);

export const DB = {
  async open() {
    db = await new Promise((res, rej) => {
      const r = indexedDB.open(NAME, 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('meta');
        const docs = d.createObjectStore('docs', { keyPath: 'id', autoIncrement: true });
        docs.createIndex('sha', 'sha256'); docs.createIndex('key', 'key');
        const pg = d.createObjectStore('pages', { keyPath: ['docId', 'pageNo'] });
        pg.createIndex('docId', 'docId');
        d.createObjectStore('blobs');   // originales importados (arrastrar/pegar/seleccionar)
        d.createObjectStore('pimg');    // copias procesadas de imágenes
        d.createObjectStore('log', { keyPath: 'id', autoIncrement: true });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  get: (s, k) => req(store(s).get(k)),
  put: (s, v, k) => req(store(s, 'readwrite').put(v, k)),
  del: (s, k) => req(store(s, 'readwrite').delete(k)),
  all: s => req(store(s).getAll()),
  clear: s => req(store(s, 'readwrite').clear()),
  byIndex: (s, idx, val) => req(store(s).index(idx).getAll(IDBKeyRange.only(val))),

  async addLog(level, filename, message) {
    await this.put('log', { at: new Date().toISOString(), level, filename, message });
  },

  async deleteDoc(id) {
    const pages = await this.byIndex('pages', 'docId', id);
    for (const p of pages) { await this.del('pages', [id, p.pageNo]); await this.del('pimg', [id, p.pageNo]); }
    await this.del('blobs', id);
    await this.del('docs', id);
    return pages.map(p => p.pageNo);
  },
  async wipe() { for (const s of ['docs', 'pages', 'blobs', 'pimg', 'log']) await this.clear(s); },
};
