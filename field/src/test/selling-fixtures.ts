import type { BusinessDetail, BusinessHit, CandidateCard, InterviewView, MatchesPage, PlacementView, SellingSettings } from '@/api/endpoints';
import { OfflineQueue } from '@/device/offline-queue/queue';
import { createMemoryQueueStore, type QueueItem } from '@/device/offline-queue/types';
import type { FetchRoute } from './render';

/** Test data for the selling screens (Annapoorna Mess, the designs' example). */
export const settings: SellingSettings = {
  feePercent: 50,
  gstPercent: 18,
  walkInStart: '10:30',
  walkInEnd: '18:00',
  callingHoursStart: '09:00',
  callingHoursEnd: '21:00',
  interviewResultDeadline: '20:00',
  placementPaymentDueHours: 24,
  maxFreeReplacements: 2,
  replacementWindowDays: 60,
  threeWayCalls: true,
  notSelectedReasons: ['skills', 'experience', 'communication', 'salary_expectation', 'not_suitable', 'other'],
};

export const hit = (over: Partial<BusinessHit> = {}): BusinessHit => ({
  id: 'biz-1',
  code: 'BZ-0318',
  name: 'Annapoorna Mess',
  locality: 'BTM Layout',
  verificationStatus: 'pending_tl_check',
  agreementSigned: true,
  signedToday: true,
  canShowCandidates: true,
  paused: false,
  isMine: true,
  openVacancies: 3,
  waitingForOtp: 0,
  vacancies: [{ id: 'vac-1', trade: 'Cook', headcount: 2, status: 'open' }],
  ...over,
});

export const business: BusinessDetail = {
  id: 'biz-1',
  code: 'BZ-0318',
  name: 'Annapoorna Mess',
  locality: 'BTM Layout',
  verificationStatus: 'pending_tl_check',
  agreementSigned: true,
  signedToday: true,
  canShowCandidates: true,
  paused: false,
  isMine: true,
  latitude: 12.9166,
  longitude: 77.6101,
  contactName: 'Shankar',
  contactRole: 'owner',
  contactPhoneLast4: '3310',
  contactLanguage: 'kn',
  vacancies: [
    {
      id: 'vac-1', code: 'VC-0001', trade: 'Cook', roleTitle: null, headcount: 2, salaryMinPaise: 1600000, salaryMaxPaise: 2000000,
      salaryPeriod: 'monthly', shift: 'day', startDate: '2026-11-12', status: 'open', confirmedAt: '2026-11-11T06:00:00Z',
      confirmedByName: 'Shankar', contactName: 'Shankar', contactRole: 'owner', contactPhoneLast4: '3310',
    },
    {
      id: 'vac-2', code: 'VC-0002', trade: 'Kitchen helper', roleTitle: null, headcount: 1, salaryMinPaise: 1200000, salaryMaxPaise: null,
      salaryPeriod: 'monthly', shift: 'day', startDate: null, status: 'awaiting_confirmation', confirmedAt: null,
      confirmedByName: null, contactName: 'Shankar', contactRole: 'owner', contactPhoneLast4: '3310',
    },
  ],
};

const card = (id: string, firstName: string, liked: boolean, km: number) => ({
  jobSeekerId: id,
  code: `JS-${id}`,
  card: {
    firstName, photoUrl: null, age: 27, trade: 'Cook', yearsExperience: 5, languages: ['Kannada', 'Hindi'], distanceKm: km,
    expectedSalary: { minPaise: 1700000, maxPaise: 1900000 }, matchReasons: [],
  },
  matchReasons: ['Cook, 5 yrs', `${km} km away`, 'Salary fits', 'Day 26 of 30'],
  priority: false,
  liked,
  area: { locality: 'Madiwala', latitude: 12.92, longitude: 77.62 },
});

export const matchesPage = (page = 1): MatchesPage => ({
  vacancyId: 'vac-1',
  business: { id: 'biz-1', name: 'Annapoorna Mess', latitude: 12.9166, longitude: 77.6101 },
  page,
  pageSize: 3,
  total: 11,
  likedCount: 1,
  matches: page === 1
    ? [card('js-1', 'Manjunath', false, 2), card('js-2', 'Sunil', true, 4), card('js-3', 'Revathi', false, 3)]
    : [card('js-4', 'Ramesh', false, 5)],
});

export const candidate: CandidateCard = {
  jobSeekerId: 'js-1', code: 'JS-00241', firstName: 'Manjunath', age: 27, trade: 'Cook', yearsExperience: 5, distanceKm: 2,
  locality: 'Madiwala', expectedSalary: { minPaise: 1500000, maxPaise: 1700000 }, languages: ['Kannada', 'Hindi'], shift: 'day',
  availableFrom: null, availableNow: true, lastRole: 'Cook', lastEmployer: 'Udupi Grand', idVerified: true, guaranteeDay: 26,
  guaranteeDays: 30, suitable: true, liked: true,
  vacancy: { id: 'vac-1', trade: 'Cook', locality: 'BTM Layout', shift: 'day', salaryMinPaise: 1600000, salaryMaxPaise: 2000000, businessName: 'Annapoorna Mess', businessId: 'biz-1' },
};

export const interview = (over: Partial<InterviewView> = {}): InterviewView => ({
  id: 'iv-1', code: 'IV-00001', status: 'confirmed', interviewType: 'in_shop_call', result: null, resultReason: null,
  resultRecordedAt: null, resultDueAt: '2026-11-11T14:30:00Z', slotStartsAt: '2026-11-11T06:30:00Z', slotEndsAt: '2026-11-11T07:00:00Z',
  offerSentAt: '2026-11-11T06:30:00Z', replyDueAt: '2026-11-11T06:30:00Z', candidateRespondedAt: '2026-11-11T06:30:00Z',
  offerMessagesSent: 2, businessDetailsSentAt: null, agentWillAttend: false, agentAttendanceRequired: false, firstWithBusiness: false,
  handedToOwnerAt: '2026-11-11T06:31:00Z', candidateArrivedAt: null, arrivalDistanceM: null, candidateCheckAnswer: null,
  resultRequestSentAt: null, selectedSalaryPaise: null, selectedJoiningDate: null, call: null,
  candidate: { id: 'js-1', code: 'JS-00241', firstName: 'Manjunath' },
  business: { id: 'biz-1', name: 'Annapoorna Mess', locality: 'BTM Layout', latitude: 12.9116, longitude: 77.6389, contactName: 'Shankar', contactRole: 'owner', contactPhoneLast4: '3310' },
  vacancy: { id: 'vac-1', trade: 'Cook', roleTitle: null, locality: 'BTM Layout', shift: 'day', salaryMinPaise: 1600000, salaryMaxPaise: 2000000, salaryPeriod: 'monthly' },
  placement: null,
  ...over,
});

export const placement = (over: Partial<PlacementView> = {}): PlacementView => ({
  id: 'pl-1', code: 'PL-00001', status: 'awaiting_payment',
  candidate: { id: 'js-1', code: 'JS-00241', firstName: 'Manjunath' },
  business: { id: 'biz-1', name: 'Annapoorna Mess', contactName: 'Shankar' },
  trade: 'Cook', totalPaise: 1003000, paidAt: null, paymentStatus: 'pending', paymentConfirmedAt: null,
  joiningDate: '2026-11-16T00:00:00.000Z', joinedDate: null, joiningNoShowReportedAt: null, invoiceCode: null,
  workerCall: null, ownerCall: null,
  comingUp: { dayCheckIn7: '2026-11-23T00:00:00.000Z', dayCheckIn30: '2026-12-16T00:00:00.000Z', joiningRewardAfterDays: 30, completesAt: '2027-01-15T00:00:00.000Z' },
  nextVacancies: [{ id: 'vac-2', trade: 'Kitchen helper', headcount: 1 }],
  ...over,
});

/** Answers a fixed set of GET/POST paths; records every request. */
export function routeTable(table: Record<string, unknown | ((init: RequestInit, url: string) => { status: number; body?: unknown })>) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const route: FetchRoute = (url, init) => {
    const u = new URL(url);
    const method = init.method ?? 'GET';
    calls.push({ method, path: u.pathname + u.search, body: init.body ? JSON.parse(String(init.body)) : undefined });
    for (const [key, answer] of Object.entries(table)) {
      const [m, p] = key.includes(' ') ? key.split(' ') : ['GET', key];
      if (m === method && (u.pathname === p || u.pathname + u.search === p)) {
        return typeof answer === 'function' ? (answer as (init: RequestInit, url: string) => { status: number; body?: unknown })(init, url) : { status: 200, body: answer };
      }
    }
    return undefined;
  };
  return { route, calls };
}

/** A queue that records what it sends and answers with `response`. */
export function recordingQueue(response: unknown = {}) {
  const sent: QueueItem[] = [];
  const queue = new OfflineQueue({
    store: createMemoryQueueStore(),
    send: async (item) => {
      sent.push(item);
      return response;
    },
  });
  return { queue, sent };
}

/** GET /screens/call-registration/job-seekers/:id */
export const notStarted = { state: 'not_started' as const };
export const seekerStatus = (over: object = {}) => ({
  id: 'js-uuid', code: 'JS-1042', name: 'Kavya Reddy', phone: '******2345', phoneVerifiedAt: '2026-11-11T05:01:00Z',
  stage: 'registered', nextStep: 'consent',
  steps: { phone: { state: 'done' }, consent: notStarted, selfie: notStarted, idCheck: notStarted, payment: notStarted },
  consent: { requiredGiven: 0, requiredTotal: 5, promotions: false },
  registrationLinkExpiresAt: null, paymentOnlyLink: null, paymentReceivedAt: null,
  ...over,
});

