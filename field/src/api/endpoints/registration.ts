import type { ApiClient } from '../client';

/** GET /screens/call-registration/options — the managed list of Bengaluru areas. */
export interface Area {
  name: string;
  pincode: string;
  latitude: number;
  longitude: number;
}

/**
 * GET /trades — trade list with the usual salary range and legal minimum
 * (paise / month). `legalMinimumPaise` is for the business's zone when the
 * request names a business (rev 193), else Zone 1's (the default when unsure;
 * the server checks the real zone when the vacancy is sent to the owner).
 */
export interface Trade {
  id: string;
  name: string;
  salaryMinPaise: number;
  salaryMaxPaise: number;
  minimumWageLevel: string;
  legalMinimumPaise: number;
  legalMinimumPaiseByZone?: Record<'1' | '2' | '3', number>;
}

export interface OtpSendResult {
  success?: boolean;
  requestId?: string;
  resendAvailableAt?: string;
  resendsLeft?: number;
  /** The number already belongs to a record (the server's one-phone-one-record rule); type and code only when visible. */
  alreadyRegistered?: boolean;
  type?: 'job_seeker' | 'business' | 'referral';
  code?: string;
  /** Older name of `code`, still accepted when reading (lib/otp-send.ts). */
  existingCode?: string;
}

export const registrationApi = (api: ApiClient) => ({
  options: () => api.get<{ city: string; areas: Area[]; areaAutoFillMaxMeters?: number }>('/screens/call-registration/options'),
  trades: () => api.get<Trade[]>('/trades'),
  /** Live: the contact person reads the code out. */
  sendOtp: (phone: string, requestId?: string, channel?: 'sms') =>
    api.post<OtpSendResult>('/otp/send', { phone, purpose: 'business_contact', ...(requestId ? { requestId } : {}), ...(channel ? { channel } : {}) }),
  verifyOtp: (requestId: string, code: string) => api.post<{ verified: boolean }>('/otp/verify', { requestId, code }),
  createBusiness: (body: Record<string, unknown>) => api.post<{ id: string; code: string; name: string }>('/businesses', body),
});
