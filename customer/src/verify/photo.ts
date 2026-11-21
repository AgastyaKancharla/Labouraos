import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type { PhotoFile } from './types';

/**
 * Makes a fresh camera picture ready to send.
 *
 * - ID card: the server takes a JPEG whose longest side is at most 1280 px
 *   and whose shortest side is at least 240 px, at most 5 MB, with no camera
 *   EXIF (src/modules/aadhaar-qr/id-card-image.ts).
 * - Selfie: an image of at most 5 MB; kept at 960 px wide, plenty for a
 *   face on a profile.
 *
 * The picture is always drawn again and saved as a new JPEG, which leaves
 * the camera's EXIF (place, phone model, time) behind. Sizes are read from
 * the drawn picture (already turned the right way up), not from what the
 * camera reported. The camera's own file is deleted straight away.
 */
export const CARD_LONGEST_SIDE = 1280;
export const CARD_SHORTEST_SIDE = 240;
export const SELFIE_WIDTH = 960;

export type PhotoKind = 'selfie' | 'card';

export async function preparePhoto(shotUri: string, kind: PhotoKind): Promise<PhotoFile> {
  try {
    let image = await ImageManipulator.manipulate(shotUri).renderAsync();
    const { width, height } = image;
    if (kind === 'card') {
      if (Math.min(width, height) < CARD_SHORTEST_SIDE) throw new Error('PHOTO_TOO_SMALL');
      if (Math.max(width, height) > CARD_LONGEST_SIDE) {
        image = await ImageManipulator.manipulate(image)
          .resize(width >= height ? { width: CARD_LONGEST_SIDE } : { height: CARD_LONGEST_SIDE })
          .renderAsync();
      }
    } else if (width > SELFIE_WIDTH) {
      image = await ImageManipulator.manipulate(image).resize({ width: SELFIE_WIDTH }).renderAsync();
    }
    const saved = await image.saveAsync({ compress: 0.85, format: SaveFormat.JPEG });
    return { uri: saved.uri, name: kind === 'card' ? 'id-card.jpg' : 'selfie.jpg', type: 'image/jpeg' };
  } finally {
    discardPhoto(shotUri);
  }
}

/** Deletes a photo from the app's cache once it is sent or taken again: no picture of an ID card stays on the phone. */
export function discardPhoto(uri: string | null | undefined): void {
  if (!uri) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Already gone, or not ours to delete: the cache is cleared by the phone anyway.
  }
}
