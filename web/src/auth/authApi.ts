import { api } from '../lib/api/client';
import { getDeviceId } from './device';

/**
 * The staff sign-in endpoints (src/common/auth in the API):
 *
 *   POST /auth/login              { staffCode, password, deviceId, totpCode? }
 *        → token                  (management with authenticator, or not yet enrolled → totp_setup token)
 *        → { status: 'awaiting_code', loginRequestId, loginRequestProof, expiresAt }   (Team Lead, agents)
 *        → 401 "TOTP 2FA code is required"   (management: password right, ask for the code)
 *   POST /auth/login/verify-code  { loginRequestId, code, deviceId, loginRequestProof } → token
 *        (the code works only for the device and sign-in that asked for it)
 *   POST /auth/refresh            (Bearer) → { accessToken, sessionId }
 *   POST /auth/logout             (Bearer)
 *   POST /staff/2fa/setup         (Bearer, setup token) → { secret, otpauthUrl }
 *   POST /staff/2fa/enable        (Bearer, setup token) { totpCode }
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

export interface TokenResponse {
  accessToken: string;
  sessionId?: string;
  totpEnrollmentRequired?: boolean;
  staff: LoginStaff;
}

export interface AwaitingCodeResponse {
  status: 'awaiting_code';
  loginRequestId: string;
  /** Sent back with the code: only this sign-in has it. */
  loginRequestProof: string;
  expiresAt: string;
}

export type LoginResponse = TokenResponse | AwaitingCodeResponse;

export function isAwaitingCode(r: LoginResponse): r is AwaitingCodeResponse {
  return (r as AwaitingCodeResponse).status === 'awaiting_code';
}

/** The API's wording when a management password was right but no code was sent. */
export const TOTP_REQUIRED_MESSAGE = 'TOTP 2FA code is required';

export const authApi = {
  login: (input: { staffCode: string; password: string; totpCode?: string }) =>
    api.post<LoginResponse>('/auth/login', { ...input, deviceId: getDeviceId() }, { auth: false }),
  verifyCode: (loginRequestId: string, code: string, loginRequestProof: string) =>
    api.post<TokenResponse>(
      '/auth/login/verify-code',
      { loginRequestId, code, deviceId: getDeviceId(), loginRequestProof },
      { auth: false },
    ),
  refresh: () => api.post<{ accessToken: string; sessionId: string }>('/auth/refresh'),
  logout: (token?: string) => api.post<{ success: boolean }>('/auth/logout', {}, token ? { token } : undefined),
  setupTotp: (token: string) => api.post<{ secret: string; otpauthUrl: string }>('/staff/2fa/setup', {}, { token }),
  enableTotp: (token: string, totpCode: string) =>
    api.post<{ success: boolean; message: string }>('/staff/2fa/enable', { totpCode }, { token }),
};
