/**
 * Every screen's address (expo-router, files under customer/app/).
 * Navigate with router.push(routes.x) — never a typed string.
 */
export const routes = {
  start: '/',
  welcome: '/welcome',
  signIn: '/sign-in',
  signInPhone: '/sign-in-phone',
  verifyPhone: '/verify-phone',
  role: '/role',
  profiles: '/profiles',
  registerJobSeeker: '/register/job-seeker',
  registerBusiness: '/register/business',
  registerReferral: '/register/referral',
  home: '/home',
  addVacancy: '/vacancy/new',
  /** Confirm an existing draft vacancy by OTP. */
  confirmVacancy: (vacancyId: string) => `/vacancy/new?vacancyId=${encodeURIComponent(vacancyId)}`,
  /** "A worker left" (contract 8.2). */
  workers: '/workers',
  /** Referral partner: send a lead (contract 7.3b). */
  referralLead: '/referral-lead',
  /** The verification steps in the app's own screens (consent, selfie, ID, ₹499; partner terms/ID/UPI; business agreement). */
  verify: (purpose: 'registration' | 'referral_registration' | 'business_agreement', profileId: string) =>
    `/verify/${purpose}?profileId=${encodeURIComponent(profileId)}`,
  help: '/help',
  privacy: '/privacy',
  deleteAccount: '/delete-account',
  settings: '/settings',
  /** Agent C's inbox screen (customer/src/push/). */
  inbox: '/inbox',
} as const;
