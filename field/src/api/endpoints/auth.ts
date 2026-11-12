import type { ApiClient } from '../client';
import type { StaffIdentity } from '@/auth/session';

/** POST /auth/login → field agents get `awaiting_code`; management gets a token. */
export interface AwaitingCodeResponse {
  status: 'awaiting_code';
  loginRequestId: string;
  /** Sent back with the code and the same device id: only this sign-in has it. */
  loginRequestProof: string;
  /** ISO time the code request expires (5 minutes). */
  expiresAt: string;
}

export interface TokenResponse {
  accessToken: string;
  sessionId?: string;
  /** Field agents: restores the session when the app is reopened (single use). */
  refreshToken?: string;
  totpEnrollmentRequired?: boolean;
  staff: StaffIdentity & { email: string | null };
}

export type LoginResponse = AwaitingCodeResponse | TokenResponse;

export interface LoginBody {
  staffCode: string;
  password: string;
  deviceId: string;
  /** Management accounts only (authenticator app). */
  totpCode?: string;
}

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

export const authApi = (api: ApiClient) => ({
  login: (body: LoginBody) => api.post<LoginResponse>('/auth/login', body, { auth: false }),
  /** The code works only for the device and sign-in that asked for it. */
  verifyCode: (loginRequestId: string, code: string, deviceId: string, loginRequestProof: string) =>
    api.post<TokenResponse>('/auth/login/verify-code', { loginRequestId, code, deviceId, loginRequestProof }, { auth: false }),
  refresh: () => api.post<{ accessToken: string; sessionId: string }>('/auth/refresh'),
  /**
   * No bearer token (it may have run out while the app was closed). The
   * server keeps the 1-hour idle and 2-hour limits and answers 401 with
   * `details.reason` ('idle', 'max_length', 'revoked', 'locked', 'unknown').
   */
  fieldRefresh: (body: FieldRefreshBody) =>
    api.post<FieldRefreshResponse>('/auth/field/refresh', body, { auth: false }),
  logout: () => api.post<{ success: boolean }>('/auth/logout'),
});
