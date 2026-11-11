import type { ApiClient } from '../client';
import type { StaffIdentity } from '@/auth/session';

/** POST /auth/login → field agents get `awaiting_code`; management gets a token. */
export interface AwaitingCodeResponse {
  status: 'awaiting_code';
  loginRequestId: string;
  /** ISO time the code request expires (5 minutes). */
  expiresAt: string;
}

export interface TokenResponse {
  accessToken: string;
  sessionId?: string;
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

export function isAwaitingCode(response: LoginResponse): response is AwaitingCodeResponse {
  return (response as AwaitingCodeResponse).status === 'awaiting_code';
}

export const authApi = (api: ApiClient) => ({
  login: (body: LoginBody) => api.post<LoginResponse>('/auth/login', body, { auth: false }),
  verifyCode: (loginRequestId: string, code: string) =>
    api.post<TokenResponse>('/auth/login/verify-code', { loginRequestId, code }, { auth: false }),
  refresh: () => api.post<{ accessToken: string; sessionId: string }>('/auth/refresh'),
  logout: () => api.post<{ success: boolean }>('/auth/logout'),
});
