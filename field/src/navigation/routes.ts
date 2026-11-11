/**
 * Every screen's URL in one place (with the web app's /field prefix added by
 * expo-router). Screens navigate with `router.push(routes.visitStart)`.
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
  myAttendance: '/my-attendance', // attendance, leave & payslips
  jobSeekerNew: '/job-seeker/new', // FA10
  vacancyNew: '/vacancy/new', // FA17
  feeCalculator: '/fee-calculator', // FA14
  search: '/search', // search on every screen
} as const;

export type RoutePath = (typeof routes)[keyof typeof routes];
