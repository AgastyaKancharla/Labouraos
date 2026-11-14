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
  help: '/help',
  privacy: '/privacy',
  deleteAccount: '/delete-account',
  settings: '/settings',
  /** Agent C's inbox screen (customer/src/push/). */
  inbox: '/inbox',
} as const;
