import type { PhotoStamp } from './stamp';

/**
 * Phone app: the stamp travels as upload fields (see stampFormFields); the
 * picture itself is sent unchanged. Drawing it onto the pixels on Android
 * and iPhone comes with the store builds (it needs a native image library).
 */
export async function burnStamp(uri: string, _stamp: PhotoStamp): Promise<{ uri: string; width?: number; height?: number }> {
  return { uri };
}
