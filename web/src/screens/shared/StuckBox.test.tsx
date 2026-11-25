import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi, renderScreen, signInAs } from '../../test/utils';
import { StuckBox } from './StuckBox';

/** "Where they're stuck" (Master Guide rev 204, 21 Nov). */
const view = (over: Record<string, unknown> = {}) => ({
  kind: 'job_seeker', id: 'js-1', code: 'JS-01042', name: 'Kavya Reddy', owner: { name: 'Kiran Kumar', code: 'CA-00007' },
  step: 'consent', state: 'not_started', reason: null, waitingForTeamLead: false, actions: ['registration_link'], ...over,
});

describe('Where they’re stuck', () => {
  it('shows the account owner, the step and the link with "Send on WhatsApp" and a small "Send by SMS" (rev 211)', async () => {
    const user = userEvent.setup();
    const api = mockApi({ 'GET /profile-stuck': view(), 'POST /consent/links': { expiresAt: '2026-11-22T10:00:00Z', sentBy: 'whatsapp' } });
    signInAs('call_agent');
    renderScreen(<StuckBox kind="job_seeker" id="js-1" />, { portal: 'call-agent', path: '/call-agent/people/js-1' });
    expect(await screen.findByTestId('stuck-owner')).toHaveTextContent('Kiran Kumar · CA-00007');
    expect(screen.getByTestId('stuck-step')).toHaveTextContent('Consent · not started');
    expect(api.calls('GET /profile-stuck')[0]!.query.get('kind')).toBe('job_seeker');
    expect(screen.getByText('Resend registration link')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send on WhatsApp' }));
    await waitFor(() => expect(api.calls('POST /consent/links')).toHaveLength(1));
    expect(api.calls('POST /consent/links')[0]!.body).toEqual({ jobSeekerId: 'js-1', channel: 'whatsapp' });
    expect(await screen.findByTestId('send-result')).toHaveTextContent('Sent on WhatsApp.');
    await user.click(screen.getByRole('button', { name: 'Send by SMS' }));
    await waitFor(() => expect(api.calls('POST /consent/links')).toHaveLength(2));
    expect(api.calls('POST /consent/links')[1]!.body).toEqual({ jobSeekerId: 'js-1', channel: 'sms' });
  });

  it('says when WhatsApp could not take it and it went by SMS', async () => {
    const user = userEvent.setup();
    mockApi({ 'GET /profile-stuck': view(), 'POST /consent/links': { expiresAt: '2026-11-22T10:00:00Z', sentBy: 'sms' } });
    signInAs('call_agent');
    renderScreen(<StuckBox kind="job_seeker" id="js-1" />, { portal: 'call-agent', path: '/call-agent/people/js-1' });
    await user.click(await screen.findByRole('button', { name: 'Send on WhatsApp' }));
    expect(await screen.findByTestId('send-result')).toHaveTextContent('WhatsApp could not take it, so it went by SMS.');
  });

  it('Team Lead, Manager and CEO keep the view with no send buttons (the server lists no actions for them)', async () => {
    mockApi({ 'GET /profile-stuck': view({ actions: [] }) });
    signInAs('team_lead');
    renderScreen(<StuckBox kind="job_seeker" id="js-1" />, { portal: 'team-lead', path: '/team-lead/job-seekers/js-1' });
    expect(await screen.findByTestId('stuck-step')).toHaveTextContent('Consent · not started');
    expect(within(screen.getByTestId('stuck-box')).queryByRole('button')).toBeNull();
  });

  it('waiting for the Team Lead’s ID check shows that, with no resend button', async () => {
    mockApi({ 'GET /profile-stuck': view({ step: 'id_check', state: 'in_progress', waitingForTeamLead: true, actions: [], reason: "Waiting for the Team Lead's ID check" }) });
    signInAs('call_agent');
    renderScreen(<StuckBox kind="job_seeker" id="js-1" />, { portal: 'call-agent', path: '/call-agent/people/js-1' });
    expect(await screen.findByTestId('stuck-waiting')).toHaveTextContent('Waiting for the Team Lead’s ID check');
    expect(within(screen.getByTestId('stuck-box')).queryByRole('button')).toBeNull();
  });

  it('a do-not-call or wrong-number block (409) shows the server’s message', async () => {
    const user = userEvent.setup();
    mockApi({
      'GET /profile-stuck': view({ kind: 'business', id: 'b-1', step: 'agreement', actions: ['agreement_link'] }),
      'POST /businesses/b-1/agreement-links': { status: 409, body: { statusCode: 409, message: 'This number is marked wrong number. Nothing is sent to it.' } },
    });
    signInAs('call_agent');
    renderScreen(<StuckBox kind="business" id="b-1" />, { portal: 'call-agent', path: '/call-agent/people/b-1' });
    await user.click(await screen.findByRole('button', { name: 'Send on WhatsApp' }));
    expect(await within(screen.getByTestId('stuck-send-agreement_link')).findByRole('alert')).toHaveTextContent('This number is marked wrong number. Nothing is sent to it.');
  });

  it('at the payment step: send the payment link, or a payment-only link for someone else', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      'GET /profile-stuck': view({ step: 'payment', state: 'in_progress', actions: ['payment_link', 'someone_else_pays'] }),
      'POST /job-seekers/js-1/resend-payment': { paymentId: 'p' },
      'POST /job-seekers/js-1/payment-only-link': { expiresAt: '2026-11-22T10:00:00Z' },
    });
    signInAs('call_agent');
    renderScreen(<StuckBox kind="job_seeker" id="js-1" />, { portal: 'call-agent', path: '/call-agent/people/js-1' });
    await user.click(await within(await screen.findByTestId('stuck-send-payment_link')).findByRole('button', { name: 'Send on WhatsApp' }));
    await waitFor(() => expect(api.calls('POST /job-seekers/js-1/resend-payment')).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'Someone else pays' }));
    await user.type(screen.getByLabelText(/Payer’s mobile/), '9845012345');
    await user.click(within(screen.getByTestId('stuck-send-other-payer')).getByRole('button', { name: 'Send by SMS' }));
    await waitFor(() => expect(api.calls('POST /job-seekers/js-1/payment-only-link')).toHaveLength(1));
    expect(api.calls('POST /job-seekers/js-1/payment-only-link')[0]!.body).toEqual({ phone: '+919845012345', channel: 'sms' });
  });

  it('shows nothing when the record is outside the viewer’s scope (404)', async () => {
    mockApi({ 'GET /profile-stuck': { status: 404, body: { statusCode: 404, message: 'Job seeker not found' } } });
    signInAs('team_lead');
    renderScreen(<StuckBox kind="job_seeker" id="js-9" />, { portal: 'team-lead', path: '/team-lead/job-seekers/js-9' });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('stuck-box')).toBeNull();
  });
});
