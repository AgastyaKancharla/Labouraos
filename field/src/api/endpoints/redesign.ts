import type { ApiClient } from '../client';
import type { BusinessRowState, GuaranteeDay, SeekerRowState } from './people';
import type { AttendanceToday } from './attendance';
import type { Visit } from './visits';

/**
 * Laboura Field redesign (Master Guide rev 188, 16 Nov): the endpoints of
 * docs/api/field-redesign.md (server branch build/field-redesign-server).
 * Lists carry data only (names, areas, trades); the app writes the words for
 * each `kind` / `type` in the agent's language.
 */

export type Due = 'overdue' | 'today' | 'tomorrow';
export type AgreementState = 'signed' | 'link_sent' | 'link_expired' | 'not_sent';

/** Where a Needs-you-now item (or a Today's work row) opens. */
export interface NeedsTarget {
  type: 'interview' | 'visit' | 'business' | 'vacancy' | 'placement' | 'revisit' | 'followup' | 'verification';
  id: string;
  /** verification (21 Nov): the visit assignment; visit_unfinished of a verification visit too. */
  assignmentId?: string | null;
  /** verification: a started visit (shop photo taken) to resume. */
  visitId?: string;
  step?: string;
  businessId?: string | null;
  vacancyId?: string | null;
  subjectType?: string;
  subjectId?: string;
  relatedType?: string | null;
  relatedId?: string | null;
}

export type NeedsKind =
  | 'interview_today'
  | 'verification_visit'
  | 'visit_unfinished'
  | 'agreement_waiting'
  | 'vacancy_awaiting_owner'
  | 'vacancy_draft'
  | 'ready_show_candidates'
  | 'vacancies_to_fill'
  | 'joining_due'
  | 'revisit_due'
  | 'followup_task';

export interface NeedsItem {
  id: string;
  kind: NeedsKind;
  title: string;
  subtitle: string | null;
  at: string | null;
  due: Due | null;
  target: NeedsTarget;
  interview?: { startsAt: string; candidateName: string; candidateArrivedAt?: string | null };
  visit?: { startedAt: string; purpose: string | null };
  agreement?: { state: AgreementState; linkSentAt: string | null; linkExpiresAt: string | null };
  vacancy?: { code: string; trade: string; headcount: number };
  placement?: { code: string; joiningDate: string | null; candidateFirstName: string };
  revisitOn?: string | null;
  /** 21 Nov: the come-back time ("HH:mm") and, for a revisit handed over on leave, whose it was. */
  revisitTime?: string | null;
  coverFor?: string | null;
  /** revisit_due (22 Nov): the last visit's note and when it was, shown when the revisit starts. */
  note?: string | null;
  lastVisitAt?: string | null;
  /** verification_visit (21 Nov): the job card. */
  job?: import('./fieldOps').VerificationJob;
  /** followup_task (21 Nov): "Repeat business — day 30". */
  kindLabel?: string;
  /** vacancies_to_fill (17 Nov): open seats left across the business's open vacancies. */
  toFill?: { count: number; vacancies: number; trades: string[] };
  taskKind?: string;
  code?: string;
}

export interface TodayNumbers {
  shopsVisited: number;
  onboarded: number;
  vacanciesConfirmed: number;
  candidatesShown: number;
  interviewsBooked: number;
  interviewsAttended: number;
}

/** GET /field-work/today */
export interface TodayView {
  now: string;
  date: string;
  attendance: AttendanceToday | null;
  numbers: TodayNumbers;
  targets: { year: number; month: number; placementsClosed: number; placementsTarget: number | null } | null;
  needsYou: NeedsItem[];
}

export type DayItemType =
  | 'visit'
  | 'business_registered'
  | 'job_seeker_registered'
  | 'referral_registered'
  // 'vacancy_added' and 'vacancy_confirmed' are no longer rows (17 Nov): both show on the business's history.
  | 'candidates_shown'
  | 'interview_booked'
  | 'interview_attended';

export interface DayItem {
  type: DayItemType;
  id: string;
  at: string;
  title: string;
  subtitle: string | null;
  status: string | null;
  count?: number;
  /** The one row per business that the Onboarded number counts that day (rev 189). */
  countsAsOnboarded?: boolean;
  target: { type: 'visit' | 'business' | 'job_seeker' | 'referral' | 'vacancy' | 'interview'; id: string; businessId?: string | null; vacancyId?: string | null };
}

/** One row of GET /field-work/visits/all (My visits → All visits, 17 Nov). */
export interface AllVisitRow {
  id: string;
  at: string;
  visitedAt: string;
  title: string;
  subtitle: string | null;
  businessId: string | null;
  businessCode: string | null;
  purpose: string | null;
  /** The visit's result, or "unfinished". */
  status: string;
  durationSeconds: number | null;
  hasBoardPhoto: boolean;
  hasSelfie: boolean;
}

export interface AllVisitsQuery {
  q?: string;
  /** IST dates, YYYY-MM-DD. */
  from?: string;
  to?: string;
  /** The `nextBefore` of the previous page. */
  before?: string;
}

/** GET /field-work/visits/all: my whole visit history, newest first. */
export interface AllVisitsPage {
  items: AllVisitRow[];
  nextBefore: string | null;
}

/**
 * POST /maps-link/locate (21 Nov, rev 204): the same reader everywhere a pin is
 * set — a typed address, any Google Maps link (short links too) or coordinates.
 */
export interface LocatedPin extends ResolvedMapsLink {
  source: 'coordinates' | 'link' | 'address';
  /** The address line it matched, shown under "Is this the right place?". */
  matched: string | null;
}

/** POST /maps-link/where (22 Nov): a GPS fix in words ("Kothnur, JP Nagar 8th Phase") and the address there. */
export interface WhereAmI {
  latitude: number;
  longitude: number;
  area: string | null;
  /** 26 Nov: `landmark` is the nearest named place (a shop, temple, school…), when the lookup has one. */
  address: (ResolvedMapsLink['address'] & { locality?: string | null; landmark?: string | null }) | null;
}

/** POST /maps-link/resolve (17 Nov): the pin from a Google Maps link and its address from OpenStreetMap. */
export interface ResolvedMapsLink {
  latitude: number;
  longitude: number;
  placeName: string | null;
  address: {
    shopNumber: string | null;
    street: string | null;
    area: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
    displayName: string | null;
    /** 26 Nov: the nearest named place, when the lookup has one (where am I only). */
    landmark?: string | null;
  } | null;
  shortLink: boolean;
}

/** One of a business's own shifts (17 Nov): GET/POST/PATCH/DELETE /businesses/:id/shifts. */
export interface BusinessShift {
  id: string;
  businessId: string;
  name: string;
  /** "HH:MM", IST. */
  startTime: string;
  endTime: string;
  /** "Morning 07:00–15:00". */
  label: string;
  category: 'day' | 'night';
}

/** GET /field-work/day?date= (Today's work) */
export interface DayView {
  date: string;
  isToday: boolean;
  counts: Record<DayItemType, number>;
  items: DayItem[];
}

export type VisitNextStep = 'record_result' | 'take_selfie' | 'continue_business_form' | 'mark_onboarded' | 'verify' | 'done';

export interface ResultSnapshot {
  outcome: string | null;
  outcomeReason: string | null;
  revisitOn: string | null;
}

/** GET /field-visits/:id (visit details page). */
export interface VisitDetails extends Omit<Visit, 'business'> {
  business: { id: string; code: string; name: string; verificationStatus?: string | null } | null;
  outcomeRecordedAt?: string | null;
  boardPhoto?: { url: string; takenAt: string } | null;
  selfie?: { url: string; takenAt: string; distanceMeters: number | null } | null;
  resultHistory?: { at: string; byName: string | null; byMe: boolean; from: ResultSnapshot; to: ResultSnapshot; reason: string }[];
  nextStep?: VisitNextStep;
  canChangeResult?: boolean;
  /** The business was onboarded before this visit: marking it records `already_onboarded`, never counted again (rev 189). */
  businessAlreadyOnboarded?: boolean;
}

export interface ChangeResultBody {
  outcome: 'interested_later' | 'not_interested' | 'owner_not_there';
  reason: string;
  revisitOn?: string;
  outcomeReason?: string;
  note?: string;
}

export type BusinessNextStepKind =
  | 'suspended'
  | 'paused'
  | 'agreement_waiting'
  | 'vacancy_to_confirm'
  | 'vacancy_to_send'
  | 'candidates_hidden'
  | 'ready_show_candidates'
  | 'waiting_tl_check'
  | 'add_vacancy'
  | 'none';

export interface BusinessNextStep {
  kind: BusinessNextStepKind;
  agreementState?: AgreementState;
  vacancyId?: string;
  reason?: string;
}

export interface MyBusinessRow {
  id: string;
  code: string;
  name: string;
  locality: string | null;
  verificationStatus: string | null;
  agreementSigned: boolean;
  openVacancies: number;
  nextStep: BusinessNextStep;
  /** 22 Nov: interviews at the shop today, and whether he is its account agent. */
  interviewsToday?: number;
  isAccountAgent?: boolean;
  /** Laboura Field lists (22 Nov evening): type, numbers, last visit and the row's one status and button. */
  businessType?: string | null;
  businessTypeOther?: string | null;
  candidatesShown?: number;
  lastVisitAt?: string | null;
  revisitOverdue?: boolean;
  canAct?: boolean;
  row?: BusinessRowState;
  /** 26 Nov: when it was registered (for the Newest / Oldest sort). */
  createdAt?: string | null;
}

export type VacancyNextStep =
  | { kind: 'send_to_owner'; missing: string[]; needsMinimumWageTick: boolean; legalMinimumPaise: number | null }
  | { kind: 'enter_code'; linkSentAt: string | null; linkExpiresAt: string | null; sentToLast4: string | null }
  | { kind: 'show_candidates'; shown: number }
  | { kind: 'none' };

export interface PageVacancy {
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
  /** The salary is below the legal minimum for the trade (the agent tells the owner). */
  belowLegalMinimum?: boolean;
  contactName: string | null;
  contactPhoneLast4: string | null;
  nextStep: VacancyNextStep;
}

export interface AgreementChecklist {
  state: AgreementState;
  signedAt?: string | null;
  signedByName?: string | null;
  linkSentAt?: string | null;
  linkExpiresAt?: string | null;
  linkOpenedAt?: string | null;
  sentToLast4?: string | null;
  canResend?: boolean;
  resendAvailableAt?: string | null;
}

export type CandidatesHiddenReason = 'suspended' | 'paused' | 'agreement_not_signed' | 'visit_outside_area' | 'not_verified' | null;

export interface PageVisit {
  id: string;
  at: string;
  durationSeconds: number | null;
  purpose: string | null;
  outcome: string | null;
  staffName: string | null;
  mine: boolean;
  hasBoardPhoto: boolean;
  hasSelfie: boolean;
}

export type VacancyEvent = 'added' | 'sent' | 'confirmed' | 'filled' | 'closed';

export type HistoryEntry =
  | { kind: 'visit'; at: string; visit: PageVisit }
  | { kind: 'vacancy'; at: string; event: VacancyEvent; vacancyId: string; code: string; trade: string; headcount: number; byName: string | null };

/** GET /field-work/businesses/:ref/page (the one business page). */
export interface BusinessPage {
  id: string;
  code: string;
  name: string;
  locality: string | null;
  businessType: string | null;
  latitude: number | null;
  longitude: number | null;
  accountAgent: { id: string; name: string; code: string; isMe: boolean } | null;
  isMine: boolean;
  canAct: boolean;
  status: {
    verificationStatus: string | null;
    paused: boolean;
    suspended: boolean;
    suspendedUntil: string | null;
    canShowCandidates: boolean;
    candidatesHiddenReason: CandidatesHiddenReason;
  };
  nextStep: BusinessNextStep;
  contact: { name: string | null; role: string | null; phoneLast4: string | null; language: string | null } | null;
  checklist: {
    registered: { done: boolean; at?: string | null };
    ownerPhoneVerified: { done: boolean };
    agreement: AgreementChecklist;
    teamLeadCheck: { state: 'done' | 'waiting' | 'not_yet'; at?: string | null };
  };
  vacancies: PageVacancy[];
  candidates: {
    shown: number;
    shownByMe: number;
    interviews: { total: number; today: number; upcoming: number };
    placements: number;
    inGuarantee: number;
    recentInterviews: { id: string; code: string; startsAt: string; status: string; result: string | null; candidateName: string }[];
  };
  visits: PageVisit[];
  /** Visits and vacancy events, newest first (17 Nov). Older servers send only `visits`. */
  history?: HistoryEntry[];
  actions: { recordVisit: boolean; callOwner: boolean; addVacancy: boolean; resendAgreement: boolean; showCandidates: boolean };
  /** "Where they're stuck" (22 Nov evening): the same status and one button as the business's row. */
  row?: BusinessRowState;
  /** 27 Nov: everything for the profile's Details tab (absent on older servers). Phones as last 4 only. */
  details?: BusinessPageDetails;
}

export interface BusinessPageDetails {
  address: { shopNumber: string | null; street: string | null; landmark: string | null; locality: string | null; city: string; pincode: string | null; full: string | null; runsFromHome: boolean };
  map: { latitude: number | null; longitude: number | null; mapsLink: string | null; placeName: string | null };
  businessTypeOther: string | null;
  people: {
    ownerName: string | null;
    legalName: string | null;
    contactName: string | null;
    contactRole: string | null;
    phoneLast4: string | null;
    phoneVerified: boolean;
    whatsappLast4: string | null;
    otherContactLast4: string | null;
  };
  staff: { employeeCount: number | null; employeeCountBand: string | null; staffNeeded: string[] };
  /** Another agent's business: names and document numbers are not sent. */
  documentsHidden: boolean;
  documents: {
    gst: { number: string; verified: boolean | null; status: string | null; legalName: string | null } | null;
    fssai: string | null;
    tradeLicence: string | null;
    shopEstablishment: string | null;
    udyam: string | null;
    panLast4: string | null;
    others: { kind: string; label: string; number: string }[];
    noDocuments: boolean;
  };
  onboarding: { registeredAt: string; registeredBy: string | null; channel: string | null; heardFrom: string | null; inPersonAt: string | null; verifiedAt: string | null };
  branches: { id: string; name: string; locality: string | null; contactName: string; contactLast4: string | null }[];
}

/** GET /field-work/businesses/:ref/agreement (polled every ~10 s on the agreement step). */
export interface AgreementStatus {
  businessId: string;
  state: AgreementState;
  signedAt: string | null;
  signedByName: string | null;
  linkSentAt: string | null;
  linkExpiresAt: string | null;
  linkOpenedAt: string | null;
  sentToLast4: string | null;
  canResend: boolean;
  resendAvailableAt: string | null;
  canShowCandidates: boolean;
  candidatesHiddenReason: CandidatesHiddenReason;
  /** 25 Nov (rev 211–212): the owner's photos the agent takes before the owner signs (absent on older servers). */
  ownerPhotos?: { needed: boolean; selfie: boolean; shop: boolean; shopKinds: ('shop_board' | 'fssai_with_owner' | 'workspace')[]; smallBusiness: boolean };
}

export interface MyJobSeekerRow {
  id: string;
  code: string;
  name: string;
  phoneLast4: string | null;
  status: string;
  registeredAt: string;
  stage: 'registered' | 'link_sent' | 'consent_given' | 'paid' | 'id_checked' | 'interviewing' | 'placed' | 'inactive';
  steps: {
    linkSentAt: string | null;
    consentGivenAt: string | null;
    paidAt: string | null;
    idCheckedAt: string | null;
    idCheckPending: boolean;
    interviews: number;
    placed: boolean;
  };
  /** Laboura Field lists (22 Nov evening): selfie, trade · area · experience, guarantee day, hits and the row's status and button. */
  photoUrl?: string | null;
  trade?: string | null;
  yearsExperience?: number | null;
  locality?: string | null;
  hits?: number;
  guarantee?: GuaranteeDay | null;
  nextInterviewAt?: string | null;
  row?: SeekerRowState;
}

export interface SubmittedVacancy {
  id: string;
  code: string;
  status: string;
  confirmation?: { otpRequestId: string; sentToLast4: string; contactName: string | null; resendAvailableAt?: string; resendsLeft?: number } | { error: string } | null;
}

/** Referral partner registration (docs/api/field-redesign.md §5, POST /referrals). */
export interface CreatedReferral {
  id: string;
  code: string;
  name: string;
  idSmsSent?: boolean;
  registrationLinkSent?: boolean;
  registrationLinkExpiresAt?: string | null;
}

export interface ReferralStep {
  state: 'done' | 'in_progress' | 'stuck' | 'not_started';
  time?: string | null;
  reason?: string | null;
}

/** GET /referrals/:id/registration-status */
export interface ReferralStatus {
  currentStep: 'terms' | 'selfie' | 'id' | 'upi' | 'complete';
  steps: { terms: ReferralStep; selfie: ReferralStep; id: ReferralStep; upi: ReferralStep };
}

const enc = encodeURIComponent;

export const redesignApi = (api: ApiClient) => ({
  today: () => api.get<TodayView>('/field-work/today'),
  day: (date?: string) => api.get<DayView>('/field-work/day', { query: { date } }),
  allVisits: (query: AllVisitsQuery) =>
    api.get<AllVisitsPage>('/field-work/visits/all', { query: { q: query.q || undefined, from: query.from, to: query.to, before: query.before } }),
  visit: (id: string) => api.get<VisitDetails>(`/field-visits/${enc(id)}`),
  shifts: (businessId: string) => api.get<BusinessShift[]>(`/businesses/${enc(businessId)}/shifts`),
  addShift: (businessId: string, body: { name: string; startTime: string; endTime: string }) => api.post<BusinessShift>(`/businesses/${enc(businessId)}/shifts`, body),
  removeShift: (businessId: string, shiftId: string) => api.delete<{ removed: true }>(`/businesses/${enc(businessId)}/shifts/${enc(shiftId)}`),
  resolveMapsLink: (url: string) => api.post<ResolvedMapsLink>('/maps-link/resolve', { url }),
  locatePin: (text: string) => api.post<LocatedPin>('/maps-link/locate', { text }),
  // 26 Nov: the server may try OpenStreetMap twice and Google before answering; give it time on a slow signal.
  whereIs: (latitude: number, longitude: number) => api.post<WhereAmI>('/maps-link/where', { latitude, longitude }, { timeoutMs: 35_000 }),
  changeResult: (id: string, body: ChangeResultBody) => api.post<VisitDetails>(`/field-visits/${enc(id)}/change-result`, body),
  myBusinesses: (q?: string) => api.get<{ query: string; results: MyBusinessRow[] }>('/field-work/businesses', { query: { q: q || undefined } }),
  businessPage: (ref: string) => api.get<BusinessPage>(`/field-work/businesses/${enc(ref)}/page`),
  agreement: (ref: string) => api.get<AgreementStatus>(`/field-work/businesses/${enc(ref)}/agreement`),
  /** The agreement link, in English (rev 193). */
  /** Rev 211: WhatsApp first (SMS as backup), or `channel: 'sms'` ("Send by SMS"); `sentBy` says which carried it. */
  resendAgreement: (ref: string, channel?: 'whatsapp' | 'sms') =>
    api.post<{ success: boolean; linkSentAt: string; linkExpiresAt: string; sentToLast4: string; sentBy?: 'whatsapp' | 'sms' | null }>(
      `/field-work/businesses/${enc(ref)}/agreement-link`,
      channel ? { channel } : {},
    ),
  submitDraft: (vacancyId: string, ownerToldMinimumWage?: boolean) =>
    api.post<SubmittedVacancy>(`/vacancies/${enc(vacancyId)}/submit-for-confirmation`, ownerToldMinimumWage ? { ownerToldMinimumWage: true } : {}),
  myJobSeekers: (q?: string) => api.get<{ query: string; results: MyJobSeekerRow[] }>('/field-work/job-seekers', { query: { q: q || undefined } }),
  // Referral partners
  sendReferralOtp: (phone: string, requestId?: string, channel?: 'sms') =>
    api.post<{ requestId?: string; resendAvailableAt?: string; alreadyRegistered?: boolean; type?: string; code?: string }>('/otp/send', {
      phone,
      purpose: 'referral',
      ...(requestId ? { requestId } : {}),
      ...(channel ? { channel } : {}),
    }),
  createReferral: (body: Record<string, unknown>) => api.post<CreatedReferral>('/referrals', body),
  referral: (id: string) => api.get<{ id: string; code: string; name: string; language: string | null; paused?: boolean }>(`/referrals/${enc(id)}`),
  referralStatus: (id: string) => api.get<ReferralStatus>(`/referrals/${enc(id)}/registration-status`),
  resendReferralLink: (id: string, channel?: 'whatsapp' | 'sms') =>
    api.post<{ success?: boolean; expiresAt?: string; sentBy?: 'whatsapp' | 'sms' | null }>(`/referrals/${enc(id)}/terms-links`, channel ? { channel } : {}),
});

/** The stable `code` of an API error (docs/api/field-redesign.md §7), if any. */
export function errorCode(error: unknown): string | null {
  const body = (error as { body?: unknown } | null)?.body;
  if (!body || typeof body !== 'object') return null;
  // The server sends the code under details.code (docs/api/field-redesign.md); older answers had it at the top.
  const details = (body as { details?: unknown }).details;
  if (details && typeof details === 'object' && typeof (details as { code?: unknown }).code === 'string') return (details as { code: string }).code;
  if (typeof (body as { code?: unknown }).code === 'string') return (body as { code: string }).code;
  return null;
}
