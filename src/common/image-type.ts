/**
 * The image types a live camera selfie may be: JPEG, PNG or WebP, told by the
 * file's first bytes (its "magic number"), never by the name or the type the
 * browser claims. Anything else (an SVG, a PDF, a script renamed .jpg) is not
 * stored. The stored content type is the one read from the bytes.
 */
export type SelfieImageType = 'image/jpeg' | 'image/png' | 'image/webp';

export function detectSelfieImageType(bytes: Buffer | Uint8Array | undefined | null): SelfieImageType | null {
  if (!bytes || bytes.length < 12) return null;
  const b = bytes;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  // "RIFF" <size> "WEBP"
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

/**
 * IN-5: a bill or receipt attached to an expense: a photo (JPEG, PNG, WebP,
 * HEIC) or a PDF, told by its first bytes like a selfie. HEIC is an ISO-BMFF
 * file: "ftyp" at byte 4, then a HEIF brand.
 */
export type BillFileType = SelfieImageType | 'image/heic' | 'application/pdf';

const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);

export function detectBillFileType(bytes: Buffer | Uint8Array | undefined | null): BillFileType | null {
  const image = detectSelfieImageType(bytes);
  if (image) return image;
  if (!bytes || bytes.length < 12) return null;
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (b.subarray(4, 8).toString('latin1') === 'ftyp' && HEIF_BRANDS.has(b.subarray(8, 12).toString('latin1'))) return 'image/heic';
  return null;
}
