import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { LANGUAGE_STORAGE_KEY } from '../i18n/I18nProvider';
import { apiError, mockApi, renderScreen, signInAs } from '../test/utils';
import PlacementDetail from '../screens/ceo/C-Placement';
import ManagerRequests from '../screens/manager/MG-Requests';
import TeamLeadRequests from '../screens/team-lead/T-Requests';
import Search from '../screens/call-agent/CA16-Search';
import type { WorkerLeftForm } from './WorkerLeft';

/**
 * "Report worker left" (the replacement claim) on the CEO placement page, the
 * Manager and Team Lead request screens and the call agent console — it used
 * to live only on the old Admin Dashboard.
 */
const NOW = new Date('2026-11-14T06:30:00Z'); // 12:00 IST

const form = (over: Partial<WorkerLeftForm> = {}): WorkerLeftForm => ({
  placement: { id: 'pl42', code: 'PL-00042', status: 'active', workerName: 'Ravi Kumar', businessId: 'bz1', businessName: 'Lakshmi Tiffins', joinedDate: '2026-10-20T04:30:00Z' },
  guarantee: { windowDays: 60, endsAt: '2026-12-19T04:30:00Z', reportWithinDays: 7, decisionHours: 48 },
  leftOnLatest: NOW.toISOString(),
  canReport: true,
  blocked: null,
  openClaim: null,
  ownerCalls: [{ id: 'call7', code: 'CL-00007', at: '2026-11-14T05:00:00Z', durationSec: 95, by: 'Deepa Nair' }],
  reasons: {
    covered: ['resigned', 'absconded_3_days', 'never_joined', 'serious_misconduct', 'repeated_absence', 'skill_gap_15_days', 'misrepresentation'],
    notCovered: ['business_closed', 'role_changed', 'salary_unpaid', 'unsafe_workplace', 'fired_without_reason', 'hired_own_person'],
  },
  ...over,
});

const detail = (over: Record<string, unknown> = {}) => ({
  id: 'pl42',
  code: 'PL-00042',
  status: 'active',
  stage: 'guarantee',
  jobSeeker: { id: 'js1', code: 'JS-00101', name: 'Ravi Kumar' },
  business: { id: 'bz1', code: 'BZ-00011', name: 'Lakshmi Tiffins' },
  vacancy: { id: 'v1', code: 'VC-1', tradeSkill: 'Cook', roleTitle: null },
  salaryPaise: 1500000,
  feePaise: 750000,
  gstPaise: 135000,
  paidAt: '2026-10-19T06:00:00Z',
  invoiceCode: 'INV-00042',
  feePayment: null,
  joinedDate: '2026-10-20T04:30:00Z',
  joiningCallsAnswered: true,
  referral: null,
  joiningReward: null,
  guarantee: { windowDays: 60, searchDays: 15, day: 26, endedReason: null, dropoutReportedAt: null, searchDaysLeft: null, maxReplacements: 2, maxRejections: 2, replacementsOffered: 0, replacementsRejected: 0 },
  claim: null,
  refund: null,
  chain: [],
  replacementCandidates: [],
  timeline: [],
  ...over,
});

const openPlacement = (routes: Record<string, unknown>, d = detail()) => {
  const api = mockApi({ 'GET /ceo/placements/pl42': d, ...routes });
  signInAs('ceo');
  renderScreen(<PlacementDetail />, { portal: 'ceo', path: '/ceo/placements/pl42', route: '/ceo/placements/:id', now: NOW });
  return api;
};

afterEach(() => {
  localStorage.removeItem(LANGUAGE_STORAGE_KEY);
});

describe('Report worker left — CEO placement page (C-Placement)', () => {
  it('reports the claim on the answered owner call, with the date and a reason from the agreed list', async () => {
    const api = openPlacement({
      'GET /placements/pl42/worker-left': form(),
      'POST /placements/pl42/claims': { code: 'RC-00005', decision: null, decisionReason: null },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Report worker left' }));
    const dialog = await screen.findByRole('dialog', { name: 'Report that Ravi Kumar left' });
    expect(await within(dialog).findByText('PL-00042 · Ravi Kumar at Lakshmi Tiffins')).toBeInTheDocument();
    const submit = within(dialog).getByRole('button', { name: 'Report worker left' });
    expect(submit).toBeDisabled();

    // reasons: the guide's lists, the not-covered ones marked
    const reason = within(dialog).getByLabelText(/Why the worker left/);
    expect(within(reason).getByRole('option', { name: 'Worker resigned or left' })).toBeInTheDocument();
    expect(within(reason).getByRole('option', { name: 'Business hired a relative or its own person instead — Not covered by the guarantee' })).toBeInTheDocument();
    // the owner call is picked for you (latest answered)
    expect(within(dialog).getByLabelText(/Answered call with the owner/)).toHaveValue('call7');

    await userEvent.type(within(dialog).getByLabelText(/Date the worker left/), '2026-11-12');
    await userEvent.selectOptions(reason, 'resigned');
    expect(submit).toBeEnabled();
    await userEvent.click(submit);
    await waitFor(() => expect(api.calls('POST /placements/pl42/claims')).toHaveLength(1));
    expect(api.calls('POST /placements/pl42/claims')[0].body).toEqual({ workerLeftOn: '2026-11-12', reason: 'resigned', callRecordId: 'call7' });
    expect(await screen.findByText('Claim RC-00005 reported. It is decided within 48 hours.')).toBeInTheDocument();
  });

  it('warns that a not-covered reason is turned down, and shows the server’s answer', async () => {
    openPlacement({
      'GET /placements/pl42/worker-left': form(),
      'POST /placements/pl42/claims': { code: 'RC-00006', decision: 'rejected', decisionReason: "Auto-rejected: Reason 'business_closed' is in the non-eligible rejection list" },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Report worker left' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(await within(dialog).findByLabelText(/Date the worker left/), '2026-11-12');
    await userEvent.selectOptions(within(dialog).getByLabelText(/Why the worker left/), 'business_closed');
    expect(within(dialog).getByText(/This reason is not covered by the guarantee/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Report worker left' }));
    expect(await screen.findByText(/Claim RC-00006 recorded but turned down automatically/)).toBeInTheDocument();
  });

  it('with no answered owner call yet, offers to call the owner and cannot be sent', async () => {
    const api = openPlacement({ 'GET /placements/pl42/worker-left': form({ ownerCalls: [] }), 'POST /calls': { id: 'call9' } });
    await userEvent.click(await screen.findByRole('button', { name: 'Report worker left' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/No answered call with the owner since the worker joined/)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/Date the worker left/), '2026-11-12');
    await userEvent.selectOptions(within(dialog).getByLabelText(/Why the worker left/), 'resigned');
    expect(within(dialog).getByRole('button', { name: 'Report worker left' })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('button', { name: /Call the owner/ }));
    await waitFor(() => expect(api.calls('POST /calls')[0].body).toEqual({ subjectType: 'business', subjectId: 'bz1', purpose: 'general', relatedType: 'placement', relatedId: 'pl42' }));
    expect(await within(dialog).findByText(/Once they have answered, press Refresh/)).toBeInTheDocument();
  });

  it('shows the server’s refusal in the form (e.g. outside the guarantee window)', async () => {
    openPlacement({ 'GET /placements/pl42/worker-left': form(), 'POST /placements/pl42/claims': apiError(400, 'Worker left outside the 60-day replacement guarantee window') });
    await userEvent.click(await screen.findByRole('button', { name: 'Report worker left' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(await within(dialog).findByLabelText(/Date the worker left/), '2026-11-12');
    await userEvent.selectOptions(within(dialog).getByLabelText(/Why the worker left/), 'resigned');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Report worker left' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Worker left outside the 60-day replacement guarantee window');
  });

  it('is not offered on a placement that is not active, not joined, or has a claim waiting', async () => {
    mockApi({ 'GET /ceo/placements/pl42': detail({ status: 'dropped_out' }) });
    signInAs('ceo');
    const { unmount } = renderScreen(<PlacementDetail />, { portal: 'ceo', path: '/ceo/placements/pl42', route: '/ceo/placements/:id', now: NOW });
    expect(await screen.findByText(/PL-00042 · Ravi Kumar at Lakshmi Tiffins/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Report worker left' })).not.toBeInTheDocument();
    unmount();
    mockApi({ 'GET /ceo/placements/pl42': detail({ claim: { code: 'RC-1', reason: 'resigned', workerLeftOn: '2026-11-10', reportedAt: '2026-11-11', reportedWithinDeadline: true, feePaidInFull: true, decision: null, decidedBy: null, decisionReason: null } }) });
    renderScreen(<PlacementDetail />, { portal: 'ceo', path: '/ceo/placements/pl42', route: '/ceo/placements/:id', now: NOW });
    expect(await screen.findByText(/PL-00042 · Ravi Kumar at Lakshmi Tiffins/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Report worker left' })).not.toBeInTheDocument();
  });
});

describe('Report worker left — Manager and Team Lead (find the placement first)', () => {
  const managerCommon = {
    'GET /login-codes/pending': [],
    'GET /review-flags': [],
    'GET /notifications/bell': { openCount: 0, unseenCount: 0, latest: [], doneToday: [], asOf: NOW.toISOString() },
    'GET /requests/waiting': [],
    'GET /requests/open': [],
    'GET /requests/decided': [],
    'GET /manager/staff': { manager: { id: 'm1', code: 'MGR-2', name: 'Priya Sharma' }, rows: [] },
  };

  it('Manager: searches by worker, picks the placement, then sees the form', async () => {
    const api = mockApi({
      ...managerCommon,
      'GET /placements/worker-left/search': [{ id: 'pl42', code: 'PL-00042', workerName: 'Ravi Kumar', businessName: 'Lakshmi Tiffins', joinedDate: '2026-10-20T04:30:00Z' }],
      'GET /placements/pl42/worker-left': form({ blocked: 'open_claim', canReport: false, openClaim: { code: 'RC-00003', reportedAt: '2026-11-13T06:00:00Z', decisionDueAt: '2026-11-15T06:00:00Z' } }),
    });
    signInAs('manager');
    renderScreen(<ManagerRequests />, { portal: 'manager', path: '/manager/requests', now: NOW });
    await userEvent.click(await screen.findByRole('button', { name: 'Report worker left' }));
    const dialog = await screen.findByRole('dialog', { name: 'Report that the worker left' });
    expect(within(dialog).getByText('Type at least 2 letters.')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/Placement ID, worker or business/), 'Ravi');
    await userEvent.click(await within(dialog).findByRole('button', { name: /Ravi Kumar at Lakshmi Tiffins/ }));
    await waitFor(() => expect(api.calls('GET /placements/worker-left/search').at(-1)!.query.get('q')).toBe('Ravi'));
    expect(await screen.findByText(/Claim RC-00003 is already waiting for a decision/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText(/Placement ID, worker or business/)).toBeInTheDocument();
  });

  it('Team Lead: the same finder is on Requests', async () => {
    mockApi({ ...managerCommon, 'GET /team-lead/team': { teamLead: null, manager: null, members: [] }, 'GET /placements/worker-left/search': [] });
    signInAs('team_lead');
    renderScreen(<TeamLeadRequests />, { portal: 'team-lead', path: '/team-lead/requests', now: NOW });
    await userEvent.click(await screen.findByRole('button', { name: 'Report worker left' }));
    await userEvent.type(screen.getByLabelText(/Placement ID, worker or business/), 'PL-9');
    expect(await screen.findByText('No active placement matches “PL-9”.')).toBeInTheDocument();
  });
});

describe('Report worker left — call agent console (search results)', () => {
  const result = (status: string) => ({
    query: 'PL-00042',
    kind: 'id',
    counts: { all: 1, job_seeker: 0, business: 0, referral: 0, vacancy: 0, placement: 1 },
    results: [{ type: 'placement', id: 'pl42', code: 'PL-00042', name: 'Ravi Kumar · Lakshmi Tiffins', maskedPhone: null, status, trade: 'Cook', locality: null, openRef: 'JS-00101', extra: {} }],
  });

  it('an active placement offers it to the call agent, in Kannada too', async () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'kn');
    mockApi({ 'GET /search': result('active'), 'GET /placements/pl42/worker-left': form() });
    signInAs('call_agent');
    renderScreen(<Search />, { portal: 'call-agent', path: '/call-agent/search?q=PL-00042' });
    await userEvent.click(await screen.findByRole('button', { name: 'ಕೆಲಸಗಾರ ಬಿಟ್ಟು ಹೋದರು ಎಂದು ತಿಳಿಸಿ' }));
    expect(await screen.findByRole('dialog', { name: 'Ravi Kumar ಬಿಟ್ಟು ಹೋದರು ಎಂದು ತಿಳಿಸಿ' })).toBeInTheDocument();
    expect(await screen.findByText(/ಮಾಲೀಕರು ಉತ್ತರಿಸಿದ ಕರೆಯಲ್ಲಿ/)).toBeInTheDocument();
  });

  it('is not offered on a placement that is not active, nor to Finance', async () => {
    mockApi({ 'GET /search': result('dropped_out') });
    signInAs('call_agent');
    const { unmount } = renderScreen(<Search />, { portal: 'call-agent', path: '/call-agent/search?q=PL-00042' });
    expect(await screen.findByText('Ravi Kumar · Lakshmi Tiffins')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Report worker left' })).not.toBeInTheDocument();
    unmount();
    mockApi({ 'GET /search': result('active') });
    signInAs('finance');
    renderScreen(<Search />, { portal: 'finance', path: '/finance/search?q=PL-00042' });
    expect(await screen.findByText('Ravi Kumar · Lakshmi Tiffins')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Report worker left' })).not.toBeInTheDocument();
  });
});
