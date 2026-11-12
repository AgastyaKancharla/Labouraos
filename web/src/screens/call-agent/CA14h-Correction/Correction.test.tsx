import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ATT_NOW, openToday } from '../../../attendance/fixtures';
import { mockApi, renderScreen, signInAs } from '../../../test/utils';
import RequestCorrection from './index';

const path = { portal: 'call-agent' as const, path: '/call-agent/attendance/correction', now: ATT_NOW };
const iso = (hhmm: string) => {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 10, 6, h, m) - 330 * 60_000).toISOString();
};

describe('Request a correction (CA14h)', () => {
  it('picks the day and times, what it should have been and a reason, and sends it', async () => {
    const api = mockApi({
      'GET /attendance/today': openToday(),
      'POST /attendance/corrections': ({ body }: { body: Record<string, string> }) => ({
        kind: 'correction', id: 'c9', status: 'pending', reason: body.reason, where: 'with_team_lead', routeReason: 'team_lead', createdAt: ATT_NOW.toISOString(), decided: null,
        date: body.date, startAt: iso(body.from!), endAt: iso(body.to!), segmentStatus: body.status,
      }),
    });
    signInAs('call_agent');
    renderScreen(<RequestCorrection />, path);
    const should = await screen.findByRole('combobox', { name: /What should it have been\?/ });
    expect(within(should).getAllByRole('option').map((o) => o.textContent)).toEqual(['Available (I was working)', 'Team meeting', 'Training', 'One-to-one with Team Lead']);
    expect(screen.getByLabelText(/^Day/)).toHaveAttribute('max', '2026-11-09');
    expect(screen.getByLabelText(/^From/)).toHaveAttribute('type', 'time');
    expect(screen.getByText('Your Team Lead approves or rejects it with a reason. The change and the reason are kept in the history. You can never edit your own times.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^Day/), { target: { value: '2026-11-06' } });
    fireEvent.change(screen.getByLabelText(/^From/), { target: { value: '09:52' } });
    fireEvent.change(screen.getByLabelText(/^To/), { target: { value: '09:30' } });
    expect(screen.getByText('“To” must be after “From”.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^From/), { target: { value: '09:30' } });
    fireEvent.change(screen.getByLabelText(/^To/), { target: { value: '09:52' } });
    await userEvent.type(screen.getByRole('textbox', { name: /Reason/ }), 'Login page wasn’t loading; Ravi saw it.');
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await waitFor(() => expect(api.calls('POST /attendance/corrections')).toHaveLength(1));
    expect(api.calls('POST /attendance/corrections')[0]!.body).toEqual({ date: '2026-11-06', from: '09:30', to: '09:52', status: 'available', reason: 'Login page wasn’t loading; Ravi saw it.' });
    expect(await screen.findByText('Correction sent · Fri 6 Nov, 9:30–9:52')).toBeInTheDocument();
    expect(screen.getByText(/It is with your Team Lead now\./)).toBeInTheDocument();
  });

  it('sends nothing until every field is filled', async () => {
    const api = mockApi({ 'GET /attendance/today': openToday() });
    signInAs('call_agent');
    renderScreen(<RequestCorrection />, path);
    await userEvent.click(await screen.findByRole('button', { name: 'Send request' }));
    expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(4);
    expect(api.calls('POST /attendance/corrections')).toHaveLength(0);
  });

  it('says when a third correction went to the Manager', async () => {
    mockApi({
      'GET /attendance/today': openToday(),
      'POST /attendance/corrections': { kind: 'correction', id: 'c9', status: 'pending', reason: 'r', where: 'with_manager', routeReason: 'third_correction', createdAt: ATT_NOW.toISOString(), decided: null, date: '2026-11-06', startAt: iso('09:30'), endAt: iso('09:52'), segmentStatus: 'training' },
    });
    signInAs('call_agent');
    renderScreen(<RequestCorrection />, path);
    fireEvent.change(await screen.findByLabelText(/^Day/), { target: { value: '2026-11-06' } });
    fireEvent.change(screen.getByLabelText(/^From/), { target: { value: '09:30' } });
    fireEvent.change(screen.getByLabelText(/^To/), { target: { value: '09:52' } });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /What should it have been\?/ }), 'training');
    await userEvent.type(screen.getByRole('textbox', { name: /Reason/ }), 'r');
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText(/Your third correction this month, so it went to your Manager\./)).toBeInTheDocument();
  });
});
