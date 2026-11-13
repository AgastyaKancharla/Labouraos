/**
 * Every screen's URL in one place (expo-router adds the build's base path:
 * /field on the Render address, none at the root of field.laboura.com). Screens navigate with `router.push(routes.visitStart)`.
 * The comment names the design each route implements.
 */
export const routes = {
  login: '/login', // FA01
  loginCode: '/login-code', // FA02
  home: '/', // FA03
  attendance: '/attendance', // FA04
  visits: '/visits', // FA05
  jobSeekers: '/job-seekers', // FA15
  vacancies: '/vacancies', // FA19
  map: '/map', // FA13
  targets: '/targets', // FA12
  visitStart: '/visit/start', // FA20 (?businessId, ?revisitOf)
  visitTalk: '/visit/talk', // FA21 (?id)
  visitProof: '/visit/proof', // FA22 (?id)
  visitOutcome: '/visit/outcome', // FA06c (?id, ?outcome)
  visitVerify: '/visit/verify', // FA06 (?businessId, ?assignmentId)
  visitDone: '/visit/done', // FA06b (?businessId, ?visitId)
  businessNew: '/business/new', // FA07 (?visitId)
  business: '/business', // FA08: `${routes.business}/${id}`
  callOwner: '/call-owner', // FA18 (?businessId)
  myAttendance: '/my-attendance', // FA04e (CA14e-MyAttendance for the phone)
  myLeave: '/my-attendance/leave', // FA04f (CA14f-RequestLeave)
  myCorrection: '/my-attendance/correction', // FA04h (CA14h-Correction)
  myPayslips: '/my-attendance/payslips', // FA04g (CA14g-Payslip)
  jobSeekerNew: '/job-seeker/new', // FA10
  vacancyNew: '/vacancy/new', // FA17
  feeCalculator: '/fee-calculator', // FA14
  search: '/search', // search on every screen
} as const;

export type RoutePath = (typeof routes)[keyof typeof routes];

const q = (params: Record<string, string | undefined>) => {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v as string)}`);
  return parts.length ? `?${parts.join('&')}` : '';
};
const e = encodeURIComponent;

/**
 * Laboura Field selling flow (FA10–FA19, FA11, FA14, FA18). The Job seekers
 * and Vacancies flows live inside their tabs, so the tab bar stays visible.
 */
export const sellingRoutes = {
  matches: (businessId: string, vacancyId?: string, view?: 'list' | 'map') => `/job-seekers/${e(businessId)}${q({ vacancyId, view })}`, // FA15b / FA15c
  candidate: (jobSeekerId: string, vacancyId: string) => `/job-seekers/candidate/${e(jobSeekerId)}${q({ vacancyId })}`, // FA15d
  call: (vacancyId: string, jobSeekerId: string) => `/job-seekers/call${q({ vacancyId, jobSeekerId })}`, // FA15e
  owner: (interviewId: string) => `/job-seekers/interview/${e(interviewId)}/owner`, // FA15f
  selected: (interviewId: string) => `/job-seekers/interview/${e(interviewId)}/selected`, // FA15s
  booked: (interviewId: string) => `/job-seekers/interview/${e(interviewId)}/booked`, // FA15h
  interviewDay: (interviewId: string) => `/job-seekers/interview/${e(interviewId)}/day`, // FA16
  book: (vacancyId: string, jobSeekerId: string, fromInterviewId?: string) =>
    `/job-seekers/book${q({ vacancyId, jobSeekerId, from: fromInterviewId })}`, // FA15g
  paid: (placementId: string) => `/job-seekers/placement/${e(placementId)}`, // FA15q
  noMore: (vacancyId: string, businessId: string) => `/job-seekers/no-more/${e(vacancyId)}${q({ businessId })}`, // FA15x
  addVacancy: (businessId?: string) => `/vacancies/new${q({ businessId })}`, // FA17
  confirmVacancy: (vacancyId: string) => `/vacancies/confirm/${e(vacancyId)}`, // FA17b
  seekerSaved: (jobSeekerId: string) => `/job-seeker/${e(jobSeekerId)}/saved`, // FA10b
  seekerProgress: (jobSeekerId: string) => `/job-seeker/${e(jobSeekerId)}`, // FA10c
  joining: (placementId: string) => `/placement/${e(placementId)}/joining`, // FA11
  callOwner: (businessId: string) => `/call-owner${q({ businessId })}`, // FA18
} as const;
