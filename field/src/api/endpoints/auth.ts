import type { ApiClient } from '../client';
import type { StaffIdentity } from '@/auth/session';
import type { CapturedPhoto } from '@/device/camera';
import { appendFile } from '@/device/offline-queue/formFile';

/**
 * POST /auth/login with `app: 'field'` → a field agent gets `awaiting_code`.
 * Laboura Field is for field agents only (owner decision 14 Nov): the server
 * refuses every other role with FIELD_APP_ONLY_MESSAGE before any device or
 * code request is made.
 */
export interface AwaitingCodeResponse {
  status: 'awaiting_code';
  loginRequestId: string;
  /** Sent back with the code and the same device id: only this sign-in has it. */
  loginRequestProof: string;
  /** ISO time the code request expires (5 minutes). */
  expiresAt: string;
}

/** Shown once, at the first sign-in after a password reset. */
export interface PasswordResetNotice {
  at: string;
  byName: string | null;
  byRole: string | null;
  how: string;
}

export interface TokenResponse {
  accessToken: string;
  sessionId?: string;
  /** Field agents: restores the session when the app is reopened (single use). */
  refreshToken?: string;
  passwordResetNotice?: PasswordResetNotice;
  staff: StaffIdentity & { email: string | null };
}

/**
 * The temporary password (first login, Master Guide rev 174–175): no session,
 * only a set-up ticket for this phone (15 minutes) — selfie, then a new
 * password typed twice, then sign in normally.
 */
export interface SetupRequiredResponse {
  status: 'setup_required';
  setupTicket: string;
  expiresAt: string;
  staff: { code: string; name: string; role: string };
  photoRequired: boolean;
  authenticatorSetupRequired: boolean;
  authenticatorCodeRequired: boolean;
  passwordRules: { minLength: number; maxBytes: number };
  signInAt: 'field_app' | 'web';
}

/** Forgot password: the same answer whether the staff code exists or not. */
export interface ResetRequestAnswer {
  status: 'requested';
  message: string;
  resetRequestId: string;
  resetRequestProof: string;
  expiresAt: string;
}

export type LoginResponse = AwaitingCodeResponse | TokenResponse | SetupRequiredResponse;

export interface LoginBody {
  staffCode: string;
  password: string;
  deviceId: string;
  /** Always 'field': the server issues Laboura Field sessions to field agents only. */
  app: typeof FIELD_APP;
}

/** This app, as the server names it (src/common/auth/staff-app.ts). */
export const FIELD_APP = 'field';

/** The server's refusal for anyone who is not a field agent (translated as fa01.notForThisApp). */
export const FIELD_APP_ONLY_MESSAGE = 'This app is for field agents. Please sign in at app.laboura.com.';

export interface FieldRefreshBody {
  sessionId: string;
  refreshToken: string;
  deviceId: string;
}

export interface FieldRefreshResponse {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
}

export function isAwaitingCode(response: LoginResponse): response is AwaitingCodeResponse {
  return (response as AwaitingCodeResponse).status === 'awaiting_code';
}

export function isSetupRequired(response: LoginResponse): response is SetupRequiredResponse {
  return (response as SetupRequiredResponse).status === 'setup_required';
}

export const authApi = (api: ApiClient) => ({
  login: (body: Omit<LoginBody, 'app'>) => api.post<LoginResponse>('/auth/login', { ...body, app: FIELD_APP }, { auth: false }),
  /** The code works only for the device and sign-in that asked for it. */
  verifyCode: (loginRequestId: string, code: string, deviceId: string, loginRequestProof: string) =>
    api.post<TokenResponse>('/auth/login/verify-code', { loginRequestId, code, deviceId, loginRequestProof, app: FIELD_APP }, { auth: false }),
  refresh: () => api.post<{ accessToken: string; sessionId: string }>('/auth/refresh'),
  /**
   * No bearer token (it may have run out while the app was closed). The
   * server keeps the 1-hour idle and 2-hour limits and answers 401 with
   * `details.reason` ('idle', 'max_length', 'revoked', 'locked', 'unknown').
   */
  fieldRefresh: (body: FieldRefreshBody) =>
    api.post<FieldRefreshResponse>('/auth/field/refresh', body, { auth: false }),
  logout: () => api.post<{ success: boolean }>('/auth/logout'),
  /** First-login set-up: the live selfie; the ticket and phone id go in headers (checked before the photo is read). */
  async setupPhoto(setupTicket: string, deviceId: string, photo: CapturedPhoto): Promise<{ photoTakenAt: string }> {
    const form = new FormData();
    form.append('captureSource', 'live_camera');
    await appendFile(form, { field: 'photo', name: 'staff-photo.jpg', type: photo.mimeType, uri: photo.uri });
    return api.request<{ photoTakenAt: string }>('/auth/setup/photo', {
      method: 'POST',
      form,
      auth: false,
      headers: { 'x-setup-ticket': setupTicket, 'x-device-id': deviceId },
    });
  },
  /** First-login set-up: the new password (twice). No session: sign in with it after. */
  completeSetup: (body: { setupTicket: string; deviceId: string; newPassword: string; confirmPassword: string }) =>
    api.post<{ success: true; code: string; signInAt: 'field_app' | 'web' }>('/auth/setup/complete', body, { auth: false }),
  requestReset: (staffCode: string, deviceId: string) =>
    api.post<ResetRequestAnswer>('/auth/password-reset/request', { staffCode, deviceId, app: FIELD_APP }, { auth: false }),
  completeReset: (body: { resetRequestId: string; resetRequestProof: string; deviceId: string; code: string; newPassword: string; confirmPassword: string }) =>
    api.post<{ success: true; code: string; signInAt: 'field_app' | 'web' }>('/auth/password-reset/complete', { ...body, app: FIELD_APP }, { auth: false }),
});
