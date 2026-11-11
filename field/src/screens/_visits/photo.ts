import { stampFormFields, type CapturedPhoto } from '@/device/camera';
import type { QueuedRequest } from '@/device/offline-queue';

/** A live photo as a queued multipart upload: the stamp fields plus the file. */
export function photoRequest(path: string, photo: CapturedPhoto, fields: Record<string, string>, name: string): QueuedRequest {
  return {
    method: 'POST',
    path,
    fields: { ...stampFormFields(photo.stamp), ...fields },
    files: [{ field: 'photo', name, type: photo.mimeType, uri: photo.uri }],
  };
}
