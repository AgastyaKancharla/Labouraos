import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi, renderScreen, signInAs } from '../../../test/utils';
import Reports from '../MG-Reports';
import CeoReports from '../../ceo/C-Reports';

const NOW = new Date('2026-11-16T05:00:00Z'); // Mon 16 Nov, 10:30 IST
const common = {
  'GET /login-codes/pending': [],
  'GET /review-flags': [],
  'GET /refunds/due': [],
  'GET /notifications/bell': { openCount: 0, unseenCount: 0, latest: [], doneToday: [], asOf: NOW.toISOString() },
};
const row = (registered: number, placed: number) => ({ from: '2026-11-08T18:30:00.000Z', to: '2026-11-15T18:29:59.999Z', startDay: '2026-11-09', registered, paid: 62, businessesSignedUp: 10, interviewsDone: 36, placed, attendancePercent: 96, lostSeconds: 34200, placementTarget: 10, reached: placed >= 10 });
const team = { teamLeadId: 'tl1', team: 'Team South', teamLead: 'Ravi', placed: 5, placementPlan: 6, paid: 38, attendancePercent: 97, lateLogins: 4, best: { staff: { id: 'fa1', name: 'Kiran Kumar' }, placed: 3, paid: 2 }, needsHelp: null };
const kept = [{ week: '2026-11-09', end: '2026-11-15', label: '9–15 Nov', sentAt: '2026-11-16T03:30:00.000Z' }];

describe('Weekly reports (MG-Reports) and the Monday report', () => {
  it('keeps the design text, lists the kept Monday reports and opens one as it was sent', async () => {
    const api = mockApi({
      ...common,
      'GET /manager/reports/weekly': { rows: [row(93, 8)], lastWeek: { from: '', to: '' }, teams: [team] },
      'GET /weekly-reports': kept,
      'GET /weekly-reports/2026-11-09': { week: '2026-11-09', end: '2026-11-15', label: '9–15 Nov', sentAt: '2026-11-16T03:30:00.000Z', content: { week: { start: '2026-11-09', end: '2026-11-15', label: '9–15 Nov' }, rows: [row(88, 11)], lastWeek: { from: '', to: '' }, teams: [team] } },
    });
    signInAs('manager');
    renderScreen(<Reports />, { portal: 'manager', path: '/manager/reports', now: NOW });
    expect(await screen.findByText('93')).toBeInTheDocument();
    expect(screen.getByText(/Counts only · sent to you and the CEO every Monday at 9 AM · weekly target = a week's share of the month's placement target/)).toBeInTheDocument();
    expect(screen.getByText('Team South · last week')).toBeInTheDocument();
    await screen.findByRole('option', { name: /9–15 Nov · sent/ });
    await userEvent.selectOptions(screen.getByLabelText('Monday reports'), '2026-11-09');
    expect(await screen.findByText('88')).toBeInTheDocument();
    expect(screen.getByText('Team South · 9–15 Nov')).toBeInTheDocument();
    expect(screen.getByText('Reached')).toBeInTheDocument();
    expect(api.calls('GET /weekly-reports/2026-11-09')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Back to live numbers' }));
    expect(await screen.findByText('93')).toBeInTheDocument();
  });

  it('the bell link ?week= opens that week straight away', async () => {
    const api = mockApi({
      ...common,
      'GET /manager/reports/weekly': { rows: [], lastWeek: { from: '', to: '' }, teams: [] },
      'GET /weekly-reports': kept,
      'GET /weekly-reports/2026-11-09': { week: '2026-11-09', end: '2026-11-15', label: '9–15 Nov', sentAt: '2026-11-16T03:30:00.000Z', content: { week: { start: '2026-11-09', end: '2026-11-15', label: '9–15 Nov' }, rows: [row(88, 11)], lastWeek: { from: '', to: '' }, teams: [] } },
    });
    signInAs('manager');
    const { container } = renderScreen(<Reports />, { portal: 'manager', path: '/manager/reports?week=2026-11-09', route: '/manager/reports', now: NOW });
    expect(await screen.findByText('88')).toBeInTheDocument();
    expect(api.calls('GET /manager/reports/weekly')).toHaveLength(0);
    expect(container.textContent).not.toMatch(/₹/);
  });
});

describe('C-Reports and the kept company report', () => {
  const reports = {
    kpis: { netPaise: 46800000, changePercent: 18, averageFeePaise: 800000, revenuePerAgentPaise: 4250000, fillRatePercent: 69, averageDaysToFill: 9, refundsPercentOfRevenue: 2.5 },
    totals: { grossPaise: 0, refundsPaidPaise: 0, placementCount: 0 },
    monthly: [{ month: '2026-11', netPaise: 46800000 }],
    funnel: { registered: 1, paid: 1, offered: 1, accepted: 1, joined: 1, paidPercent: 78, offeredPercent: 30, acceptedPercent: 54, joinedPercent: 77, stillWorkingDay60Percent: 88 },
    sources: [],
    bestAreas: [],
    tradesToRecruit: [],
    cohort: { month: '2026-09', size: 10, placedWithinGuaranteePercent: 34, refundedPercent: 6, deactivatedPercent: 19, stillLookingPercent: 41 },
  };

  it('opens the week the Monday bell points at, with the company counts and the C-Reports numbers of that week', async () => {
    const api = mockApi({
      ...common,
      'GET /weekly-reports': kept,
      'GET /weekly-reports/2026-11-09': {
        week: '2026-11-09',
        end: '2026-11-15',
        label: '9–15 Nov',
        sentAt: '2026-11-16T03:30:00.000Z',
        content: { week: { start: '2026-11-09', end: '2026-11-15', label: '9–15 Nov' }, rows: [row(120, 12)], lastWeek: { from: '', to: '' }, teams: [team], reports, guarantee: { range: { total: { couldGoBackPaise: 100000, safelyEarnedPaise: 200000, receivedPaise: 300000 } } } },
      },
    });
    signInAs('ceo');
    renderScreen(<CeoReports />, { portal: 'ceo', path: '/ceo/reports?week=2026-11-09', route: '/ceo/reports', now: NOW });
    expect(await screen.findByText('120')).toBeInTheDocument();
    expect(screen.getByText('₹4.68L')).toBeInTheDocument();
    expect(screen.getByText('₹1,000')).toBeInTheDocument();
    expect(screen.getByText('Team South · 9–15 Nov')).toBeInTheDocument();
    expect(api.calls('GET /ceo/reports')).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Back to live numbers' }));
    await waitFor(() => expect(api.calls('GET /ceo/reports').length).toBeGreaterThan(0));
  });
});
