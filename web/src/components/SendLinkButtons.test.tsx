import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { mockApi, renderScreen, signInAs } from '../test/utils';
import { NoWhatsAppToggle } from '../screens/call-agent/_lib/NoWhatsApp';
import { OtpVerification } from './fields/OtpVerification';
import { SendLinkButtons, sentResultKey } from './SendLinkButtons';

/** WhatsApp first, SMS as backup (Master Guide rev 211). */
describe('Send on WhatsApp, with a small Send by SMS', () => {
  it('says which channel actually carried it', () => {
    expect(sentResultKey('whatsapp', { sentBy: 'whatsapp' })).toBe('send.result.whatsapp');
    expect(sentResultKey('whatsapp', { sentBy: 'sms' })).toBe('send.result.smsFallback');
    expect(sentResultKey('sms', { sentBy: 'sms' })).toBe('send.result.sms');
    expect(sentResultKey('whatsapp', { sentBy: null })).toBe('send.result.none');
    expect(sentResultKey('whatsapp', {})).toBe('send.result.whatsapp');
  });

  it('sends WhatsApp first from the primary button and SMS only from the small one', async () => {
    const user = userEvent.setup();
    const run = vi.fn(async (channel: string) => ({ sentBy: channel }));
    signInAs('call_agent');
    renderScreen(<SendLinkButtons label="Resend registration link" run={run} />, { portal: 'call-agent', path: '/call-agent' });
    expect(screen.getByText('Resend registration link')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send on WhatsApp' }));
    expect(await screen.findByTestId('send-result')).toHaveTextContent('Sent on WhatsApp.');
    await user.click(screen.getByRole('button', { name: 'Send by SMS' }));
    await waitFor(() => expect(run).toHaveBeenLastCalledWith('sms'));
    expect(await screen.findByText('Sent by SMS.')).toBeInTheDocument();
  });

  it('staff code screens offer "Send by SMS" with Resend after 30 seconds, on the same request', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn(async () => ({ requestId: 'wa_otp_1', resendAvailableAt: new Date(Date.now() - 1000).toISOString(), resendsLeft: 3 }));
    signInAs('call_agent');
    renderScreen(<OtpVerification mobile="9876543210" onSend={onSend} onVerify={vi.fn()} onVerified={vi.fn()} />, { portal: 'call-agent', path: '/call-agent' });
    await user.click(screen.getByRole('button', { name: 'Send OTP' }));
    await user.click(await screen.findByRole('button', { name: 'Send by SMS' }));
    await waitFor(() => expect(onSend).toHaveBeenLastCalledWith('9876543210', 'wa_otp_1', 'sms'));
    expect(await screen.findByText(/A new code was sent by SMS/)).toBeInTheDocument();
  });
});

describe('No WhatsApp on the call agent profile (rev 211)', () => {
  it('shows whether messages go on WhatsApp first and lets the agent mark the number', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      'GET /no-whatsapp': { noWhatsApp: false, source: null, since: null },
      'PUT /no-whatsapp': { noWhatsApp: true, source: 'staff', since: '2026-11-25T05:00:00Z' },
    });
    signInAs('call_agent');
    renderScreen(<NoWhatsAppToggle kind="job_seeker" id="js-1" />, { portal: 'call-agent', path: '/call-agent/people/js-1' });
    expect(await screen.findByTestId('no-whatsapp-state')).toHaveTextContent('Messages go on WhatsApp first, with SMS as backup.');
    expect(api.calls('GET /no-whatsapp')[0]!.query.get('kind')).toBe('job_seeker');
    await user.click(screen.getByRole('button', { name: 'Mark "No WhatsApp"' }));
    await waitFor(() => expect(api.calls('PUT /no-whatsapp')[0]!.body).toEqual({ kind: 'job_seeker', id: 'js-1', noWhatsApp: true }));
    expect(await screen.findByText('No WhatsApp: messages go straight by SMS.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'They have WhatsApp' })).toBeInTheDocument();
  });
});
