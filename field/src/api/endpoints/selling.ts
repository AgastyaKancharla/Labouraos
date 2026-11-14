import type { ApiClient } from '../client';
import type { Area, Trade } from './registration';

/**
 * Laboura Field selling: src/modules/field-selling (reads under
 * /screens/field-selling, writes under /field-selling), plus the existing
 * vacancy, OTP, job seeker registration, call and placement endpoints the
 * call agent console uses.
 */
export interface SellingSettings {
  feePercent: number;
  gstPercent: number;
  walkInStart: string;
  walkInEnd: string;
  callingHoursStart: string;
  callingHoursEnd: string;
  interviewResultDeadline: string;
  placementPaymentDueHours: number;
  maxFreeReplacements: number;
  replacementWindowDays: number;
  threeWayCalls: boolean;
  notSelectedReasons: string[];
}

export interface BusinessHit {
  id: string;
  code: string;
  name: string;
  locality: string | null;
  verificationStatus: string | null;
  agreementSigned: boolean;
  signedToday: boolean;
  canShowCandidates: boolean;
  paused: boolean;
  isMine: boolean;
  openVacancies: number;
  waitingForOtp: number;
  vacancies: { id: string; trade: string; headcount: number; status: string }[];
}

export interface VacancyRow {
  id: string;
  code: string;
  trade: string;
  roleTitle: string | null;
  headcount: number;
  salaryMinPaise: number | null;
  salaryMaxPaise: number | null;
  salaryPeriod: string | null;
  shift: string | null;
  startDate: string | null;
  status: string;
  confirmedAt: string | null;
  confirmedByName: string | null;
  contactName: string | null;
  contactRole: string | null;
  contactPhoneLast4: string;
}

export interface BusinessDetail {
  id: string;
  code: string;
  name: string;
  locality: string | null;
  verificationStatus: string | null;
  agreementSigned: boolean;
  signedToday: boolean;
  canShowCandidates: boolean;
  paused: boolean;
  isMine: boolean;
  latitude: number | null;
  longitude: number | null;
  contactName: string | null;
  contactRole: string | null;
  contactPhoneLast4: string;
  contactLanguage: string | null;
  vacancies: VacancyRow[];
}

export interface MatchCard {
  jobSeekerId: string;
  code: string | null;
  card: {
    firstName: string;
    photoUrl: string | null;
    age: number;
    trade: string;
    yearsExperience: number;
    languages: string[];
    distanceKm: number;
    expectedSalary: { minPaise: number; maxPaise: number };
    matchReasons: string[];
  };
  matchReasons: string[];
  priority: boolean;
  liked: boolean;
  area: { locality: string | null; latitude: number | null; longitude: number | null };
}

export interface MatchesPage {
  vacancyId: string;
  business: { id: string; name: string; latitude: number | null; longitude: number | null };
  page: number;
  pageSize: number;
  total: number;
  likedCount: number;
  matches: MatchCard[];
}

export interface NoMore {
  vacancyId: string;
  trade: string;
  businessName: string;
  headcount: number;
  totalShown: number;
  vacancyMaxPaise: number;
  withinDistance: number;
  leftOutSalaryAbove: number;
  leftOutShift: number;
  raiseToPaise: number | null;
}

export interface CandidateCard {
  jobSeekerId: string;
  code: string;
  firstName: string;
  age: number | null;
  trade: string | null;
  yearsExperience: number | null;
  distanceKm: number | null;
  locality: string | null;
  expectedSalary: { minPaise: number; maxPaise: number };
  languages: string[];
  shift: string | null;
  availableFrom: string | null;
  availableNow: boolean;
  lastRole: string | null;
  lastEmployer: string | null;
  idVerified: boolean;
  guaranteeDay: number | null;
  guaranteeDays: number;
  suitable: boolean;
  liked: boolean;
  vacancy: {
    id: string;
    trade: string;
    locality: string | null;
    shift: string | null;
    salaryMinPaise: number | null;
    salaryMaxPaise: number | null;
    businessName: string;
    businessId: string;
  };
}

export interface PlacementSummary {
  id: string;
  code: string;
  status: string;
  agreedSalaryPaise: number;
  feePaise: number;
  gstPaise: number;
  feePercent: number | null;
  gstPercent: number | null;
  paymentDueAt: string | null;
  paidAt: string | null;
  joiningDate: string | null;
  paymentStatus: string | null;
}

export interface InterviewView {
  id: string;
  code: string;
  status: string;
  interviewType: string | null;
  result: string | null;
  resultReason: string | null;
  resultRecordedAt: string | null;
  resultDueAt: string;
  slotStartsAt: string;
  slotEndsAt: string;
  offerSentAt: string;
  replyDueAt: string;
  candidateRespondedAt: string | null;
  offerMessagesSent: number;
  businessDetailsSentAt: string | null;
  agentWillAttend: boolean;
  agentAttendanceRequired: boolean;
  firstWithBusiness: boolean;
  handedToOwnerAt: string | null;
  candidateArrivedAt: string | null;
  arrivalDistanceM: number | null;
  candidateCheckAnswer: string | null;
  resultRequestSentAt: string | null;
  selectedSalaryPaise: number | null;
  selectedJoiningDate: string | null;
  call: { id: string; answered: boolean; providerStatus: string; startedAt: string | null; answeredAt: string | null } | null;
  candidate: { id: string; code: string; firstName: string };
  business: {
    id: string;
    name: string;
    locality: string | null;
    latitude: number | null;
    longitude: number | null;
    contactName: string | null;
    contactRole: string | null;
    contactPhoneLast4: string;
  };
  vacancy: {
    id: string;
    trade: string;
    roleTitle: string | null;
    locality: string | null;
    shift: string | null;
    salaryMinPaise: number | null;
    salaryMaxPaise: number | null;
    salaryPeriod: string | null;
  };
  placement: PlacementSummary | null;
}

export interface CallRow {
  id: string;
  subjectType: string;
  answered: boolean;
  durationSec: number | null;
  agentOutcome: string | null;
  createdAt: string;
}

export interface PlacementView {
  id: string;
  code: string;
  status: string;
  candidate: { id: string; code: string; firstName: string };
  business: { id: string; name: string; contactName: string | null };
  trade: string;
  totalPaise: number;
  paidAt: string | null;
  paymentStatus: string | null;
  paymentConfirmedAt: string | null;
  joiningDate: string | null;
  joinedDate: string | null;
  joiningNoShowReportedAt: string | null;
  invoiceCode: string | null;
  workerCall: CallRow | null;
  ownerCall: CallRow | null;
  comingUp: { dayCheckIn7: string | null; dayCheckIn30: string | null; joiningRewardAfterDays: number; completesAt: string | null };
  nextVacancies: { id: string; trade: string; headcount: number }[];
}

export interface BookingContext {
  vacancyId: string;
  trade: string;
  businessName: string;
  candidateFirstName: string;
  attendanceRequired: boolean;
  walkInStart: string;
  walkInEnd: string;
  threeWayCalls: boolean;
}

export interface CallStatus {
  id: string;
  answered: boolean;
  providerStatus: string;
  startedAt?: string | null;
  answeredAt?: string | null;
  endedAt?: string | null;
}

export interface OtpSent {
  otpRequestId: string;
  sentToLast4: string;
  contactName: string | null;
  contactRole?: string | null;
  resendAvailableAt?: string;
  resendsLeft?: number;
}

export interface DecisionBody {
  decision: 'selected' | 'not_selected';
  salaryPaise?: number;
  joiningDate?: string;
  reason?: string;
}

export interface BookBody {
  date: string;
  time: string;
  type: 'at_shop' | 'walk_in' | 'phone';
  agentWillAttend?: boolean;
}

export interface BookResult {
  interviewId: string;
  type: string;
  slotStartsAt: string;
  slotEndsAt: string;
  agentWillAttend: boolean;
}

const enc = encodeURIComponent;

export const sellingApi = (api: ApiClient) => ({
  settings: () => api.get<SellingSettings>('/screens/field-selling/settings'),
  businesses: (q?: string) => api.get<{ query: string; results: BusinessHit[] }>('/screens/field-selling/businesses', { query: { q } }),
  business: (id: string) => api.get<BusinessDetail>(`/screens/field-selling/businesses/${enc(id)}`),
  matches: (vacancyId: string, page: number) => api.get<MatchesPage>(`/screens/field-selling/vacancies/${enc(vacancyId)}/matches`, { query: { page } }),
  noMore: (vacancyId: string) => api.get<NoMore>(`/screens/field-selling/vacancies/${enc(vacancyId)}/no-more`),
  booking: (vacancyId: string, jobSeekerId: string) =>
    api.get<BookingContext>(`/screens/field-selling/vacancies/${enc(vacancyId)}/booking`, { query: { jobSeekerId } }),
  candidate: (jobSeekerId: string, vacancyId: string) =>
    api.get<CandidateCard>(`/screens/field-selling/candidates/${enc(jobSeekerId)}`, { query: { vacancyId } }),
  interview: (id: string) => api.get<InterviewView>(`/screens/field-selling/interviews/${enc(id)}`),
  placement: (id: string) => api.get<PlacementView>(`/screens/field-selling/placements/${enc(id)}`),
  recentVacancies: () => api.get<{ results: BusinessHit[] }>('/screens/field-selling/recent-vacancies'),
  showInPerson: (vacancyId: string, jobSeekerIds: string[]) =>
    api.post<{ count: number }>(`/vacancies/${enc(vacancyId)}/introductions/in-person`, { jobSeekerIds }),
  callCandidate: (vacancyId: string, jobSeekerId: string) => api.post<{ callRecordId: string }>('/field-selling/calls', { vacancyId, jobSeekerId }),
  call: (id: string) => api.get<CallStatus>(`/calls/${enc(id)}`),
  answer: (callRecordId: string, answer: 'yes' | 'no', reason?: string) =>
    api.post<{ interviewId: string; status: string; hit: boolean }>(`/field-selling/calls/${enc(callRecordId)}/answer`, { answer, reason }),
  handOver: (interviewId: string) => api.post(`/field-selling/interviews/${enc(interviewId)}/hand-over`),
  ownerOtp: (interviewId: string, body: DecisionBody & { otpRequestId?: string }) =>
    api.post<OtpSent>(`/field-selling/interviews/${enc(interviewId)}/owner-otp`, body),
  decision: (interviewId: string, body: DecisionBody & { otpRequestId: string; code: string }) =>
    api.post<{ interviewId: string; decision: string; placement: { id: string } | null }>(`/field-selling/interviews/${enc(interviewId)}/decision`, body),
  meet: (interviewId: string, body: BookBody) => api.post<BookResult>(`/field-selling/interviews/${enc(interviewId)}/meet`, body),
  book: (body: BookBody & { vacancyId: string; jobSeekerId: string }) => api.post<BookResult>('/field-selling/interviews', body),
  arrival: (interviewId: string, body: { arrived: boolean; latitude: number; longitude: number; accuracyM?: number }) =>
    api.post<{ interviewId: string; candidateArrivedAt?: string | null; noShow?: boolean; distanceMeters?: number | null; distanceM?: number | null }>(`/field-selling/interviews/${enc(interviewId)}/arrival`, body),
  placeCall: (body: { subjectType: 'business' | 'job_seeker'; subjectId: string; purpose: string; relatedType?: string; relatedId?: string }) =>
    api.post<{ callRecordId: string }>('/calls', body),
  recordJoined: (placementId: string) => api.post(`/placements/${enc(placementId)}/joined`, {}),
  // Vacancies (existing endpoints)
  sendVacancyCode: (vacancyId: string, otpRequestId?: string) =>
    api.post<OtpSent>(`/vacancies/${enc(vacancyId)}/confirmation/send-code`, { otpRequestId }),
  confirmVacancy: (vacancyId: string, otpRequestId: string, code: string) =>
    api.post(`/vacancies/${enc(vacancyId)}/confirm`, { otpRequestId, code, method: 'code_on_visit' }),
  vacancyLink: (vacancyId: string) => api.post<{ expiresAt: string; sentToLast4: string }>(`/vacancies/${enc(vacancyId)}/confirmation-link`),
  trades: () => api.get<Trade[]>('/trades'),
  vacancy: (id: string) =>
    api.get<{ id: string; code: string; businessId: string; status: string; confirmedAt: string | null; confirmedByName: string | null }>(`/vacancies/${enc(id)}`),
  createVacancy: (body: Record<string, unknown>) => api.post<CreatedVacancy>('/vacancies', body),
  // Job seeker registration — the same endpoints as the call agent's form (CA08).
  formOptions: () => api.get<{ city: string; areas: Area[] }>('/screens/call-registration/options'),
  sendOtp: (phone: string, previousRequestId?: string) =>
    api.post<SeekerOtpSendResult>('/otp/send', { phone, purpose: 'job_seeker', requestId: previousRequestId }),
  verifyOtp: (requestId: string, code: string) => api.post('/otp/verify', { requestId, code }),
  createJobSeeker: (body: Record<string, unknown>) => api.post<{ id: string; code: string }>('/job-seekers', body),
  updateProfile: (id: string, body: Record<string, unknown>) => api.patch(`/job-seekers/${enc(id)}/profile`, body),
  seekerStatus: (id: string) => api.get<JobSeekerStatus>(`/screens/call-registration/job-seekers/${enc(id)}`),
  sendRegistrationLink: (jobSeekerId: string) => api.post<{ expiresAt: string }>('/consent/links', { jobSeekerId }),
  paymentOnlyLink: (jobSeekerId: string, phone: string, relation?: string) =>
    api.post<{ expiresAt: string }>(`/job-seekers/${enc(jobSeekerId)}/payment-only-link`, { phone, relation }),
  /** "Scan Aadhaar QR": only the QR's text, read live with this phone's camera (guide, 14 Nov). Needs signal. */
  aadhaarQr: (jobSeekerId: string, qrText: string) =>
    api.post<AadhaarQrOutcome>(`/field-work/job-seekers/${enc(jobSeekerId)}/aadhaar-qr`, { qrText, captureSource: 'live_camera' }),
  findReferralPartner: (q: string) =>
    api.get<{ partner: { id: string; code: string; name: string } | null }>('/screens/call-registration/referral-partners', { query: { q } }),
});



/** POST /otp/send for a job seeker: a request, or "already registered" (with the code when visible). */
export type SeekerOtpSendResult =
  | { requestId: string; resendAvailableAt?: string; resendsLeft?: number }
  | { alreadyRegistered: true; type?: string; code?: string };

export type StepState = 'done' | 'in_progress' | 'stuck' | 'not_started' | 'confirming';

export interface Step {
  state: StepState;
  time?: string | null;
  reason?: string | null;
}

/** GET /screens/call-registration/job-seekers/:id — the registration step panel. */
export interface JobSeekerStatus {
  id: string;
  code: string;
  name: string;
  phone: string;
  phoneVerifiedAt: string | null;
  stage: 'registered' | 'in_progress' | 'active';
  nextStep: 'consent' | 'selfie' | 'id_check' | 'payment' | 'complete';
  steps: { phone: Step; consent: Step; selfie: Step; idCheck: Step; payment: Step };
  consent: { requiredGiven: number; requiredTotal: number; promotions: boolean };
  registrationLinkExpiresAt: string | null;
  /** How long a payment-only link works (Settings, 15 minutes by default). */
  paymentOnlyLinkMinutes?: number;
  paymentOnlyLink: { payerPhone: string | null; relation: string | null; sentAt: string; expiresAt: string; live: boolean; used: boolean } | null;
  paymentReceivedAt: string | null;
  /** For "Preview what she'll / he'll see". */
  gender?: string | null;
}


/** POST /field-work/job-seekers/:id/aadhaar-qr — the result only; nothing read from the card. */
export interface AadhaarQrOutcome {
  verificationId: string | null;
  method: 'aadhaar_qr';
  status: 'verified' | 'failed';
  result: 'verified' | 'name_mismatch' | 'under_18' | 'bad_signature' | 'old_qr' | 'unreadable';
  verifiedByUidai: boolean;
  nameMatches: boolean | null;
  isAdult: boolean | null;
  /** XXXX-XXXX-1234 */
  maskedReference: string | null;
  failureReason: string | null;
  offerOtherId: boolean;
}

export interface CreatedVacancy {
  id: string;
  code: string;
  status: string;
  confirmation?: OtpSent | { error?: string } | null;
}
