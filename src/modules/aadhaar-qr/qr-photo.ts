import { JpxImage } from 'jpeg2000';
import { encode as encodeJpeg } from 'jpeg-js';

/**
 * The photo inside the Aadhaar Secure QR is JPEG 2000 (a JP2 file or a bare
 * codestream). Browsers can't show it, so it is turned into an ordinary JPEG
 * before it goes to private photo storage for the Team Lead's check.
 *
 * Decoder: `jpeg2000` — Mozilla pdf.js's JPX decoder packaged on its own, in
 * plain JavaScript (no native build, no WebAssembly file to ship), so it runs
 * the same on Render, in the worker and in the tests. Encoder: `jpeg-js`
 * (plain JavaScript too). The QR photo is tiny (about 60 × 80 pixels), so
 * speed doesn't matter.
 */

/** Anything bigger than this is not an Aadhaar QR photo. */
const MAX_SIDE = 1024;

export function jpeg2000ToJpeg(photo: Buffer, quality = 90): Buffer | null {
  if (!photo.length) return null;
  const start = jpeg2000Start(photo);
  if (start < 0) return null;
  try {
    const image = new JpxImage();
    image.parse(photo.subarray(start) as unknown as Uint8Array);
    const { width, height, componentsCount } = image;
    if (!width || !height || width > MAX_SIDE || height > MAX_SIDE || !image.tiles?.length) return null;
    const rgba = Buffer.alloc(width * height * 4, 255);
    for (const tile of image.tiles) {
      const items = tile.items;
      for (let y = 0; y < tile.height; y += 1) {
        for (let x = 0; x < tile.width; x += 1) {
          const tx = tile.left + x;
          const ty = tile.top + y;
          if (tx >= width || ty >= height) continue;
          const src = (y * tile.width + x) * componentsCount;
          const dst = (ty * width + tx) * 4;
          if (componentsCount >= 3) {
            rgba[dst] = items[src]!;
            rgba[dst + 1] = items[src + 1]!;
            rgba[dst + 2] = items[src + 2]!;
          } else {
            rgba[dst] = rgba[dst + 1] = rgba[dst + 2] = items[src]!;
          }
        }
      }
    }
    return Buffer.from(encodeJpeg({ data: rgba, width, height }, quality).data);
  } catch {
    return null;
  }
}

/** Where the JP2 file (signature box) or the raw codestream (SOC + SIZ markers) starts. */
function jpeg2000Start(bytes: Buffer): number {
  const jp2 = bytes.indexOf(Buffer.from([0x00, 0x00, 0x00, 0x0c, 0x6a, 0x50, 0x20, 0x20]));
  const j2k = bytes.indexOf(Buffer.from([0xff, 0x4f, 0xff, 0x51]));
  if (jp2 >= 0 && (j2k < 0 || jp2 < j2k)) return jp2;
  return j2k;
}
