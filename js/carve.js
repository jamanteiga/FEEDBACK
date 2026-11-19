// Imágenes PNG/JPEG «recortadas» por su firma dentro de binarios (objetos OLE incrustados, flujos de Word/Excel/PowerPoint antiguos)
export function carveImages(bytes, max = 30, minSize = 3000) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), out = [], n = u.length;
  for (let i = 0; i + 8 < n && out.length < max; i++) {
    if (u[i] === 0x89 && u[i + 1] === 0x50 && u[i + 2] === 0x4E && u[i + 3] === 0x47 && u[i + 4] === 0x0D && u[i + 5] === 0x0A) {   // PNG … IEND
      let j = i + 8; while (j + 12 <= n) { const len = (u[j] << 24 | u[j + 1] << 16 | u[j + 2] << 8 | u[j + 3]) >>> 0; if (u[j + 4] === 0x49 && u[j + 5] === 0x45 && u[j + 6] === 0x4E && u[j + 7] === 0x44) { j += 12; break; } j += 12 + len; if (len > n) break; }
      if (j > i + minSize && j <= n) { out.push({ ext: 'png', bytes: u.slice(i, j) }); i = j - 1; }
    } else if (u[i] === 0xFF && u[i + 1] === 0xD8 && u[i + 2] === 0xFF && (u[i + 3] >= 0xE0 || u[i + 3] === 0xDB)) {   // JPEG … FFD9
      let j = i + 4; while (j + 1 < n && !(u[j] === 0xFF && u[j + 1] === 0xD9)) j++;
      if (j + 2 - i > minSize && j + 1 < n) { out.push({ ext: 'jpg', bytes: u.slice(i, j + 2) }); i = j + 1; }
    }
  }
  return out;
}
