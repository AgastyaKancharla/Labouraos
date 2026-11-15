import { api } from '../lib/api/client';
import { getDeviceId } from './device';

/**
 * The staff sign-in endpoints (src/common/auth in the API):
 *
 *   POST /auth/login              { staffCode, password, deviceId, totpCode?, app: 'office' }
 *        → token                  (CEO, Manager, Finance, Team Lead with their authenticator code)
 *        → { status: 'awaiting_code', loginRequestId, loginRequestProof, expiresAt }   (call agents)
 *        → { status: 'setup_required', setupTicket, … }   (the temporary password: first login)
 *        → 401 "TOTP 2FA code is required"   (authenticator role: password right, ask for the code)
 *   POST /auth/login/verify-code  { loginRequestId, code, deviceId, loginRequestProof } → token
 *   POST /auth/setup/photo | /auth/setup/authenticator | /auth/setup/complete   (set-up ticket only)
 *   POST /auth/password-reset/request  { staffCode, deviceId } → the same answer for every staff code
 *   POST /auth/password-reset/complete { resetRequestId, resetRequestProof, deviceId, code, newPassword, totpCode? }
 *   POST /auth/refresh            (Bearer) → { accessToken, sessionId }
 *   POST /auth/logout             (Bearer)
 *
 * Tokens last 15 minutes; the session lasts at most 2 hours and ends after
 * 60 minutes without activity (both enforced by the API).
 */
export interface LoginStaff {
  id: string;
  code: string;
  name: string;
  email: string | null;
  role: string;
}

/** Shown once at the first sign-in after a password reset. */
export interface PasswordResetNotice {
  at: string;
  byName: string | null;
  byRole: string | null;
  how: string;
}

export interface TokenResponse {
  accessToken: string;
  sessionId?: string;
  passwordResetNotice?: PasswordResetNotice;
  staff: LoginStaff;
}

/** First sign-in with a temporary password: no session, only the set-up steps on this device. */
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

export interface ResetRequestAnswer {
  status: 'requested';
  message: string;
  resetRequestId: string;
  resetRequestProof: string;
  expiresAt: string;
}

export interface AwaitingCodeResponse {
  status: 'awaiting_code';
  loginRequestId: string;
  /** Sent back with the code: only this sign-in has it. */
  loginRequestProof: string;
  expiresAt: string;
}

export type LoginResponse = TokenResponse | AwaitingCodeResponse | SetupRequiredResponse;

export function isAwaitingCode(r: LoginResponse): r is AwaitingCodeResponse {
  return (r as AwaitingCodeResponse).status === 'awaiting_code';
}

export function isSetupRequired(r: LoginResponse): r is SetupRequiredResponse {
  return (r as SetupRequiredResponse).status === 'setup_required';
}

/** Each app accepts only its own roles (owner decision 14 Nov): this is the office app. */
export const OFFICE_APP = 'office';

/** The API's wording when an authenticator role's password was right but no code was sent. */
export const TOTP_REQUIRED_MESSAGE = 'TOTP 2FA code is required';

export const authApi = {
  login: (input: { staffCode: string; password: string; totpCode?: string }) =>
    // This is the office app: the API refuses field agents here (they use Laboura Field).
    api.post<LoginResponse>('/auth/login', { ...input, deviceId: getDeviceId(), app: OFFICE_APP }, { auth: false }),
  verifyCode: (loginRequestId: string, code: string, loginRequestProof: string) =>
    api.post<TokenResponse>(
      '/auth/login/verify-code',
      { loginRequestId, code, deviceId: getDeviceId(), loginRequestProof, app: OFFICE_APP },
      { auth: false },
    ),
  refresh: () => api.post<{ accessToken: string; sessionId: string }>('/auth/refresh'),
  logout: (token?: string) => api.post<{ success: boolean }>('/auth/logout', {}, token ? { token } : undefined),
  /** First-login set-up: the QR code for a new authenticator (set-up ticket, this device). */
  setupAuthenticator: (setupTicket: string) =>
    api.post<{ secret: string; otpauthUrl: string }>('/auth/setup/authenticator', { setupTicket, deviceId: getDeviceId() }, { auth: false }),
  /** First-login set-up: the new password (twice) and the authenticator code; no session — sign in after. */
  completeSetup: (input: { setupTicket: string; newPassword: string; confirmPassword: string; totpCode?: string }) =>
    api.post<{ success: true; code: string; signInAt: 'field_app' | 'web' }>('/auth/setup/complete', { ...input, deviceId: getDeviceId() }, { auth: false }),
  /** Forgot password: always the same answer, whether or not the staff code exists. */
  requestReset: (staffCode: string) =>
    api.post<ResetRequestAnswer>('/auth/password-reset/request', { staffCode, deviceId: getDeviceId(), app: OFFICE_APP }, { auth: false }),
  completeReset: (input: { resetRequestId: string; resetRequestProof: string; code: string; newPassword: string; confirmPassword: string; totpCode?: string }) =>
    api.post<{ success: true; code: string; signInAt: 'field_app' | 'web' }>(
      '/auth/password-reset/complete',
      { ...input, deviceId: getDeviceId(), app: OFFICE_APP },
      { auth: false },
    ),
};

/** The set-up ticket's headers for the selfie upload (checked before the photo is read). */
export function setupTicketHeaders(setupTicket: string): Record<string, string> {
  return { 'x-setup-ticket': setupTicket, 'x-device-id': getDeviceId() };
}
