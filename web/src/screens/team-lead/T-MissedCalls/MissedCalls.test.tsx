import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi, renderScreen, signInAs } from '../../../test/utils';
import TeamLeadMissedCalls from './index';

const NOW = new Date('2026-11-11T06:30:00Z');
const path = { portal: 'team-lead' as const, path: '/team-lead/missed-calls', now: NOW };

const data = {
  now: NOW.toISOString(),
  targetMinutes: 30,
  rows: [
    { id: 'cb1', ids: ['cb1', 'cb2'], count: 2, firstCalledAt: '2026-11-11T05:30:00Z', lastCalledAt: '2026-11-11T05:50:00Z', maskedPhone: '******1234', caller: null, holder: null, assignedAt: null, assignmentReason: null, waitingMinutes: 60 },
    { id: 'cb3', ids: ['cb3'], count: 1, firstCalledAt: '2026-11-11T06:20:00Z', lastCalledAt: '2026-11-11T06:20:00Z', maskedPhone: '******5678', caller: { type: 'job_seeker', id: 'js1', code: 'JS-00012', name: 'Ramesh Gowda' }, holder: { id: 'ca-1', code: 'CA-0001', name: 'Kavya' }, assignedAt: '2026-11-11T06:21:00Z', assignmentReason: 'own_agent', waitingMinutes: 10 },
  ],
  agents: [
    { id: 'ca-1', code: 'CA-0001', name: 'Kavya', role: 'call_agent', openItems: 4, onShift: true },
    { id: 'ca-2', code: 'CA-0002', name: 'Arun', role: 'call_agent', openItems: 1, onShift: false },
  ],
};

describe('Team Lead missed calls (T-MissedCalls, 21 Nov fixes)', () => {
  it('lists the team’s and nobody’s missed calls, grouped by number, with how long each waited, and gives one to an agent', async () => {
    const api = mockApi({ 'GET /telephony/missed-calls': data, 'POST /telephony/callbacks/cb1/assign': { ok: true } });
    signInAs('team_lead');
    renderScreen(<TeamLeadMissedCalls />, path);
    expect(await screen.findByText('2 calls from this number')).toBeInTheDocument();
    expect(screen.getAllByText('New caller').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1 h').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Ramesh Gowda · JS-00012/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('their own person').length).toBeGreaterThan(0);
    const select = screen.getAllByRole('combobox', { name: /Give the missed call from \*\*\*\*\*\*1234 to/ })[0]!;
    expect(within(select).getByRole('option', { name: 'Arun · 1 open · not on shift' })).toBeInTheDocument();
    await userEvent.selectOptions(select, 'ca-2');
    await userEvent.click(screen.getAllByRole('button', { name: 'Give' })[0]!);
    await waitFor(() => expect(api.calls('POST /telephony/callbacks/cb1/assign')[0]?.body).toEqual({ staffId: 'ca-2' }));
  });
});
