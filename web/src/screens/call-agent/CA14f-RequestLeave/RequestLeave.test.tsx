import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ATT_NOW, balanceFixture, openToday } from '../../../attendance/fixtures';
import { apiError, mockApi, renderScreen, signInAs } from '../../../test/utils';
import RequestLeave from './index';

const path = { portal: 'call-agent' as const, path: '/call-agent/attendance/leave', now: ATT_NOW };

describe('Request leave (CA14f)', () => {
  it('asks for type, dates from a calendar and a reason, then sends it and says where it went', async () => {
    const api = mockApi({
      'GET /attendance/today': openToday(),
      'GET /attendance/leave/balance': balanceFixture,
      'POST /attendance/leave': ({ body }: { body: Record<string, string> }) => ({
        kind: 'leave', id: 'l9', status: 'pending', reason: body.reason, where: 'with_team_lead', routeReason: 'team_lead', createdAt: ATT_NOW.toISOString(), decided: null,
        leaveKind: body.kind, fromDate: body.fromDate, toDate: body.toDate, days: 1,
      }),
    });
    signInAs('call_agent');
    renderScreen(<RequestLeave />, path);
    expect(await screen.findByRole('option', { name: 'Emergency leave (2 left)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Casual leave (1 left)' })).toBeInTheDocument();
    expect(screen.getByText(/Goes to your Team Lead to approve or reject, with a reason\. Your Manager can see it\. You get an SMS with the answer\. Days beyond your leave balance count as unpaid leave\./)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(api.calls('POST /attendance/leave')).toHaveLength(0);
    expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(3);

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /Type/ }), 'emergency');
    fireEvent.change(screen.getByLabelText(/^From/), { target: { value: '2026-11-13' } });
    await userEvent.type(screen.getByRole('textbox', { name: /Reason/ }), 'Family function in my village');
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await waitFor(() => expect(api.calls('POST /attendance/leave')).toHaveLength(1));
    expect(api.calls('POST /attendance/leave')[0]!.body).toEqual({ kind: 'emergency', fromDate: '2026-11-13', toDate: '2026-11-13', reason: 'Family function in my village' });
    expect(await screen.findByText('Leave request sent · Fri 13 Nov · 1 days')).toBeInTheDocument();
    expect(screen.getByText(/It is with your Team Lead now\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to my attendance' })).toHaveAttribute('href', '/call-agent/attendance/history');
  });

  it('asks for a half day — first or second half of one date — as the design shows', async () => {
    const api = mockApi({
      'GET /attendance/today': openToday(),
      'GET /attendance/leave/balance': balanceFixture,
      'POST /attendance/leave': ({ body }: { body: Record<string, string> }) => ({
        kind: 'leave', id: 'l10', status: 'pending', reason: body.reason, where: 'with_team_lead', routeReason: 'team_lead', createdAt: ATT_NOW.toISOString(), decided: null,
        leaveKind: body.kind, fromDate: body.fromDate, toDate: body.toDate, half: body.half, days: 0.5,
      }),
    });
    signInAs('call_agent');
    renderScreen(<RequestLeave />, path);
    const group = await screen.findByRole('group', { name: 'Half day?' });
    expect(screen.getByRole('radio', { name: 'Full day' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'First half' })).toBeInTheDocument();
    expect(group).toContainElement(screen.getByRole('radio', { name: 'Second half' }));

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /Type/ }), 'casual');
    fireEvent.change(screen.getByLabelText(/^From/), { target: { value: '2026-11-13' } });
    fireEvent.change(screen.getByLabelText(/^To/), { target: { value: '2026-11-16' } });
    await userEvent.click(screen.getByRole('radio', { name: 'Second half' }));
    // A half day is one date: "To" follows "From" and is locked.
    expect(screen.getByLabelText(/^To/)).toBeDisabled();
    expect(screen.getByLabelText(/^To/)).toHaveValue('2026-11-13');
    expect(screen.getByText(/A half day is for one date and uses half a day of your leave/)).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: /Reason/ }), 'Bank work');
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await waitFor(() => expect(api.calls('POST /attendance/leave')).toHaveLength(1));
    expect(api.calls('POST /attendance/leave')[0]!.body).toEqual({ kind: 'casual', fromDate: '2026-11-13', toDate: '2026-11-13', reason: 'Bank work', half: 'second' });
    expect(await screen.findByText('Leave request sent · Fri 13 Nov · half day (Second half)')).toBeInTheDocument();
  });

  it('says in the person’s language when the date already has leave (Hindi)', async () => {
    mockApi({
      'GET /attendance/today': openToday(),
      'GET /attendance/leave/balance': balanceFixture,
      'POST /attendance/leave': { status: 400, body: { statusCode: 400, message: 'You already have leave asked for or approved on 2026-11-13.', details: { code: 'leave_overlap', date: '2026-11-13' } } },
    });
    signInAs('call_agent');
    localStorage.setItem('laboura_lang', 'hi');
    try {
      renderScreen(<RequestLeave />, path);
      await screen.findByRole('radio', { name: 'पूरा दिन' });
      await userEvent.selectOptions(document.querySelector('form select') as HTMLSelectElement, 'casual');
      fireEvent.change(document.querySelector('form input[type="date"]')!, { target: { value: '2026-11-13' } });
      await userEvent.type(document.querySelector('form textarea') as HTMLTextAreaElement, 'Shaadi');
      await userEvent.click(screen.getByRole('button', { name: 'अनुरोध भेजें' }));
      expect(await screen.findByText(/के लिए आप पहले ही छुट्टी माँग चुके हैं/)).toBeInTheDocument();
    } finally {
      localStorage.removeItem('laboura_lang');
    }
  });

  it('refuses a “To” before “From”', async () => {
    const api = mockApi({ 'GET /attendance/today': openToday(), 'GET /attendance/leave/balance': balanceFixture });
    signInAs('call_agent');
    renderScreen(<RequestLeave />, path);
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: /Type/ }), 'casual');
    fireEvent.change(screen.getByLabelText(/^From/), { target: { value: '2026-11-13' } });
    fireEvent.change(screen.getByLabelText(/^To/), { target: { value: '2026-11-12' } });
    expect(screen.getByText('“To” can’t be before “From”.')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: /Reason/ }), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(api.calls('POST /attendance/leave')).toHaveLength(0);
  });

  it('shows the server’s refusal', async () => {
    mockApi({ 'GET /attendance/today': openToday(), 'GET /attendance/leave/balance': balanceFixture, 'POST /attendance/leave': apiError(400, 'These dates overlap a request you already made') });
    signInAs('call_agent');
    renderScreen(<RequestLeave />, path);
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: /Type/ }), 'casual');
    fireEvent.change(screen.getByLabelText(/^From/), { target: { value: '2026-11-13' } });
    await userEvent.type(screen.getByRole('textbox', { name: /Reason/ }), 'Wedding');
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText('These dates overlap a request you already made')).toBeInTheDocument();
  });

  it('a Team Lead’s own leave goes up their line', async () => {
    mockApi({
      'GET /attendance/today': openToday(),
      'GET /attendance/leave/balance': balanceFixture,
      'GET /notifications/bell': { openCount: 0, unseenCount: 0, latest: [], doneToday: [], asOf: ATT_NOW.toISOString() },
      'POST /attendance/leave': { kind: 'leave', id: 'l9', status: 'pending', reason: 'r', where: 'with_manager', routeReason: 'team_lead_own', createdAt: ATT_NOW.toISOString(), decided: null, leaveKind: 'casual', fromDate: '2026-11-13', toDate: '2026-11-14', days: 2 },
    });
    signInAs('team_lead');
    renderScreen(<RequestLeave />, { portal: 'team-lead', path: '/team-lead/my-attendance/leave', now: ATT_NOW });
    expect(await screen.findByText(/Goes to the person you report to/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /Type/ }), 'casual');
    fireEvent.change(screen.getByLabelText(/^From/), { target: { value: '2026-11-13' } });
    fireEvent.change(screen.getByLabelText(/^To/), { target: { value: '2026-11-14' } });
    await userEvent.type(screen.getByRole('textbox', { name: /Reason/ }), 'r');
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText('Leave request sent · Fri 13 Nov – Sat 14 Nov · 2 days')).toBeInTheDocument();
    expect(screen.getByText(/It is with the person you report to now\./)).toBeInTheDocument();
  });
});
