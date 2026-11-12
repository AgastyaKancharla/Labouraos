import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { todayKeyIst } from '@/components/form';
import { kiran, renderWithApp } from '@/test/render';
import { routeTable } from '@/test/selling-fixtures';
import { routes } from '@/navigation/routes';
import MyAttendanceScreen from '.';
import RequestLeaveScreen from '../FA04f-RequestLeave';
import CorrectionScreen from '../FA04h-Correction';
import PayslipScreen from '../FA04g-Payslip';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));
beforeEach(() => jest.clearAllMocks());

const day = (date: string, extra: Record<string, unknown>) => ({
  id: `d-${date}`, date, dayType: 'full', loginAt: null, logoutAt: null, lateMinutes: 0, productionSeconds: 0, breakSeconds: 0,
  shortfallSeconds: 0, makeUpSeconds: 0, flagged: false, closedReason: null, leaveKind: null, leaveUnpaid: false, change: null, ...extra,
});

const month = {
  month: '2026-11', fullDays: 2, halfDays: 1, absentDays: 0, paidLeaveDays: { casual: 1, emergency: 0, total: 1 }, unpaidLeaveDays: 0,
  lateLogins: { count: 1, days: [{ date: '2026-11-06', minutes: 22 }] }, productionSeconds: 36 * 3600 + 9 * 60, shortfallSeconds: 80 * 60,
  makeUpSeconds: 40 * 60, deductibleShortfallSeconds: 40 * 60, workingDays: 25, holidays: [],
  days: [
    day('2026-11-03', { loginAt: '2026-11-03T03:59:00Z', logoutAt: '2026-11-03T13:40:00Z', productionSeconds: 8 * 3600 + 40 * 60, makeUpSeconds: 40 * 60 }),
    day('2026-11-04', { dayType: 'half', loginAt: '2026-11-04T04:00:00Z', logoutAt: '2026-11-04T08:40:00Z', productionSeconds: 4 * 3600 + 5 * 60 }),
    day('2026-11-05', { dayType: 'leave', leaveKind: 'casual' }),
    day('2026-11-06', { loginAt: '2026-11-06T04:22:00Z', logoutAt: '2026-11-06T13:01:00Z', lateMinutes: 22, productionSeconds: 7 * 3600 + 20 * 60, shortfallSeconds: 40 * 60 }),
    day('2026-11-09', { dayType: 'open', loginAt: '2026-11-09T04:01:00Z', productionSeconds: 3600 }),
  ],
};
const balance = {
  asOfMonth: '2026-11',
  casual: { earned: 3, taken: 1, paidTaken: 1, unpaidTaken: 0, left: 2 },
  emergency: { earned: 3, taken: 0, paidTaken: 0, unpaidTaken: 0, left: 3 },
};
const ravi = { id: 'tl-1', code: 'TL-00002', name: 'Ravi Shankar', role: 'team_lead' };
const requests = [
  { kind: 'leave', id: 'lv-2', status: 'pending', reason: 'Fever', where: 'with_team_lead', routeReason: 'team_lead', createdAt: '2026-11-09T10:00:00Z', decided: null, leaveKind: 'emergency', fromDate: '2026-11-13', toDate: '2026-11-13', days: 1 },
  { kind: 'correction', id: 'co-1', status: 'approved', reason: 'Login page down', where: 'decided', routeReason: 'team_lead', createdAt: '2026-11-06T10:00:00Z', decided: { at: '2026-11-06T11:00:00Z', by: ravi, role: 'team_lead', reason: 'Approved' }, date: '2026-11-06', startAt: '2026-11-06T04:00:00Z', endAt: '2026-11-06T04:22:00Z', segmentStatus: 'available' },
  { kind: 'leave', id: 'lv-1', status: 'approved', reason: 'Wedding', where: 'decided', routeReason: 'over_limit', createdAt: '2026-11-02T10:00:00Z', decided: { at: '2026-11-02T11:00:00Z', by: { ...ravi, name: 'Priya Sharma', role: 'manager' }, role: 'manager', reason: 'Busy week' }, leaveKind: 'casual', fromDate: '2026-11-23', toDate: '2026-11-27', days: 5, approvedFromDate: '2026-11-23', approvedToDate: '2026-11-25', approvedDays: 3 },
];

describe('FA04e My attendance', () => {
  it('shows the month, make-up owed, leave left, my requests with where they are, and each day with what it counts as', async () => {
    const { route, calls } = routeTable({ '/attendance/month': month, '/attendance/leave/balance': balance, '/attendance/requests/mine': requests });
    await renderWithApp(<MyAttendanceScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('fa04e-production'));
    expect(calls.find((c) => c.path.startsWith('/attendance/month'))?.path).toBe(`/attendance/month?month=${todayKeyIst().slice(0, 7)}`);
    // 4 expected days so far (2 full, 1 half, today) — leave days are not counted.
    expect(screen.getByTestId('fa04e-production')).toHaveTextContent(/36h 09m.*of 32h 00m needed so far \(4 working days\)/);
    expect(screen.getByTestId('fa04e-makeup')).toHaveTextContent(/0h 40m.*short 1h 20m · made up 40m · deducted if not made up by/);
    await waitFor(() => expect(screen.getByTestId('fa04e-leave-left')).toHaveTextContent(/5 left.*Planned 2 · emergency 3.*This month: planned 1 · emergency 0 · unpaid 0/));
    await waitFor(() => screen.getByTestId('fa04e-request-lv-2'));
    expect(screen.getByTestId('fa04e-request-lv-2')).toHaveTextContent(/Emergency leave · Fri 13 Nov.*With your Team Lead/);
    expect(screen.getByTestId('fa04e-request-co-1')).toHaveTextContent(/Correction · Fri 6 Nov, 09:30–09:52.*Approved by Ravi/);
    expect(screen.getByTestId('fa04e-request-lv-1')).toHaveTextContent(/Planned leave · Mon 23 Nov – Fri 27 Nov.*Busy week.*3 of 5 days approved/);
    expect(screen.getByTestId('fa04e-day-2026-11-09')).toHaveTextContent(/9:31 AM – ….*in progress.*Today/);
    expect(screen.getByTestId('fa04e-day-2026-11-06')).toHaveTextContent(/9:52 AM – 6:31 PM · 7h 20m.*Full day.*Late 22 min.*40m short/);
    expect(screen.getByTestId('fa04e-day-2026-11-05')).toHaveTextContent(/Planned leave/);
    expect(screen.getByTestId('fa04e-day-2026-11-04')).toHaveTextContent(/4h 05m.*Half day/);
    expect(screen.getByTestId('fa04e-day-2026-11-03')).toHaveTextContent(/8h 40m.*Full day.*\+40m make-up/);
    expect(screen.getByTestId('fa04e-next')).toBeDisabled();

    await fireEvent.press(screen.getByTestId('fa04e-leave'));
    await fireEvent.press(screen.getByTestId('fa04e-correction'));
    await fireEvent.press(screen.getByTestId('fa04e-payslips'));
    expect((router.push as jest.Mock).mock.calls.map((c) => c[0])).toEqual([routes.myLeave, routes.myCorrection, routes.myPayslips]);

    await fireEvent.press(screen.getByTestId('fa04e-prev'));
    const prev = new Date(`${todayKeyIst().slice(0, 7)}-01T00:00:00Z`);
    prev.setUTCMonth(prev.getUTCMonth() - 1);
    await waitFor(() => expect(calls.some((c) => c.path === `/attendance/month?month=${prev.toISOString().slice(0, 7)}`)).toBe(true));
  });
});

describe('FA04f Request leave', () => {
  it('sends planned leave with the dates from the calendar and says it went to the Manager when it is past 3 planned days', async () => {
    const today = todayKeyIst();
    const { route, calls } = routeTable({
      '/attendance/leave/balance': balance,
      '/attendance/month': month,
      'POST /attendance/leave': () => ({ status: 201, body: { kind: 'leave', id: 'lv-9', status: 'pending', where: 'with_manager', routeReason: 'over_limit', fromDate: today, toDate: today, days: 1, createdAt: '', decided: null, reason: 'Family function' } }),
    });
    await renderWithApp(<RequestLeaveScreen />, { signedInAs: kiran, route });
    await fireEvent.press(screen.getByTestId('fa04f-kind'));
    await waitFor(() => screen.getByText('Planned (casual) leave · 2 left'));
    await fireEvent.press(screen.getByTestId('fa04f-kind-option-casual'));
    expect(screen.getByTestId('fa04f-send')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('fa04f-from'));
    await fireEvent.press(screen.getByTestId(`fa04f-from-day-${today}`));
    await fireEvent.changeText(screen.getByTestId('fa04f-reason'), 'Family function');
    await waitFor(() => expect(screen.getByTestId('fa04f-planned')).toHaveTextContent(/1 days taken.*up to 3 planned days/));
    await fireEvent.press(screen.getByTestId('fa04f-send'));
    await waitFor(() => screen.getByTestId('fa04f-sent'));
    expect(calls).toContainEqual({ method: 'POST', path: '/attendance/leave', body: { kind: 'casual', fromDate: today, toDate: today, reason: 'Family function' } });
    expect(screen.getByTestId('fa04f-sent')).toHaveTextContent(/More than 3 planned days in a month, so it went to your Manager/);
  });

  it('needs signal: without it nothing is sent or saved on the phone', async () => {
    const today = todayKeyIst();
    const { queue, ...rest } = await renderWithApp(<RequestLeaveScreen />, {
      signedInAs: kiran,
      route: (url, init) => {
        if (init.method === 'POST') throw new TypeError('Network request failed');
        if (url.includes('/leave/balance')) return { status: 200, body: balance };
        if (url.includes('/attendance/month')) return { status: 200, body: month };
        return undefined;
      },
    });
    await fireEvent.press(screen.getByTestId('fa04f-kind'));
    await fireEvent.press(screen.getByTestId('fa04f-kind-option-emergency'));
    await fireEvent.press(screen.getByTestId('fa04f-from'));
    await fireEvent.press(screen.getByTestId(`fa04f-from-day-${today}`));
    await fireEvent.changeText(screen.getByTestId('fa04f-reason'), 'Fever');
    await fireEvent.press(screen.getByTestId('fa04f-send'));
    await waitFor(() => expect(screen.getByTestId('error-banner')).toHaveTextContent(/This step needs signal/));
    expect(queue.list()).toEqual([]);
    expect(rest.fetchImpl.mock.calls.filter(([, init]) => (init as RequestInit).method === 'POST')).toHaveLength(1);
    await expect(queue.enqueue('fa-1', 'Leave', { method: 'POST', path: '/attendance/leave', json: {} })).rejects.toThrow(/cannot be queued/);
    await expect(queue.enqueue('fa-1', 'Correction', { method: 'POST', path: '/attendance/corrections', json: {} })).rejects.toThrow(/cannot be queued/);
  });
});

describe('FA04h Request a correction', () => {
  it('sends the day, the picked times and what it should have been, and refuses "to" before "from"', async () => {
    const today = todayKeyIst();
    const { route, calls } = routeTable({
      'POST /attendance/corrections': () => ({ status: 201, body: { kind: 'correction', id: 'co-9', status: 'pending', where: 'with_team_lead', routeReason: 'team_lead', date: today, createdAt: '', decided: null, reason: 'x' } }),
    });
    await renderWithApp(<CorrectionScreen />, { signedInAs: kiran, route });
    await fireEvent.press(screen.getByTestId('fa04h-date'));
    await fireEvent.press(screen.getByTestId(`fa04h-date-day-${today}`));
    await fireEvent.press(screen.getByTestId('fa04h-from'));
    await fireEvent.press(screen.getByTestId('fa04h-from-option-09:30'));
    await fireEvent.press(screen.getByTestId('fa04h-to'));
    await fireEvent.press(screen.getByTestId('fa04h-to-option-09:25'));
    await fireEvent.changeText(screen.getByTestId('fa04h-reason'), 'Login page was not loading');
    expect(screen.getByTestId('fa04h-to-error')).toHaveTextContent('"To" must be after "From".');
    expect(screen.getByTestId('fa04h-send')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('fa04h-to'));
    await fireEvent.press(screen.getByTestId('fa04h-to-option-09:50'));
    await fireEvent.press(screen.getByTestId('fa04h-status'));
    await fireEvent.press(screen.getByTestId('fa04h-status-option-team_meeting'));
    await fireEvent.press(screen.getByTestId('fa04h-send'));
    await waitFor(() => screen.getByTestId('fa04h-sent'));
    expect(calls).toContainEqual({
      method: 'POST', path: '/attendance/corrections',
      body: { date: today, from: '09:30', to: '09:50', status: 'team_meeting', reason: 'Login page was not loading' },
    });
    expect(screen.getByTestId('fa04h-sent')).toHaveTextContent(/09:30–09:50.*with your Team Lead/);
  });
});

const slip = {
  month: '2026-10', label: 'October 2026', status: 'paid', paidOn: '2026-11-01T06:00:00Z',
  company: { name: 'Laboura Private Limited', address: null, city: 'Bengaluru' },
  employee: { name: 'Kiran Kumar', code: 'FA-00017', designation: 'Field agent', reportsTo: 'Ravi Shankar', joinedOn: '2026-08-01T00:00:00Z', paymentRefLast4: '4417', paidFrom: null },
  days: { salaryDays: 31, calendarDays: 31, paidDays: 30, lossOfPayDays: 1, notEmployedDays: 0, shortfallMinutes: 30 },
  earnings: [{ key: 'basic', label: 'Basic', paise: 900000 }, { key: 'hra', label: 'HRA', paise: 360000 }, { key: 'special', label: 'Special', paise: 540000 }],
  grossPaise: 1800000,
  deductions: [{ key: 'pf', label: 'PF', paise: 0, note: 'from registration' }, { key: 'loss_of_pay', label: 'LOP', paise: 54800, note: null }, { key: 'shortfall', label: 'Shortfall', paise: 3400, note: null }],
  deductionsPaise: 58200, netPaise: 1741800, netInWords: 'Seventeen thousand four hundred eighteen rupees', note: '',
};

describe('FA04g Payslips', () => {
  it('shows only released months and the payslip with earnings, deductions and net pay', async () => {
    const { route, calls } = routeTable({
      '/payroll/my-payslips': { months: [{ month: '2026-10', label: 'October 2026', paidOn: '2026-11-01T06:00:00Z' }, { month: '2026-09', label: 'September 2026', paidOn: '2026-10-01T06:00:00Z' }] },
      '/payroll/my-payslips/2026-10': slip,
      '/payroll/my-payslips/2026-09': () => ({ status: 404, body: { message: 'Not released' } }),
    });
    await renderWithApp(<PayslipScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('fa04g-slip'));
    expect(screen.getByTestId('fa04g-slip')).toHaveTextContent(/LABOURA PRIVATE LIMITED.*Payslip for October 2026.*Paid on Sun 1 Nov.*FA-00017.*\*\*\*\*4417.*30 \(1 loss of pay\)/);
    expect(screen.getByTestId('fa04g-gross')).toHaveTextContent(/Gross₹18,000/);
    expect(screen.getByTestId('fa04g-slip')).toHaveTextContent(/Provident fund \(PF\)from registration.*Loss of pay · 1 day₹548.*Shortfall not made up · 0h 30m₹34/);
    expect(screen.getByTestId('fa04g-net')).toHaveTextContent(/Net pay₹17,418Seventeen thousand/);
    await fireEvent.press(screen.getByTestId('fa04g-month'));
    await fireEvent.press(screen.getByTestId('fa04g-month-option-2026-09'));
    await waitFor(() => screen.getByText('This payslip is not released yet.'));
    expect(calls.map((c) => c.path)).toEqual(expect.arrayContaining(['/payroll/my-payslips', '/payroll/my-payslips/2026-10', '/payroll/my-payslips/2026-09']));
  });

  it('says so when Finance has not paid any salary yet', async () => {
    const { route } = routeTable({ '/payroll/my-payslips': { months: [] } });
    await renderWithApp(<PayslipScreen />, { signedInAs: kiran, route, language: 'kn' });
    await waitFor(() => screen.getByText('ಇನ್ನೂ ಸಂಬಳ ಚೀಟಿ ಇಲ್ಲ. ಹಣಕಾಸು ವಿಭಾಗ ನಿಮ್ಮ ಸಂಬಳ ಪಾವತಿಸಿದ ನಂತರ ಇಲ್ಲಿ ಕಾಣಿಸುತ್ತದೆ.'));
  });
});
