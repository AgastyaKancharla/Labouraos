import { decode as decodeJpeg, encode as encodeJpeg } from 'jpeg-js';

/**
 * The live photo of another ID card (PAN, driving licence, voter ID), as it
 * reaches the server.
 *
 * What the capture screens send: a JPEG drawn from the live camera on a canvas
 * (the registration link, and Laboura Field's web app), longest side at most
 * 1280 pixels, with no camera or editing metadata — a canvas writes none.
 * Anything else did not come from those screens: a photo with a camera's EXIF
 * (make, model, date taken, GPS), an editor's marks (Photoshop, XMP, "Software"),
 * a PNG / WebP, or a size the canvas can't produce is refused.
 *
 * The accepted photo is then decoded and re-encoded here (jpeg-js, already used
 * for the Aadhaar QR photo), so what is stored carries no metadata at all —
 * no GPS, no device, nothing but pixels.
 *
 * This raises the bar against a gallery upload or an edited picture; it can't
 * prove a photo is live (a determined person can draw any picture on a canvas).
 * The real control is the Team Lead's eye: the card next to the live selfie,
 * the name and the date of birth (DEPLOY.md, "ID checks").
 *
 * Laboura Field's phone builds (when they come) must resize to at most 1280
 * pixels and re-save without EXIF before uploading, as its web app does today.
 */

/** The capture canvas never makes a side longer than this (web LiveSelfie card mode, Field burnStamp). */
export const CARD_PHOTO_MAX_SIDE = 1280;
/** A card photo smaller than this can't be read by the Team Lead. */
export const CARD_PHOTO_MIN_SIDE = 240;
export const CARD_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

export type CardPhotoRefusal = 'not_jpeg' | 'metadata' | 'size' | 'unreadable';

export const CARD_PHOTO_MESSAGES: Record<CardPhotoRefusal, string> = {
  not_jpeg: 'Take the photo of the card with the camera on this page; uploaded pictures are refused',
  metadata: 'This picture has camera or editing details in it, so it was not taken on this page. Take the photo of the card with the camera here',
  size: 'Take the photo of the card with the camera on this page; this picture is not the size the camera here makes',
  unreadable: 'The photo of the card could not be read. Take it again',
};

export type CardPhotoResult = { ok: true; jpeg: Buffer; width: number; height: number } | { ok: false; reason: CardPhotoRefusal };

/** IFD0 / Exif tags that only a camera or an editor writes (TIFF tag numbers). */
const CAMERA_OR_EDITOR_TAGS = new Set([
  0x010f, // Make
  0x0110, // Model
  0x0131, // Software
  0x0132, // DateTime
  0x013b, // Artist
  0x8825, // GPS IFD pointer
  0x9003, // DateTimeOriginal
  0x9004, // DateTimeDigitized
  0x927c, // MakerNote
  0xa430, // CameraOwnerName
  0xa431, // BodySerialNumber
  0xa433, // LensMake
  0xa434, // LensModel
]);
const EXIF_IFD_POINTER = 0x8769;

interface Segment {
  marker: number;
  data: Buffer;
}

/** The JPEG's marker segments up to the image data (SOS), or null when it isn't a well-formed JPEG. */
function segments(buffer: Buffer): Segment[] | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  const out: Segment[] = [];
  let i = 2;
  while (i + 4 <= buffer.length) {
    if (buffer[i] !== 0xff) return null;
    const marker = buffer[i + 1]!;
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0xd9) break;
    const length = buffer.readUInt16BE(i + 2);
    if (length < 2 || i + 2 + length > buffer.length) return null;
    out.push({ marker, data: buffer.subarray(i + 4, i + 2 + length) });
    if (marker === 0xda) return out; // start of scan: the pixels follow
    i += 2 + length;
  }
  return out.some((s) => s.marker === 0xda) ? out : null;
}

function exifHasCameraOrEditorTags(app1: Buffer): boolean {
  if (app1.subarray(0, 6).toString('latin1') !== 'Exif\u0000\u0000') return false;
  const tiff = app1.subarray(6);
  if (tiff.length < 8) return true;
  const little = tiff.toString('latin1', 0, 2) === 'II';
  const u16 = (o: number) => (little ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const u32 = (o: number) => (little ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
  const scan = (offset: number, depth: number): boolean => {
    if (depth > 2 || offset + 2 > tiff.length) return true; // malformed: treat as suspicious
    const count = u16(offset);
    for (let n = 0; n < count; n += 1) {
      const entry = offset + 2 + n * 12;
      if (entry + 12 > tiff.length) return true;
      const tag = u16(entry);
      if (CAMERA_OR_EDITOR_TAGS.has(tag)) return true;
      if (tag === EXIF_IFD_POINTER && scan(u32(entry + 8), depth + 1)) return true;
    }
    return false;
  };
  return scan(u32(4), 0);
}

/** The first SOFn segment's height and width. */
function frameSize(list: Segment[]): { width: number; height: number } | null {
  const sof = list.find((s) => s.marker >= 0xc0 && s.marker <= 0xcf && s.marker !== 0xc4 && s.marker !== 0xc8 && s.marker !== 0xcc);
  if (!sof || sof.data.length < 5) return null;
  return { height: sof.data.readUInt16BE(1), width: sof.data.readUInt16BE(3) };
}

export function checkCardPhoto(buffer: Buffer | undefined, quality = 85): CardPhotoResult {
  if (!buffer?.length || buffer.length > CARD_PHOTO_MAX_BYTES) return { ok: false, reason: buffer?.length ? 'size' : 'unreadable' };
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) return { ok: false, reason: 'not_jpeg' };
  const list = segments(buffer);
  if (!list) return { ok: false, reason: 'unreadable' };
  for (const segment of list) {
    // APP1: EXIF (camera) or XMP (editors); APP12 "Ducky", APP13 Photoshop/IPTC, APP14 Adobe: editors only.
    if (segment.marker === 0xe1) {
      if (segment.data.subarray(0, 4).toString('latin1') !== 'Exif' || exifHasCameraOrEditorTags(segment.data)) return { ok: false, reason: 'metadata' };
    }
    if (segment.marker === 0xec || segment.marker === 0xed || segment.marker === 0xee) return { ok: false, reason: 'metadata' };
  }
  const size = frameSize(list);
  if (!size) return { ok: false, reason: 'unreadable' };
  const longest = Math.max(size.width, size.height);
  const shortest = Math.min(size.width, size.height);
  if (longest > CARD_PHOTO_MAX_SIDE || shortest < CARD_PHOTO_MIN_SIDE) return { ok: false, reason: 'size' };
  try {
    const image = decodeJpeg(buffer, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 2, maxMemoryUsageInMB: 64 });
    if (image.width !== size.width || image.height !== size.height) return { ok: false, reason: 'unreadable' };
    const jpeg = Buffer.from(encodeJpeg({ data: image.data, width: image.width, height: image.height }, quality).data);
    return { ok: true, jpeg, width: image.width, height: image.height };
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}
