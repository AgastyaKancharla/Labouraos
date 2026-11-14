import type {
  AppConfig,
  AuthResult,
  BusinessForm,
  CallbackRequest,
  CustomerAccount,
  DeletionInfo,
  DeletionResult,
  FormOptions,
  JobSeekerForm,
  Language,
  OtpProof,
  OtpSent,
  PhoneVerified,
  ProfileHome,
  ProfileKind,
  ReferralForm,
  RegisterResult,
  SheetLink,
  SheetPurpose,
  StepUpPurpose,
  VacancyDraft,
  VacancySummary,
} from './types';

/**
 * Everything the screens can ask the server. Two implementations:
 * `liveCustomerApi` (the contract in docs/customer-app-api.md, src/api/live.ts)
 * and `mockCustomerApi` (pretend data, src/api/mock.ts), chosen by
 * EXPO_PUBLIC_API_MODE. Token refresh and the installation header happen in
 * the HTTP client, never in screens.
 */
export interface CustomerApi {
  /** GET /config: is Google on, its client ids, OTP test mode. */
  config(): Promise<AppConfig>;

  // Sign-in (no token yet)
  /** `resendOf` = the previous requestId, for "Resend code". */
  sendSignInOtp(phone: string, resendOf?: string): Promise<OtpSent>;
  verifySignInOtp(input: { phone: string; requestId: string; code: string; contactConsent: boolean }): Promise<AuthResult>;
  signInWithGoogle(idToken: string): Promise<AuthResult>;
  signInWithApple(input: { identityToken: string; fullName: string | null }): Promise<AuthResult>;
  signOut(): Promise<void>;

  // The signed-in account
  me(): Promise<CustomerAccount>;
  updateMe(input: { language?: Language; contactMe?: boolean }): Promise<CustomerAccount>;
  setLastProfile(profileId: string): Promise<void>;
  /** Google / Apple accounts give no phone: verify one before any profile. */
  sendPhoneOtp(input: { phone: string; contactConsent: boolean; resendOf?: string }): Promise<OtpSent>;
  verifyPhoneOtp(input: { phone: string; requestId: string; code: string }): Promise<PhoneVerified>;
  /** A fresh OTP to the verified mobile for a sensitive action (or a registration). */
  sendStepUp(purpose: StepUpPurpose, resendOf?: string): Promise<OtpSent>;

  // Registration
  /** The role picker: starts a sign-up (tracker stage A). Answers the existing profile id when I already have that kind. */
  startSignup(kind: ProfileKind): Promise<{ existingProfileId: string | null }>;
  formOptions(): Promise<FormOptions>;
  /** Under 18 → false. Nothing is stored. */
  ageCheck(dateOfBirth: string): Promise<{ adult: boolean }>;
  registerJobSeeker(form: JobSeekerForm, otp: OtpProof): Promise<RegisterResult>;
  registerBusiness(form: BusinessForm, otp: OtpProof): Promise<RegisterResult>;
  registerReferralPartner(form: ReferralForm, otp: OtpProof): Promise<RegisterResult>;
  /** A fresh link page for the signed-in person, opened in the secure sheet. */
  sheetLink(profileId: string, purpose: SheetPurpose, documentId?: string): Promise<SheetLink>;

  // Home
  home(profileId: string): Promise<ProfileHome>;

  // Business vacancies: a draft, then the contact person's fresh OTP
  createVacancy(profileId: string, draft: VacancyDraft): Promise<VacancySummary>;
  /** `otp` null = retry after the minimum-wage tick with the OTP already checked. */
  confirmVacancy(profileId: string, draftId: string, input: { otp: OtpProof | null; ownerToldMinimumWage: boolean }): Promise<VacancySummary>;

  // Help and privacy
  requestCallback(request: CallbackRequest): Promise<{ id: string }>;
  deletionInfo(): Promise<DeletionInfo>;
  requestDeletion(input: { otp: OtpProof; acceptGuaranteeLoss: boolean }): Promise<DeletionResult>;
}
