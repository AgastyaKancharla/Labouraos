import type {
  AuthResult,
  BusinessForm,
  CallbackRequest,
  CustomerAccount,
  DeletionResult,
  FormOptions,
  JobSeekerForm,
  Language,
  OtpSent,
  PhoneVerified,
  ProfileHome,
  ReferralForm,
  RegisterResult,
  SheetLink,
  SheetPurpose,
  VacancyDraft,
  VacancySummary,
} from './types';

/**
 * Everything the screens can ask the server. Two implementations:
 * `liveCustomerApi` (the Nest API, src/api/live.ts) and `mockCustomerApi`
 * (pretend data, src/api/mock.ts) chosen by EXPO_PUBLIC_API_MODE.
 */
export interface CustomerApi {
  // Sign-in (no token yet)
  sendSignInOtp(phone: string): Promise<OtpSent>;
  verifySignInOtp(input: { requestId: string; code: string; contactConsent: boolean }): Promise<AuthResult>;
  signInWithGoogle(idToken: string): Promise<AuthResult>;
  signInWithApple(input: { identityToken: string; fullName: string | null }): Promise<AuthResult>;
  signOut(): Promise<void>;

  // The signed-in account
  me(): Promise<CustomerAccount>;
  setLanguage(language: Language): Promise<CustomerAccount>;
  /** Google / Apple accounts give no phone: verify one before any profile. */
  sendPhoneOtp(input: { phone: string; contactConsent: boolean }): Promise<OtpSent>;
  verifyPhoneOtp(input: { requestId: string; code: string }): Promise<PhoneVerified>;

  // Registration
  formOptions(): Promise<FormOptions>;
  registerJobSeeker(form: JobSeekerForm): Promise<RegisterResult>;
  registerBusiness(form: BusinessForm): Promise<RegisterResult>;
  registerReferralPartner(form: ReferralForm): Promise<RegisterResult>;
  /** A fresh link page for the signed-in person, opened in the secure sheet. */
  sheetLink(profileId: string, purpose: SheetPurpose, documentId?: string): Promise<SheetLink>;

  // Home
  home(profileId: string): Promise<ProfileHome>;

  // Business vacancies (drafts, then the contact person's OTP)
  createVacancy(profileId: string, draft: VacancyDraft): Promise<VacancySummary>;
  sendVacancyOtp(profileId: string, vacancyId: string): Promise<OtpSent>;
  confirmVacancy(profileId: string, vacancyId: string, input: { requestId: string; code: string }): Promise<VacancySummary>;

  // Help and privacy
  requestCallback(request: CallbackRequest): Promise<{ id: string }>;
  sendDeletionOtp(): Promise<OtpSent>;
  requestDeletion(input: { requestId: string; code: string; acceptGuaranteeLoss: boolean }): Promise<DeletionResult>;
}
