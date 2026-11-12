import type { AttendanceDayRow, AttendanceMonth, AttendanceToday, LeaveBalance, MyRequest } from './api';

/** Mon 9 Nov 2026, 11:30 AM IST — test data only. */
export const ATT_NOW = new Date('2026-11-09T06:00:00.000Z');

const at = (hhmm: string) => {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 10, 9, h, m) - 330 * 60_000).toISOString();
};
export const istAt = at;

const POLICY = { productionHoursFullDay: 8, lateGraceMinutes: 10, shortBreakMinutes: 15, lunchMinutes: 30, idleAfterMinutes: 10, idlePromptMinutes: 1 };

export function notStartedToday(over: Partial<AttendanceToday> = {}): AttendanceToday {
  return {
    date: '2026-11-09',
    status: null,
    loginAt: null,
    logoutAt: null,
    lateMinutes: 0,
    productionSeconds: 0,
    breakSeconds: 0,
    idleSeconds: 0,
    shortfallSeconds: 8 * 3600,
    clocks: { shiftStart: '09:30', shiftEnd: '18:30', now: ATT_NOW.toISOString() },
    flagged: false,
    closedReason: null,
    dayType: 'open',
    statusSince: null,
    shortBreakSeconds: 0,
    shortBreaks: 0,
    lunchSeconds: 0,
    meetingSeconds: 0,
    segments: [],
    policy: POLICY,
    ...over,
  };
}

/** Logged in 9:31, team meeting 10:00–10:25, 14 calls, short break 11:05–11:20, Available since 11:20. */
export function openToday(over: Partial<AttendanceToday> = {}): AttendanceToday {
  const segments = [
    { status: 'available', startedAt: at('09:31'), endedAt: at('10:00'), source: 'staff', approved: null },
    { status: 'team_meeting', startedAt: at('10:00'), endedAt: at('10:25'), source: 'staff', approved: null },
    { status: 'available', startedAt: at('10:25'), endedAt: at('10:30'), source: 'staff', approved: null },
    ...Array.from({ length: 14 }, (_, i) => [
      { status: 'on_call', startedAt: at(`10:${String(30 + i * 2).padStart(2, '0')}`), endedAt: at(`10:${String(31 + i * 2).padStart(2, '0')}`), source: 'phone_system', approved: null },
      { status: 'after_call_notes', startedAt: at(`10:${String(31 + i * 2).padStart(2, '0')}`), endedAt: at(`10:${String(32 + i * 2).padStart(2, '0')}`), source: 'phone_system', approved: null },
    ]).flat(),
    { status: 'available', startedAt: at('10:58'), endedAt: at('11:05'), source: 'phone_system', approved: null },
    { status: 'short_break', startedAt: at('11:05'), endedAt: at('11:20'), source: 'staff', approved: null },
    { status: 'available', startedAt: at('11:20'), endedAt: null, source: 'staff', approved: null },
  ];
  return notStartedToday({
    status: 'available',
    loginAt: at('09:31'),
    productionSeconds: (3 * 60 + 34) * 60,
    breakSeconds: 15 * 60,
    shortfallSeconds: (4 * 60 + 26) * 60,
    statusSince: at('11:20'),
    shortBreakSeconds: 15 * 60,
    shortBreaks: 1,
    meetingSeconds: 25 * 60,
    segments,
    ...over,
  });
}

export function onBreakToday(startedHhmm: string, over: Partial<AttendanceToday> = {}): AttendanceToday {
  const base = openToday();
  return {
    ...base,
    status: 'short_break',
    statusSince: at(startedHhmm),
    shortBreakSeconds: 15 * 60,
    shortBreaks: 2,
    segments: [...base.segments.slice(0, -1), { status: 'available', startedAt: at('11:20'), endedAt: at(startedHhmm), source: 'staff', approved: null }, { status: 'short_break', startedAt: at(startedHhmm), endedAt: null, source: 'staff', approved: null }],
    ...over,
  };
}

export function endedToday(over: Partial<AttendanceToday> = {}): AttendanceToday {
  return openToday({
    status: null,
    statusSince: null,
    logoutAt: at('18:42'),
    productionSeconds: (8 * 60 + 6) * 60,
    lunchSeconds: 30 * 60,
    idleSeconds: 5 * 60,
    dayType: 'full',
    closedReason: 'logout',
    segments: [
      { status: 'available', startedAt: at('09:31'), endedAt: at('11:05'), source: 'staff', approved: null },
      { status: 'short_break', startedAt: at('11:05'), endedAt: at('11:20'), source: 'staff', approved: null },
      { status: 'available', startedAt: at('11:20'), endedAt: at('16:00'), source: 'staff', approved: null },
      { status: 'short_break', startedAt: at('16:00'), endedAt: at('16:15'), source: 'staff', approved: null },
      { status: 'available', startedAt: at('16:15'), endedAt: at('18:42'), source: 'staff', approved: null },
    ],
    ...over,
  });
}

function day(over: Partial<AttendanceDayRow>): AttendanceDayRow {
  return {
    id: over.date ?? 'd',
    date: '2026-11-09',
    dayType: 'full',
    loginAt: null,
    logoutAt: null,
    lateMinutes: 0,
    productionSeconds: 0,
    breakSeconds: 0,
    shortfallSeconds: 0,
    makeUpSeconds: 0,
    flagged: false,
    closedReason: null,
    leaveKind: null,
    leaveUnpaid: false,
    change: null,
    ...over,
  };
}

const iso = (date: string, hhmm: string) => {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  const [y = 2026, mo = 1, d = 1] = date.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, m) - 330 * 60_000).toISOString();
};

export function monthFixture(over: Partial<AttendanceMonth> = {}): AttendanceMonth {
  return {
    month: '2026-11',
    fullDays: 2,
    halfDays: 1,
    absentDays: 0,
    paidLeaveDays: { casual: 1, emergency: 0, total: 1 },
    unpaidLeaveDays: 0,
    lateLogins: { count: 1, days: [{ date: '2026-11-06', minutes: 22 }] },
    productionSeconds: (36 * 60 + 9) * 60,
    shortfallSeconds: 80 * 60,
    makeUpSeconds: 40 * 60,
    deductibleShortfallSeconds: 40 * 60,
    workingDays: 24,
    holidays: [],
    days: [
      day({ date: '2026-11-03', dayType: 'full', loginAt: iso('2026-11-03', '09:29'), logoutAt: iso('2026-11-03', '19:10'), productionSeconds: (8 * 60 + 40) * 60, makeUpSeconds: 40 * 60 }),
      day({ date: '2026-11-04', dayType: 'half', loginAt: iso('2026-11-04', '09:30'), logoutAt: iso('2026-11-04', '14:10'), productionSeconds: (4 * 60 + 5) * 60 }),
      day({ date: '2026-11-05', dayType: 'leave', leaveKind: 'casual' }),
      day({ date: '2026-11-06', dayType: 'full', loginAt: iso('2026-11-06', '09:52'), logoutAt: iso('2026-11-06', '18:31'), productionSeconds: (7 * 60 + 20) * 60, lateMinutes: 22, shortfallSeconds: 40 * 60 }),
      day({ date: '2026-11-07', dayType: 'full', loginAt: iso('2026-11-07', '09:28'), logoutAt: iso('2026-11-07', '18:35'), productionSeconds: (8 * 60 + 4) * 60 }),
      day({ date: '2026-11-09', dayType: 'open', loginAt: iso('2026-11-09', '09:31') }),
    ],
    ...over,
  };
}

export const balanceFixture: LeaveBalance = {
  asOfMonth: '2026-11',
  casual: { earned: 2, taken: 1, paidTaken: 1, unpaidTaken: 0, left: 1 },
  emergency: { earned: 2, taken: 0, paidTaken: 0, unpaidTaken: 0, left: 2 },
};

export const requestsFixture: MyRequest[] = [
  { kind: 'leave', id: 'l1', status: 'pending', reason: 'Family function', where: 'with_team_lead', routeReason: 'team_lead', createdAt: iso('2026-11-09', '09:40'), decided: null, leaveKind: 'emergency', fromDate: '2026-11-13', toDate: '2026-11-13', days: 1 },
  { kind: 'correction', id: 'c1', status: 'approved', reason: 'Login page down', where: 'decided', routeReason: 'team_lead', createdAt: iso('2026-11-06', '10:00'), decided: { at: iso('2026-11-06', '12:00'), by: { id: 'tl', code: 'TL-0003', name: 'Ravi Shankar', role: 'team_lead' }, role: 'team_lead', reason: 'Saw it' }, date: '2026-11-06', startAt: iso('2026-11-06', '09:30'), endAt: iso('2026-11-06', '09:52'), segmentStatus: 'available' },
  { kind: 'leave', id: 'l0', status: 'approved', reason: 'Wedding', where: 'decided', routeReason: 'team_lead', createdAt: iso('2026-11-01', '10:00'), decided: { at: iso('2026-11-02', '10:00'), by: null, role: 'team_lead', reason: null }, leaveKind: 'casual', fromDate: '2026-11-05', toDate: '2026-11-05', days: 1 },
];
