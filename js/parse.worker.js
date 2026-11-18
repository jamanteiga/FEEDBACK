// Web Worker: procesa Word/Excel/planos/correos sin congelar la pantalla. Clásico (importScripts) + import() dinámico de los módulos.
self.window = self;
importScripts('../vendor/pako.min.js', '../vendor/zip.js', '../vendor/xlsx.full.min.js', '../vendor/email.js');
let mods = null;
const load = async () => mods ||= { ex: await import('./extract.js'), mail: await import('./mail.js') };
onmessage = async e => {
  const { id, op, ext, buf } = e.data;
  try {
    const { ex, mail } = await load();
    const res = op === 'mail' ? await mail.parseEmail(ext, buf) : await ex.parseDocument(ext, buf);
    const tr = (res.atts || []).map(a => a.bytes?.buffer).filter(Boolean);
    postMessage({ id, res }, [...new Set(tr)]);
  } catch (err) { postMessage({ id, error: String(err && err.message || err) }); }
};
