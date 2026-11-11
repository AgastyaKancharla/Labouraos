import { formatStampIst } from '@/lib/format';
import { formatCoordinates } from '@/device/location/location';
import type { GpsFix } from '@/device/location/types';

/**
 * What a live photo carries as proof (guide: "camera only, stamped with
 * time and place"). The same values are drawn on the picture (web app) and
 * sent with the upload as fields, so the server never has to trust pixels.
 */
export interface PhotoStamp {
  /** ISO time the shutter was pressed (phone clock; the server records its own time too). */
  takenAt: string;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  /** Lines drawn on the photo, top to bottom. */
  lines: string[];
}

export function buildStamp(takenAt: Date, fix: GpsFix | null, label?: string): PhotoStamp {
  const lines = [formatStampIst(takenAt)];
  if (fix) lines.push(`${formatCoordinates(fix)} ±${Math.round(fix.accuracy)} m`);
  else lines.push('Location not available');
  if (label) lines.push(label);
  return {
    takenAt: takenAt.toISOString(),
    latitude: fix ? fix.latitude : null,
    longitude: fix ? fix.longitude : null,
    accuracy: fix ? Math.round(fix.accuracy) : null,
    lines,
  };
}

/** The stamp as multipart form fields, next to the photo itself. */
export function stampFormFields(stamp: PhotoStamp): Record<string, string> {
  const fields: Record<string, string> = { takenAt: stamp.takenAt, source: 'live_camera' };
  if (stamp.latitude !== null) fields.latitude = String(stamp.latitude);
  if (stamp.longitude !== null) fields.longitude = String(stamp.longitude);
  if (stamp.accuracy !== null) fields.accuracy = String(stamp.accuracy);
  return fields;
}
