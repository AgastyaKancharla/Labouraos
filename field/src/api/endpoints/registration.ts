import type { ApiClient } from '../client';

/** GET /screens/call-registration/options — the managed list of Bengaluru areas. */
export interface Area {
  name: string;
  pincode: string;
  latitude: number;
  longitude: number;
}

/** GET /trades — trade list with the usual salary range and legal minimum (paise / month). */
export interface Trade {
  id: string;
  name: string;
  salaryMinPaise: number;
  salaryMaxPaise: number;
  minimumWageLevel: string;
  legalMinimumPaise: number;
}

export interface OtpSendResult {
  success?: boolean;
  requestId?: string;
  resendAvailableAt?: string;
  resendsLeft?: number;
  alreadyRegistered?: boolean;
  existingCode?: string;
}

export const registrationApi = (api: ApiClient) => ({
  options: () => api.get<{ city: string; areas: Area[]; areaAutoFillMaxMeters?: number }>('/screens/call-registration/options'),
  trades: () => api.get<Trade[]>('/trades'),
  /** Live: the contact person reads the code out. */
  sendOtp: (phone: string, requestId?: string) =>
    api.post<OtpSendResult>('/otp/send', { phone, purpose: 'business_contact', ...(requestId ? { requestId } : {}) }),
  verifyOtp: (requestId: string, code: string) => api.post<{ verified: boolean }>('/otp/verify', { requestId, code }),
  createBusiness: (body: Record<string, unknown>) => api.post<{ id: string; code: string; name: string }>('/businesses', body),
});
