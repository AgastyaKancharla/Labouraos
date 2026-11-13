import type { ApiClient } from '../client';
import type { CapturedPhoto } from '@/device/camera';
import { appendFile } from '@/device/offline-queue/formFile';

/** GET /staff/me/photo (src/modules/staff/staff-photo.controller.ts). */
export interface StaffPhotoStatus {
  required: boolean;
  /** 'missing': no staff photo yet; 'retake': the CEO asked for a new one. */
  reason: 'missing' | 'retake' | null;
  photoUrl: string | null;
}

/**
 * The staff photo (guide, login codes, 14 Nov): a live camera selfie, so a
 * senior giving a login code can see who is asking. Sent straight away (not
 * queued): the agent waits for it before going on.
 */
export function staffPhotoApi(api: ApiClient) {
  return {
    status: () => api.get<StaffPhotoStatus>('/staff/me/photo'),
    async upload(photo: CapturedPhoto): Promise<StaffPhotoStatus> {
      const form = new FormData();
      form.append('captureSource', 'live_camera');
      await appendFile(form, { field: 'photo', name: 'staff-photo.jpg', type: photo.mimeType, uri: photo.uri });
      return api.request<StaffPhotoStatus>('/staff/me/photo', { method: 'POST', form });
    },
  };
}
