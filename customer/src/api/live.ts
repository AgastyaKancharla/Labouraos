import type { ApiClient } from './client';
import type { CustomerApi } from './customerApi';
import type {
  AuthResult,
  CustomerAccount,
  DeletionResult,
  FormOptions,
  OtpSent,
  PhoneVerified,
  ProfileHome,
  RegisterResult,
  SheetLink,
  VacancySummary,
} from './types';

/**
 * The real API. Customer sign-in lives under /customer-auth and everything
 * after sign-in under /me (a customer key is refused by every staff route
 * and the other way round — proposal section 8.1). The server takes "me"
 * from the token; no path here names another person's record.
 *
 * PATHS: written from the proposal before docs/customer-app-api.md existed.
 * Align them with that doc when it lands on main (one file to change).
 */
export function liveCustomerApi(api: ApiClient): CustomerApi {
  const enc = encodeURIComponent;
  return {
    sendSignInOtp: (phone) => api.post<OtpSent>('/customer-auth/otp/send', { phone }, { auth: false }),
    verifySignInOtp: (input) => api.post<AuthResult>('/customer-auth/otp/verify', input, { auth: false }),
    signInWithGoogle: (idToken) => api.post<AuthResult>('/customer-auth/google', { idToken }, { auth: false }),
    signInWithApple: (input) => api.post<AuthResult>('/customer-auth/apple', input, { auth: false }),
    signOut: async () => {
      await api.post('/customer-auth/sign-out', {});
    },

    me: () => api.get<CustomerAccount>('/me'),
    setLanguage: (language) => api.patch<CustomerAccount>('/me', { language }),
    sendPhoneOtp: (input) => api.post<OtpSent>('/me/phone/otp', input),
    verifyPhoneOtp: (input) => api.post<PhoneVerified>('/me/phone/verify', input),

    formOptions: () => api.get<FormOptions>('/me/form-options'),
    registerJobSeeker: (form) => api.post<RegisterResult>('/me/profiles/job-seeker', form),
    registerBusiness: (form) => api.post<RegisterResult>('/me/profiles/business', form),
    registerReferralPartner: (form) => api.post<RegisterResult>('/me/profiles/referral-partner', form),
    sheetLink: (profileId, purpose, documentId) =>
      api.post<SheetLink>(`/me/profiles/${enc(profileId)}/sheet-link`, { purpose, ...(documentId ? { documentId } : {}) }),

    home: (profileId) => api.get<ProfileHome>(`/me/profiles/${enc(profileId)}/home`),

    createVacancy: (profileId, draft) => api.post<VacancySummary>(`/me/profiles/${enc(profileId)}/vacancies`, draft),
    sendVacancyOtp: (profileId, vacancyId) => api.post<OtpSent>(`/me/profiles/${enc(profileId)}/vacancies/${enc(vacancyId)}/otp`, {}),
    confirmVacancy: (profileId, vacancyId, input) =>
      api.post<VacancySummary>(`/me/profiles/${enc(profileId)}/vacancies/${enc(vacancyId)}/confirm`, input),

    requestCallback: (request) => api.post<{ id: string }>('/me/callback-requests', request),
    sendDeletionOtp: () => api.post<OtpSent>('/me/deletion/otp', {}),
    requestDeletion: (input) => api.post<DeletionResult>('/me/deletion', input),
  };
}
