/**
 * Every screen's URL in one place (expo-router adds the build's base path:
 * /field on the Render address, none at the root of field.laboura.com). Screens navigate with `router.push(routes.visitStart)`.
 * The comment names the design each route implements.
 *
 * Five tabs (Laboura Field redesign, decided 16 Nov), each one kind of work,
 * and every screen of a job sits in the stack of the tab the job lives in:
 * Today `/` · Visits `/visits`, `/visit/...` · Businesses `/businesses/...` ·
 * Job seekers `/job-seekers/...` · Me `/me/...`.
 */

/** The tab route names in app/(app)/(tabs)/ (groups in brackets leave the URL unchanged). */
export type TabName = '(today)' | '(visits)' | 'businesses' | 'job-seekers' | 'me';

/** Each tab's main page: where the tab bar, the back arrow's fallback and a finished job return to. */
export const TAB_ROOTS: Record<TabName, string> = {
  '(today)': '/',
  '(visits)': '/visits',
  businesses: '/businesses',
  'job-seekers': '/job-seekers',
  me: '/me',
};

export const routes = {
  login: '/login', // FA01
  loginCode: '/login-code', // FA02
  setup: '/setup', // FA01b: set your password (first login, temporary password)
  forgotPassword: '/forgot-password', // FA01c: forgot password (reset code from a senior)
  // Today
  home: '/', // FA03 Today
  search: '/search', // Search from Today
  feeCalculator: '/fee-calculator', // FA14
  // Visits
  visits: '/visits', // FA05 Visits
  visitsSearch: '/visits/search',
  todaysWork: '/visits/work', // FA05b Today's work (?date=YYYY-MM-DD, ?kind)
  shopsNearMe: '/visits/near', // FA13 Shops near me
  visitStart: '/visit/start', // FA20 (?businessId, ?revisitOf)
  visitTalk: '/visit/talk', // FA21 (?id)
  visitProof: '/visit/proof', // FA22 (?id)
  visitBusiness: '/visit/business', // FA07 (?visitId)
  visitAgreement: '/visit/agreement', // FA07b (?businessId, ?visitId)
  visitVacancies: '/visit/vacancies', // FA07c (?businessId, ?visitId)
  visitDone: '/visit/done', // FA06b ready for candidates (?businessId, ?visitId)
  visitOutcome: '/visit/outcome', // FA06c (?id, ?outcome)
  visitVerify: '/visit/verify', // FA06 (?businessId, ?assignmentId)
  visitPitch: '/visit/pitch', // FA14 during a visit
  // Businesses
  businesses: '/businesses', // FA09 My businesses
  businessesSearch: '/businesses/search',
  // Job seekers
  jobSeekers: '/job-seekers', // FA10d My job seekers
  jobSeekersSearch: '/job-seekers/search',
  jobSeekerNew: '/job-seekers/new', // FA10
  referralNew: '/job-seekers/referral-partner/new', // FA23
  // Me
  me: '/me', // FA24
  meSearch: '/me/search',
  targets: '/me/targets', // FA12
  myDay: '/me/today', // FA04 checked in: status, production, check-in point
  myAttendance: '/me/attendance', // FA04e (CA14e-MyAttendance for the phone)
  myLeave: '/me/attendance/leave', // FA04f (CA14f-RequestLeave)
  myCorrection: '/me/attendance/correction', // FA04h (CA14h-Correction)
  myPayslips: '/me/payslips', // FA04g (CA14g-Payslip)
} as const;

export type RoutePath = (typeof routes)[keyof typeof routes];

/** The search page of each tab, so searching never moves the agent to another tab. */
export const SEARCH_ROUTES: Record<TabName, string> = {
  '(today)': routes.search,
  '(visits)': routes.visitsSearch,
  businesses: routes.businessesSearch,
  'job-seekers': routes.jobSeekersSearch,
  me: routes.meSearch,
};

const q = (params: Record<string, string | undefined>) => {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v as string)}`);
  return parts.length ? `?${parts.join('&')}` : '';
};
const e = encodeURIComponent;

/** Pages addressed by a record id. */
export const pageRoutes = {
  business: (id: string) => `/businesses/${e(id)}`, // FA08 the one business page
  seekerSaved: (jobSeekerId: string) => `/job-seekers/${e(jobSeekerId)}/saved`, // FA10b
  seekerProgress: (jobSeekerId: string) => `/job-seekers/${e(jobSeekerId)}`, // FA10c
  referralSaved: (referralId: string) => `/job-seekers/referral-partner/${e(referralId)}`, // FA23b
  /** FA05d visit details, inside the tab it was opened from. */
  visitDetails: (visitId: string, base: SellingBase = '/visit') =>
    base === '/visit' ? `/visit/details/${e(visitId)}` : `/businesses/visit/${e(visitId)}`,
  todaysWork: (date?: string, kind?: string) => `/visits/work${q({ date, kind })}`, // FA05b
} as const;

/**
 * The candidates flow (FA15b–FA15x, FA16, FA17, FA17b, FA18, FA11) lives in
 * two stacks: Businesses (`/businesses/...`) and, at the end of onboarding a
 * shop, Visits (`/visit/...`), so it never moves the agent to another tab.
 * Screens get the right set from `useSellingRoutes()` (navigation/useFlow.ts).
 */
export type SellingBase = '/businesses' | '/visit';

export function sellingRoutesFor(base: SellingBase) {
  return {
    base,
    matches: (businessId: string, vacancyId?: string, view?: 'list' | 'map') => `${base}/candidates/${e(businessId)}${q({ vacancyId, view })}`, // FA15b / FA15c
    candidate: (jobSeekerId: string, vacancyId: string) => `${base}/candidate/${e(jobSeekerId)}${q({ vacancyId })}`, // FA15d
    call: (vacancyId: string, jobSeekerId: string) => `${base}/call${q({ vacancyId, jobSeekerId })}`, // FA15e
    owner: (interviewId: string) => `${base}/interview/${e(interviewId)}/owner`, // FA15f
    selected: (interviewId: string) => `${base}/interview/${e(interviewId)}/selected`, // FA15s
    booked: (interviewId: string) => `${base}/interview/${e(interviewId)}/booked`, // FA15h
    interviewDay: (interviewId: string) => `${base}/interview/${e(interviewId)}/day`, // FA16
    book: (vacancyId: string, jobSeekerId: string, fromInterviewId?: string) =>
      `${base}/book${q({ vacancyId, jobSeekerId, from: fromInterviewId })}`, // FA15g
    paid: (placementId: string) => `${base}/placement/${e(placementId)}`, // FA15q
    joining: (placementId: string) => `${base}/placement/${e(placementId)}/joining`, // FA11
    noMore: (vacancyId: string, businessId: string) => `${base}/no-more/${e(vacancyId)}${q({ businessId })}`, // FA15x
    addVacancy: (businessId?: string) => `${base}/vacancy/new${q({ businessId })}`, // FA17
    confirmVacancy: (vacancyId: string) => `${base}/vacancy/${e(vacancyId)}`, // FA17b
    callOwner: (businessId: string) => `${base}/call-owner${q({ businessId })}`, // FA18
    /** Back to where the flow started: the business page, or the visit's last step. */
    business: (businessId: string) => (base === '/visit' ? `/visit/done${q({ businessId })}` : `/businesses/${e(businessId)}`),
  } as const;
}

export type SellingRoutes = ReturnType<typeof sellingRoutesFor>;

/** The candidates flow inside the Businesses tab (the default outside a visit). */
export const sellingRoutes = sellingRoutesFor('/businesses');
