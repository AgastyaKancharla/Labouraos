import type { PhotoStamp } from './stamp';

/** Longest side of the saved photo; keeps uploads small on weak signal. */
export const MAX_SIDE = 1280;
export const JPEG_QUALITY = 0.72;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read the photo'));
    img.src = src;
  });
}

/**
 * Web app: draws the time and place onto the bottom of the photo (white text
 * on a dark band) and re-encodes it as a JPEG no larger than MAX_SIDE.
 */
export async function burnStamp(uri: string, stamp: PhotoStamp): Promise<{ uri: string; width: number; height: number }> {
  const img = await loadImage(uri);
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
  const width = Math.round((img.naturalWidth || img.width) * scale);
  const height = Math.round((img.naturalHeight || img.height) * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { uri, width, height };
  ctx.drawImage(img, 0, 0, width, height);

  const fontSize = Math.max(14, Math.round(width / 34));
  const lineHeight = Math.round(fontSize * 1.35);
  const pad = Math.round(fontSize * 0.6);
  const bandHeight = pad * 2 + lineHeight * stamp.lines.length;
  ctx.fillStyle = 'rgba(11,30,74,0.62)';
  ctx.fillRect(0, height - bandHeight, width, bandHeight);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
  ctx.textBaseline = 'top';
  stamp.lines.forEach((line, i) => {
    ctx.fillText(line, pad, height - bandHeight + pad + i * lineHeight);
  });
  return { uri: canvas.toDataURL('image/jpeg', JPEG_QUALITY), width, height };
}
