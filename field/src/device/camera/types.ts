import type { PhotoStamp } from './stamp';

/**
 * A photo taken with the app's own live camera. There is no way to create
 * one from the gallery: the app never asks for photo-library access.
 * `uri` is a file:// path on the phone app and a data: URL in the web app.
 */
export interface CapturedPhoto {
  uri: string;
  width: number;
  height: number;
  mimeType: 'image/jpeg';
  source: 'live_camera';
  stamp: PhotoStamp;
}
