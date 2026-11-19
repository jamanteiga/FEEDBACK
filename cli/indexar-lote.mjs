#!/usr/bin/env node
// Indexado por lotes SIN abrir la ventana: arranca la propia app en un Chrome oculto, le entrega los ficheros de una carpeta
// y guarda el resultado como proyecto cifrado (.fbp) que luego importas en tu navegador («Datos y copias» → Importar).
// Todo es local: servidor en 127.0.0.1, sin red externa. Requisitos: Node 18+, Google Chrome o Edge instalado y `npm i playwright-core`.
// Uso: node cli/indexar-lote.mjs <carpeta> <salida.fbp> --clave=CONTRASEÑA [--originales] [--chrome=ruta]
import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const args = process.argv.slice(2), pos = args.filter(a => !a.startsWith('--')), opt = Object.fromEntries(args.filter(a => a.startsWith('--')).map(a => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=') || true]; }));
if (pos.length < 2 || !opt.clave || String(opt.clave).length < 6) { console.error('Uso: node cli/indexar-lote.mjs <carpeta> <salida.fbp> --clave=CONTRASEÑA(≥6) [--originales] [--chrome=ruta]'); process.exit(2); }
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), EXT = new Set('pdf eml msg doc docx xls xlsx xlsm ppt pptx dwg dxf dgn txt csv md rtf html htm png jpg jpeg tif tiff bmp gif webp zip'.split(' '));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const walk = async d => { const out = []; for (const e of await readdir(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) out.push(...await walk(p)); else if (EXT.has(extname(e.name).slice(1).toLowerCase())) out.push(p); } return out; };
const files = await walk(resolve(pos[0])); if (!files.length) { console.error('No hay ficheros admitidos en esa carpeta.'); process.exit(1); }
const srv = createServer(async (q, r) => { try { let u = decodeURIComponent(q.url.split('?')[0]); if (u.endsWith('/')) u += 'index.html'; const p = join(root, u); if (!p.startsWith(root)) throw 0; const b = await readFile(p); r.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' }); r.end(b); } catch { r.writeHead(404); r.end(); } }).listen(0, '127.0.0.1');
await new Promise(ok => srv.once('listening', ok)); const port = srv.address().port;
let pw; try { pw = await import('playwright-core'); } catch { try { pw = await import('playwright'); } catch { console.error('Falta playwright-core: ejecuta «npm i playwright-core» en la carpeta de la app.'); process.exit(3); } }
const browser = await pw.chromium.launch(opt.chrome ? { executablePath: opt.chrome } : { channel: 'chrome' });
try {
  const page = await (await browser.newContext({ acceptDownloads: true })).newPage(); page.on('dialog', d => d.accept());
  await page.goto(`http://127.0.0.1:${port}/index.html`); await page.waitForFunction('window.__feedback&&window.__feedback.ready', null, { timeout: 60000 });
  console.log(`Indexando ${files.length} fichero(s)…`);
  await page.setInputFiles('#file', files);
  let quiet = 0; const t0 = Date.now();
  while (quiet < 3) { await new Promise(r => setTimeout(r, 3000)); const idle = await page.evaluate(() => document.querySelector('#cancel')?.hidden !== false); quiet = idle ? quiet + 1 : 0; if ((Date.now() - t0) % 30000 < 3100) process.stdout.write('.'); }
  console.log('\nExportando…');
  await page.click('[data-go=datos]'); await page.fill('#enc-pass', String(opt.clave)); if (!opt.originales) await page.uncheck('#fbp-orig').catch(() => {}); else await page.check('#fbp-orig').catch(() => {});
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 600000 }), page.click('#fbp-export')]);
  await dl.saveAs(resolve(pos[1])); const n = (await stat(resolve(pos[1]))).size;
  console.log(`Listo: ${resolve(pos[1])} (${(n / 1048576).toFixed(1)} MB). Impórtalo en la app: «Datos y copias» → Importar índice… y escribe la misma contraseña.`);
} finally { await browser.close(); srv.close(); }
