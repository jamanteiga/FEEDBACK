// Cifrado local opcional (AES-256-GCM, clave derivada de la contraseña con PBKDF2-SHA-256, 250 000 iteraciones).
// La contraseña y la clave solo viven en memoria: al bloquear o cerrar la pestaña desaparecen. No hay recuperación posible.
const te = new TextEncoder(), ITER = 250000, MAGIC = [0x46, 0x42, 0x4b, 0x32];   // 'FBK2' = archivo de la copia en disco cifrado
const rnd = n => crypto.getRandomValues(new Uint8Array(n));
const cat = (...a) => { const o = new Uint8Array(a.reduce((s, x) => s + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
export const b64 = u => { let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192)); return btoa(s); };
export const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export const Vault = {
  enc: null, mac: null, salt: null,
  get on() { return !!this.enc; },
  newSalt: () => rnd(16),
  async derive(pass, salt) {
    const base = await crypto.subtle.importKey('raw', te.encode(pass), 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, base, 512));
    return { salt, enc: await crypto.subtle.importKey('raw', bits.slice(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt']), mac: await crypto.subtle.importKey('raw', bits.slice(32), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']) };
  },
  use(k) { this.enc = k?.enc || null; this.mac = k?.mac || null; this.salt = k?.salt || null; },
  async seal(u8, k = this) { const iv = rnd(12); return cat(iv, new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k.enc, u8))); },
  async open(u8, k = this) { if (!k?.enc) throw new Error('bloqueado'); return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u8.subarray(0, 12) }, k.enc, u8.subarray(12))); },
  async hash(str, k = this) { return b64(new Uint8Array(await crypto.subtle.sign('HMAC', k.mac, te.encode(String(str))))); },   // índice ciego (duplicados por SHA-256 sin revelarlo)
  // archivos de la copia en disco
  async sealFile(u8) { return cat(new Uint8Array(MAGIC), this.salt, await this.seal(u8)); },
  isSealed: u8 => u8.length > 36 && MAGIC.every((m, i) => u8[i] === m),
  async openFile(u8) {
    if (!this.isSealed(u8)) return u8;
    const salt = u8.slice(4, 20); let k = this;
    if (!this.salt || b64(salt) !== b64(this.salt)) {
      const p = prompt('Esta copia en disco está cifrada con otra contraseña. Escríbela para leerla:'); if (p == null) throw new Error('Copia cifrada: falta la contraseña.');
      k = await this.derive(p, salt);
    }
    try { return await this.open(u8.subarray(20), k); } catch { throw new Error('Contraseña incorrecta para esta copia cifrada.'); }
  },
};
