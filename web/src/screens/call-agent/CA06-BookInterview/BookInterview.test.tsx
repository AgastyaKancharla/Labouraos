import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi, renderScreen, signInAs } from '../../../test/utils';
import { jobs, NOW, seekerProfile } from '../_lib/fixtures';
import OfferSent from '../CA06b-OfferSent/index';
import BookInterview from './index';

describe('Book an interview (CA06)', () => {
  it('shows why the job suits him, the slots and the message, and sends the offer', async () => {
    const api = mockApi({
      'GET /call-work/people/JS-00198': seekerProfile(),
      'GET /call-work/people/JS-00198/jobs': jobs,
      'POST /interviews': { id: 'i9', replyDueAt: '2026-11-13T04:45:00Z' },
    });
    signInAs('call_agent');
    renderScreen(<BookInterview />, { portal: 'call-agent', path: '/call-agent/interviews/book?person=JS-00198&vacancy=v1', now: NOW });
    expect(await screen.findByText('Electrician · a hotel · HSR Layout')).toBeInTheDocument();
    expect(screen.getByText('3 of 8 km')).toBeInTheDocument();
    expect(screen.getByLabelText(/12 Nov · walk-in 10:30 AM – 6 PM · 4 places left/)).toBeChecked();
    expect(screen.getByLabelText(/13 Nov/)).toBeDisabled();
    expect(screen.getByText(/Laboura: Job offer for you — Electrician, HSR Layout/)).toBeInTheDocument();
    expect(api.calls('GET /call-work/people/JS-00198/jobs')[0]!.query.get('vacancy')).toBe('v1');
    await userEvent.click(screen.getByRole('button', { name: 'Send the offer' }));
    await waitFor(() => expect(api.calls('POST /interviews')).toHaveLength(1));
    expect(api.calls('POST /interviews')[0]!.body).toEqual({ vacancyId: 'v1', jobSeekerId: 'js1', slotId: 's1' });
  });
});

describe('Offer sent (CA06b)', () => {
  it('confirms the offer and lists what happens next', async () => {
    mockApi({ 'GET /call-work/people/JS-00198': seekerProfile() });
    signInAs('call_agent');
    renderScreen(<OfferSent />, { portal: 'call-agent', path: '/call-agent/interviews/sent?person=JS-00198&due=2026-11-13T04:45:00Z', now: NOW });
    expect(await screen.findByText(/Offer sent to Ramesh by SMS and WhatsApp · reply due 13 Nov, 10:15 AM/)).toBeInTheDocument();
    expect(screen.getByText('Owner records the result by OTP')).toBeInTheDocument();
  });
});
