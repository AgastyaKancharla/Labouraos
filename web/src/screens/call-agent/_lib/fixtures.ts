import type { HomeData, SeekerProfile, WorkItem } from './api';

/** Test data shaped like the API answers (GET /call-work/…). */
export const NOW = new Date('2026-11-11T06:00:00Z'); // Wed 11 Nov, 11:30 IST

export function workItem(over: Partial<WorkItem> = {}): WorkItem {
  return {
    key: 'refund:js1',
    kind: 'close_to_refund',
    category: 'priority',
    subjectType: 'job_seeker',
    subjectId: 'js1',
    code: 'JS-00198',
    name: 'Ramesh Gowda',
    maskedPhone: '******4412',
    trade: 'Electrician',
    dueAt: '2026-10-15T05:00:00Z',
    priority: true,
    daysLeft: 4,
    guaranteeDay: 27,
    guaranteeDays: 30,
    detail: {},
    call: { purpose: 'general', relatedType: null, relatedId: null },
    callable: true,
    lockedReason: null,
    ...over,
  };
}

const metric = (achieved: number, target: number) => ({ achieved, target, expectedPace: target / 3, status: 'set', behindPace: false, breached: false });

export function homeData(over: Partial<HomeData> = {}): HomeData {
  const items = [
    workItem(),
    workItem({
      key: 'offer:i1',
      kind: 'offer_reply',
      category: 'offers',
      subjectId: 'js2',
      code: 'JS-00210',
      name: 'Suresh Patil',
      maskedPhone: '******8810',
      trade: 'Plumber',
      priority: false,
      daysLeft: null,
      detail: { replyDueAt: '2026-11-11T12:30:00Z', interviewId: 'i1' },
      call: { purpose: 'offer', relatedType: 'interview', relatedId: 'i1' },
    }),
    workItem({
      key: 'task:t1',
      kind: 'callback',
      category: 'callbacks',
      subjectId: 'js3',
      code: 'JS-00220',
      name: 'Lakshmi Bai',
      maskedPhone: '******2271',
      trade: 'Housekeeping',
      priority: false,
      daysLeft: null,
      dueAt: '2026-11-11T06:00:00Z',
    }),
  ];
  return {
    now: NOW.toISOString(),
    callingHours: { start: '09:00', end: '21:00' },
    inCallingHours: true,
    attendanceStatus: 'available',
    canCall: true,
    callNext: { key: 'refund:js1', name: 'Ramesh Gowda', subjectType: 'job_seeker', subjectId: 'js1' },
    today: {
      callsAnswered: 23,
      talkSeconds: 6480,
      productionSeconds: 12840,
      productionTargetSeconds: 28800,
      registrations: 2,
      interviewsBooked: 1,
      teamAverage: { agents: 10, callsAnswered: 21, talkSeconds: 5400, registrations: 2, interviewsBooked: 1 },
    },
    work: { items, counts: { all: 3, callbacks: 1, follow_ups: 0, offers: 1, new_leads: 0, priority: 1 } },
    month: {
      year: 2026,
      month: 11,
      currentDay: 11,
      daysInMonth: 30,
      candidatesActivated: metric(18, 30),
      vacanciesCaptured: metric(5, 12),
      refundRate: { ...metric(0.04, 0.08), matured: 25 },
    },
    stuck: [
      { jobSeekerId: 'js9', code: 'JS-00301', name: 'Pooja Nair', maskedPhone: '******6643', trade: 'Delivery', step: 'payment_failed', failures: 2, linkLive: true, since: '2026-11-10T05:00:00Z' },
    ],
    nearRefund: { count: 1, windowDays: 15 },
    doneToday: [{ kind: 'registered', at: '2026-11-11T05:00:00Z', name: 'Kavya Reddy', code: 'JS-00400', status: 'consented', extra: null }],
    ...over,
  };
}

export function seekerProfile(over: Partial<SeekerProfile> = {}): SeekerProfile {
  return {
    type: 'job_seeker',
    onList: workItem(),
    history: [
      { kind: 'call', at: '2026-11-11T04:42:00Z', direction: 'outbound', answered: true, durationSec: 180, by: 'you', note: 'free from Monday' },
      { kind: 'payment_confirmed', at: '2026-10-13T05:00:00Z', feePaise: 49900 },
    ],
    canCallNow: true,
    attendanceAvailable: true,
    inCallingHours: true,
    callingHours: { start: '09:00', end: '21:00' },
    id: 'js1',
    code: 'JS-00198',
    name: 'Ramesh Gowda',
    maskedPhone: '******4412',
    status: 'active',
    trades: [{ trade: 'Electrician', years: 4, primary: true }],
    languages: ['Kannada', 'Hindi'],
    salary: { minPaise: 1500000, maxPaise: 1800000, period: 'monthly' },
    locality: 'JP Nagar',
    travelDistanceKm: 8,
    shiftPreference: 'day',
    availableFrom: '2026-11-16T00:00:00Z',
    bestTime: { start: '10:00', end: '19:00' },
    withinBestTimeNow: true,
    registeredBy: 'Arun P',
    registeredAt: '2026-10-09T05:00:00Z',
    editLocked: true,
    glance: { consentsGiven: 5, consentsRequired: 5, callRecordingConsent: true, paid: true, guaranteeDay: 27, guaranteeDays: 30, daysLeft: 4, priority: true, aadhaar: 'verified', hits: 1, maxHits: 3 },
    registration: { steps: { consent: true, selfie: true, idCheck: true, payment: true }, done: 4, total: 4 },
    liveOffer: null,
    followUpDue: null,
    introductions: [],
    ...over,
  };
}

export const jobs = {
  jobSeekerId: 'js1',
  page: 1,
  pageSize: 3,
  total: 2,
  blockedReason: null,
  jobs: [
    {
      vacancyId: 'v1',
      vacancyCode: 'VC-00010',
      trade: 'Electrician',
      roleTitle: null,
      locality: 'HSR Layout',
      businessType: 'Hotel',
      salaryMinPaise: 1600000,
      salaryMaxPaise: 1800000,
      shift: 'day',
      workingHours: '9 AM – 7 PM',
      weeklyOff: 'Tuesday',
      extras: ['food provided'],
      interviewType: 'walk_in',
      distanceKm: 3,
      suitability: { sameTrade: true, salaryInRange: true, distanceKm: 3, travelDistanceKm: 8, shift: 'day' },
      slots: [
        { id: 's1', startsAt: '2026-11-12T05:00:00Z', endsAt: '2026-11-12T12:30:00Z', placesLeft: 4 },
        { id: 's2', startsAt: '2026-11-13T05:00:00Z', endsAt: '2026-11-13T12:30:00Z', placesLeft: 0 },
      ],
    },
  ],
};
