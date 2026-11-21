import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type { PhotoFile } from './types';

/**
 * Makes a fresh camera picture ready to send.
 *
 * - ID card: the server takes a JPEG whose longest side is 240–1280 px, at
 *   most 5 MB, with no camera EXIF (src/modules/aadhaar-qr/id-card-image.ts).
 * - Selfie: an image of at most 5 MB; kept at 960 px wide, plenty for a
 *   face on a profile.
 *
 * The picture is always drawn again and saved as a new JPEG, which leaves
 * the camera's EXIF (place, phone model, time) behind.
 */
export const CARD_LONGEST_SIDE = 1280;
export const SELFIE_WIDTH = 960;
const MIN_SIDE = 240;

export type PhotoKind = 'selfie' | 'card';

export async function preparePhoto(shot: { uri: string; width: number; height: number }, kind: PhotoKind): Promise<PhotoFile> {
  const context = ImageManipulator.manipulate(shot.uri);
  if (kind === 'card') {
    const longest = Math.max(shot.width, shot.height);
    if (longest < MIN_SIDE) throw new Error('PHOTO_TOO_SMALL');
    if (longest > CARD_LONGEST_SIDE) {
      context.resize(shot.width >= shot.height ? { width: CARD_LONGEST_SIDE } : { height: CARD_LONGEST_SIDE });
    }
  } else if (shot.width > SELFIE_WIDTH) {
    context.resize({ width: SELFIE_WIDTH });
  }
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ compress: 0.85, format: SaveFormat.JPEG });
  return { uri: saved.uri, name: kind === 'card' ? 'id-card.jpg' : 'selfie.jpg', type: 'image/jpeg' };
}
