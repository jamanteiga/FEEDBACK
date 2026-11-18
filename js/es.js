// Mensajes de error siempre en castellano: traduce los avisos técnicos habituales del navegador y de las librerías.
const RULES = [
  [/Invalid PDF structure|InvalidPDFException|Invalid or corrupted PDF/i, 'PDF no válido o dañado.'],
  [/PasswordException|No password given|Incorrect Password/i, 'PDF protegido con contraseña: no se puede leer.'],
  [/MissingPDFException|Missing PDF/i, 'No se encuentra el PDF.'],
  [/Failed to fetch|NetworkError|Load failed/i, 'No se pudo cargar un recurso (sin conexión o archivo no disponible).'],
  [/NotAllowedError|Permission denied|The user aborted a request/i, 'Permiso denegado por el navegador o por el usuario.'],
  [/NotFoundError|A requested file or directory could not be found/i, 'No se encuentra el archivo o la carpeta (¿se ha movido o borrado?).'],
  [/QuotaExceededError|quota/i, 'Sin espacio suficiente en el navegador o en el disco.'],
  [/SecurityError/i, 'El navegador ha bloqueado la operación por seguridad.'],
  [/InvalidStateError/i, 'Estado no válido del navegador; recarga la página (Ctrl+F5).'],
  [/OperationError|The operation failed for an operation-specific reason/i, 'No se pudo descifrar: contraseña incorrecta o datos dañados.'],
  [/Unexpected token|JSON\.parse|is not valid JSON|Unexpected end of JSON/i, 'El archivo no tiene un formato válido.'],
  [/out of memory|Array buffer allocation failed|Invalid array length/i, 'Memoria insuficiente para procesar este archivo.'],
  [/Worker|importScripts/i, 'Fallo en el proceso en segundo plano.'],
  [/not a zip|invalid zip|End of central directory|unexpected EOF|incorrect header check|invalid (stored|distance|code)/i, 'Archivo comprimido dañado o formato no válido.'],
  [/Cannot read propert|is not a function|is not defined|is not iterable|undefined/i, 'Error interno de la aplicación.'],
  [/Aborted|AbortError/i, 'Operación cancelada.'],
];
const ENGLISH = /\b(the|failed|error|invalid|unexpected|cannot|could not|not found|unable|expected|undefined)\b/i;
export function es(msg) {
  const s = String(msg ?? '');
  for (const [re, t] of RULES) if (re.test(s)) return t + (/[a-z]/i.test(s) && !/[áéíóúñ¿]/i.test(s) && s.length < 160 ? ` (detalle técnico: ${s.replace(/<[^>]*>/g, '')})` : '');
  return ENGLISH.test(s) && !/[áéíóúñ¿]/i.test(s) ? `Error: ${s} (mensaje técnico sin traducir)` : s;
}
