import type { ApiClient } from '../client';
import type { StaffIdentity } from '@/auth/session';

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
});
