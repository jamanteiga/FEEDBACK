// Datos adicionales (proyectos, requisitos, búsquedas guardadas, registro de cambios, plantilla de informe) y copia cifrada.
import { DB } from './db.js';
const KEY = 'extras';
export const Extras = {
  d: { projects: ['General'], reqs: [], searches: [], audit: [], cfg: {}, nextReq: 1 },
  async load() { const x = await DB.get('meta', KEY); this.d = { projects: ['General'], reqs: [], searches: [], audit: [], cfg: {}, nextReq: 1, ...(x || {}) }; if (!this.d.projects.includes('General')) this.d.projects.unshift('General'); },
  async save() { if (this.readonly) return; await DB.put('meta', JSON.parse(JSON.stringify(this.d)), KEY); },
  readonly: false,
  async reset() { await DB.del('meta', KEY); this.d = { projects: ['General'], reqs: [], searches: [], audit: [], cfg: {}, nextReq: 1 }; },
  user: () => localStorage.getItem('fb-user') || '(sin nombre)',
  async log(action, target = '', detail = '') {
    this.d.audit.push({ at: new Date().toISOString(), user: this.user(), action, target, detail });
    if (this.d.audit.length > 3000) this.d.audit.splice(0, this.d.audit.length - 3000);
    await this.save();
  },
  auditCsv() {
    const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    return '﻿' + [['Fecha', 'Usuario/equipo', 'Acción', 'Objeto', 'Detalle'], ...this.d.audit.map(a => [a.at.replace('T', ' ').slice(0, 19), a.user, a.action, a.target, a.detail])].map(r => r.map(q).join(';')).join('\r\n');
  },
};

// ---- cifrado AES-GCM con clave derivada de contraseña (PBKDF2) ----
const MAGIC = new TextEncoder().encode('FBK1');
async function keyFrom(pass, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function encryptBytes(bytes, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFrom(pass, salt), bytes));
  const out = new Uint8Array(MAGIC.length + 28 + ct.length); out.set(MAGIC); out.set(salt, 4); out.set(iv, 20); out.set(ct, 32); return out;
}
export async function decryptBytes(buf, pass) {
  const b = new Uint8Array(buf);
  if (b.length < 49 || new TextDecoder().decode(b.slice(0, 4)) !== 'FBK1') throw new Error('No es un archivo cifrado de FEEDBACK (.fbk).');
  try { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(20, 32) }, await keyFrom(pass, b.slice(4, 20)), b.slice(32))); }
  catch { throw new Error('Contraseña incorrecta o archivo dañado.'); }
}
