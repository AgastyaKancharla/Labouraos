import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi, renderScreen, signInAs } from '../../../test/utils';
import { NOW, seekerProfile } from '../_lib/fixtures';
import UnknownCaller from '../CA17b-UnknownCaller/index';
import IncomingCall from './index';

describe('Incoming call (CA17)', () => {
  it('shows who is calling before hello, and Answer closes the callback and opens the profile', async () => {
    const api = mockApi({
      'GET /call-work/incoming/t1': {
        callbackTaskId: 't1',
        status: 'assigned',
        ringingSince: '2026-11-11T05:59:50Z',
        maskedPhone: '******4412',
        known: true,
        caller: { type: 'job_seeker', id: 'js1', code: 'JS-00198', name: 'Ramesh Gowda' },
        standing: { status: 'active', guaranteeDay: 27, guaranteeDays: 30, hasOffer: false, trade: 'Electrician' },
        likelyAbout: 'job_search_refund',
        lastContact: { at: '2026-11-11T04:42:00Z', by: 'you', outcome: 'interested', note: 'free from Monday' },
      },
      'GET /call-work/people/JS-00198': seekerProfile(),
      'POST /telephony/callbacks/t1/complete': { ok: true },
    });
    signInAs('call_agent');
    renderScreen(<IncomingCall />, { portal: 'call-agent', path: '/call-agent/incoming?task=t1', now: NOW });
    expect(await screen.findByText('☎ Incoming call · ringing from ******4412')).toBeInTheDocument();
    expect(screen.getByText('Active · Day 27 of 30 · no offer yet')).toBeInTheDocument();
    expect(screen.getByText('Today 10:12 AM · you · “free from Monday”')).toBeInTheDocument();
    expect(screen.getByText('His job search / refund')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Answer' }));
    await waitFor(() => expect(api.calls('POST /telephony/callbacks/t1/complete')).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId('navigated-away')).toBeInTheDocument());
  });
});

describe('Unknown caller (CA17b)', () => {
  it('offers the right registration with the call attached', async () => {
    mockApi({
      'GET /call-work/incoming/t2': { callbackTaskId: 't2', status: 'assigned', ringingSince: '2026-11-11T05:59:40Z', maskedPhone: '******4418', known: false, caller: null },
    });
    signInAs('call_agent');
    renderScreen(<UnknownCaller />, { portal: 'call-agent', path: '/call-agent/incoming/unknown?task=t2', now: NOW });
    expect(await screen.findByText(/on call 00:20 from \*\*\*\*\*\*4418/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Looking for work → job seeker' })).toHaveAttribute('href', '/call-agent/register/job-seeker?incomingCall=t2');
    expect(screen.getByRole('link', { name: 'Needs staff → business' })).toHaveAttribute('href', '/call-agent/register/business?incomingCall=t2');
  });
});
