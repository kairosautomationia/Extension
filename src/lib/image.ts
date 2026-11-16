/**
 * Reduce una imagen (data URL) antes de adjuntarla: máx. `maxSide` px por lado y JPEG.
 * Una captura de pantalla en PNG puede pesar varios MB; así baja a ~100-300 KB, se sube más rápido,
 * cabe en los límites del Worker y el modelo la lee igual de bien. Si algo falla, devuelve la original.
 */
export async function shrinkImage(dataUrl: string, maxSide = 1280, quality = 0.74): Promise<string> {
  try {
    if (!dataUrl.startsWith('data:image/') || dataUrl.length < 250_000) return dataUrl; // lo pequeño se deja tal cual
    const img = new Image();
    img.decoding = 'async';
    img.src = dataUrl;
    await img.decode();
    const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * k));
    const h = Math.max(1, Math.round(img.naturalHeight * k));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return dataUrl;
    ctx.fillStyle = '#fff'; // el JPEG no tiene transparencia
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const out = c.toDataURL('image/jpeg', quality);
    return out.length < dataUrl.length ? out : dataUrl;
  } catch {
    return dataUrl;
  }
}
