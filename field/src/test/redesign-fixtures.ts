import type { AgreementStatus, BusinessPage, DayView, PageVacancy, TodayView, VisitDetails } from '@/api/endpoints';
import { sampleVisit } from './visit-fakes';

/** Answers of the redesign endpoints (docs/api/field-redesign.md) for screen tests. */

export const pageVacancy = (over: Partial<PageVacancy> = {}): PageVacancy => ({
  id: 'vac-1',
  code: 'VC-00031',
  trade: 'Cook',
  roleTitle: null,
  headcount: 2,
  salaryMinPaise: 1500000,
  salaryMaxPaise: 1800000,
  salaryPeriod: 'monthly',
  shift: 'day',
  startDate: '2026-11-20',
  status: 'draft',
  confirmedAt: null,
  contactName: 'Manjunath',
  contactPhoneLast4: '4321',
  nextStep: { kind: 'send_to_owner', missing: [], needsMinimumWageTick: false, legalMinimumPaise: 1234500 },
  ...over,
});

export const businessPage = (over: Partial<BusinessPage> = {}): BusinessPage => ({
  id: 'b-1',
  code: 'BZ-00012',
  name: 'Sri Sai Bakery',
  locality: 'JP Nagar',
  businessType: 'bakery',
  latitude: 12.89,
  longitude: 77.58,
  accountAgent: { id: 'fa-1', name: 'Kiran Kumar', code: 'FA-00017', isMe: true },
  isMine: true,
  canAct: true,
  status: { verificationStatus: 'pending_tl_check', paused: false, suspended: false, suspendedUntil: null, canShowCandidates: true, candidatesHiddenReason: null },
  nextStep: { kind: 'vacancy_to_send', vacancyId: 'vac-1' },
  contact: { name: 'Manjunath', role: 'owner', phoneLast4: '4321', language: 'kn' },
  checklist: {
    registered: { done: true, at: '2026-11-15T10:25:00.000Z' },
    ownerPhoneVerified: { done: true },
    agreement: {
      state: 'link_sent',
      signedAt: null,
      signedByName: null,
      linkSentAt: '2026-11-15T10:26:00.000Z',
      linkExpiresAt: '2026-11-16T10:26:00.000Z',
      linkOpenedAt: null,
      sentToLast4: '4321',
      canResend: true,
      resendAvailableAt: null,
    },
    teamLeadCheck: { state: 'not_yet', at: null },
  },
  vacancies: [
    pageVacancy(),
    pageVacancy({ id: 'vac-2', code: 'VC-00032', trade: 'Helper', headcount: 1, status: 'awaiting_confirmation', nextStep: { kind: 'enter_code', linkSentAt: '2026-11-15T10:30:00.000Z', linkExpiresAt: null, sentToLast4: '4321' } }),
    pageVacancy({ id: 'vac-3', code: 'VC-00033', trade: 'Baker', headcount: 1, status: 'open', confirmedAt: '2026-11-15T11:00:00.000Z', nextStep: { kind: 'show_candidates', shown: 3 } }),
  ],
  candidates: {
    shown: 6,
    shownByMe: 4,
    interviews: { total: 3, today: 1, upcoming: 1 },
    placements: 1,
    inGuarantee: 1,
    recentInterviews: [{ id: 'iv-7', code: 'IV-00007', startsAt: '2026-11-20T05:00:00.000Z', status: 'confirmed', result: null, candidateName: 'Ramesh G.' }],
  },
  visits: [
    { id: 'v-1', at: '2026-11-15T10:02:00.000Z', durationSeconds: 900, purpose: 'shop_visit', outcome: 'onboarded', staffName: 'Kiran Kumar', mine: true, hasBoardPhoto: true, hasSelfie: true },
    { id: 'v-0', at: '2026-11-10T10:02:00.000Z', durationSeconds: 300, purpose: 'shop_visit', outcome: 'interested_later', staffName: 'Ravi K', mine: false, hasBoardPhoto: true, hasSelfie: false },
  ],
  actions: { recordVisit: true, callOwner: true, addVacancy: true, resendAgreement: true, showCandidates: true },
  ...over,
});

/** Another agent's business, as the server sends it: no contact, no actions. */
export const viewOnlyPage = (): BusinessPage =>
  businessPage({
    accountAgent: { id: 'fa-9', name: 'Ravi K', code: 'FA-00003', isMe: false },
    isMine: false,
    canAct: false,
    contact: null,
    checklist: { ...businessPage().checklist, agreement: { state: 'signed', signedAt: '2026-11-15T10:40:00.000Z' } },
    vacancies: [pageVacancy({ status: 'open', nextStep: { kind: 'none' } })],
    actions: { recordVisit: false, callOwner: false, addVacancy: false, resendAgreement: false, showCandidates: false },
  });

export const agreementStatus = (over: Partial<AgreementStatus> = {}): AgreementStatus => ({
  businessId: 'b-1',
  state: 'link_sent',
  signedAt: null,
  signedByName: null,
  linkSentAt: '2026-11-16T05:31:00.000Z',
  linkExpiresAt: '2026-11-17T05:31:00.000Z',
  linkOpenedAt: null,
  sentToLast4: '4321',
  canResend: true,
  resendAvailableAt: null,
  canShowCandidates: false,
  candidatesHiddenReason: 'agreement_not_signed',
  ...over,
});

export const legalDoc = (key: string, lang: string) => ({
  key,
  version: '1.1',
  language: lang,
  title: lang === 'kn' ? 'ವ್ಯಾಪಾರ ಒಪ್ಪಂದ' : 'Business agreement',
  summary: [lang === 'kn' ? 'ಆಯ್ಕೆ ಮಾಡಿದಾಗ ಮಾತ್ರ ಶುಲ್ಕ' : 'You pay only when you select someone: <strong>50%</strong> of the first month’s salary.'],
  summaryHtml: '',
  bodyHtml: '',
});

export const todayView = (over: Partial<TodayView> = {}): TodayView => ({
  now: '2026-11-16T05:30:00.000Z',
  date: '2026-11-16',
  attendance: null,
  numbers: { shopsVisited: 4, onboarded: 1, vacanciesConfirmed: 2, candidatesShown: 6, interviewsBooked: 1, interviewsAttended: 0 },
  targets: { year: 2026, month: 11, placementsClosed: 3, placementsTarget: 10 },
  needsYou: [
    { id: 'interview_today:iv-1', kind: 'interview_today', title: 'Sri Sai Hotel', subtitle: 'BTM Layout', at: '2026-11-16T06:30:00.000Z', due: 'today', target: { type: 'interview', id: 'iv-1', step: 'attend', businessId: 'b-2' }, interview: { startsAt: '2026-11-16T06:30:00.000Z', candidateName: 'Ramesh G.' } },
    { id: 'visit_unfinished:v-3', kind: 'visit_unfinished', title: 'Sagar Stores', subtitle: null, at: null, due: null, target: { type: 'visit', id: 'v-3', step: 'continue_business_form' }, visit: { startedAt: '2026-11-16T04:00:00.000Z', purpose: 'shop_visit' } },
    { id: 'agreement_waiting:b-1', kind: 'agreement_waiting', title: 'Sri Sai Bakery', subtitle: 'JP Nagar', at: null, due: null, target: { type: 'business', id: 'b-1', step: 'agreement' }, agreement: { state: 'link_expired', linkSentAt: null, linkExpiresAt: null } },
    { id: 'vacancy_awaiting_owner:vac-2', kind: 'vacancy_awaiting_owner', title: 'Sri Sai Bakery', subtitle: null, at: null, due: null, target: { type: 'vacancy', id: 'vac-2', step: 'enter_code', businessId: 'b-1' }, vacancy: { code: 'VC-00032', trade: 'Helper', headcount: 1 } },
    { id: 'vacancy_draft:vac-1', kind: 'vacancy_draft', title: 'Sri Sai Bakery', subtitle: null, at: null, due: null, target: { type: 'vacancy', id: 'vac-1', step: 'send_to_owner', businessId: 'b-1' }, vacancy: { code: 'VC-00031', trade: 'Cook', headcount: 2 } },
    { id: 'ready_show_candidates:b-4', kind: 'ready_show_candidates', title: 'Green Leaf Café', subtitle: null, at: null, due: null, target: { type: 'business', id: 'b-4', step: 'show_candidates', vacancyId: 'vac-9' }, vacancy: { code: 'VC-00090', trade: 'Waiter', headcount: 1 } },
    { id: 'vacancies_to_fill:b-4', kind: 'vacancies_to_fill', title: 'Green Leaf Café', subtitle: 'Jayanagar', at: null, due: null, target: { type: 'business', id: 'b-4', step: 'fill_vacancies' }, toFill: { count: 2, vacancies: 2, trades: ['Waiter', 'Cook'] } },
    { id: 'joining_due:pl-1', kind: 'joining_due', title: 'Hotel Kamat', subtitle: null, at: null, due: 'tomorrow', target: { type: 'placement', id: 'pl-1', step: 'confirm_joining', businessId: 'b-5' }, placement: { code: 'PL-00001', joiningDate: '2026-11-17', candidateFirstName: 'Suresh' } },
    { id: 'revisit_due:v-9', kind: 'revisit_due', title: 'Lakshmi Tiffins', subtitle: null, at: null, due: 'overdue', target: { type: 'revisit', id: 'v-9', step: 'start_visit', businessId: null }, revisitOn: '2026-11-15' },
    { id: 'followup_task:t-1', kind: 'followup_task', title: 'Kavya', subtitle: null, at: null, due: 'today', target: { type: 'followup', id: 't-1', step: 'placement_check_in_day_7', subjectType: 'job_seeker', subjectId: 'js-1', relatedType: 'placement', relatedId: 'pl-2' }, taskKind: 'placement_check_in_day_7', code: 'FT-1' },
  ],
  ...over,
});

export const dayView = (date = '2026-11-16', over: Partial<DayView> = {}): DayView => ({
  date,
  isToday: date === '2026-11-16',
  counts: { visit: 2, business_registered: 1, job_seeker_registered: 1, referral_registered: 0, vacancy_confirmed: 0, candidates_shown: 0, interview_booked: 0, interview_attended: 0 },
  items: [
    { type: 'visit', id: 'visit:v-1', at: '2026-11-16T05:02:00.000Z', title: 'Sri Sai Bakery', subtitle: 'JP Nagar', status: 'onboarded', target: { type: 'visit', id: 'v-1' } },
    { type: 'business_registered', id: 'business:b-1', at: '2026-11-16T05:20:00.000Z', title: 'Sri Sai Bakery', subtitle: 'JP Nagar', status: 'lead', target: { type: 'business', id: 'b-1' } },
    { type: 'visit', id: 'visit:v-3', at: '2026-11-16T04:00:00.000Z', title: 'Sagar Stores', subtitle: null, status: 'unfinished', target: { type: 'visit', id: 'v-3' } },
    { type: 'job_seeker_registered', id: 'js:js-1', at: '2026-11-16T03:00:00.000Z', title: 'Kavya R', subtitle: null, status: 'lead', target: { type: 'job_seeker', id: 'js-1' } },
  ],
  ...over,
});

export const visitDetails = (over: Partial<VisitDetails> = {}): VisitDetails => ({
  ...sampleVisit,
  id: 'v-1',
  business: null,
  shopName: 'Lakshmi Tiffins',
  endedAt: '2026-11-15T10:20:00.000Z',
  durationSeconds: 1080,
  outcome: 'owner_not_there',
  revisitOn: '2026-11-18',
  note: 'Owner busy, come after 4',
  outcomeRecordedAt: '2026-11-15T10:20:00.000Z',
  boardPhoto: { url: 'https://photos.test/board.jpg', takenAt: '2026-11-15T10:02:00.000Z' },
  selfie: null,
  resultHistory: [],
  nextStep: 'done',
  canChangeResult: true,
  ...over,
});
