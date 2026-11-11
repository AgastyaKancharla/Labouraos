import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiError, mockApi, renderScreen, signInAs } from '../../../test/utils';
import RegistrationProgress from './index';
import type { JobSeekerStatus } from '../_registration/api';

const NOW = new Date('2026-11-11T05:30:00Z');
const step = (state: string, time: string | null = null, reason: string | null = null) => ({ state, time, reason });
const base: JobSeekerStatus = {
  id: 'js-uuid',
  code: 'JS-01042',
  name: 'Kavya Reddy',
  age: 28,
  gender: 'female',
  phone: '******2345',
  phoneVerifiedAt: '2026-11-11T05:01:00Z',
  messageLanguage: 'kn',
  locality: 'BTM Layout 2nd Stage',
  travelDistanceKm: 8,
  shiftPreference: 'day',
  salaryPeriod: 'monthly',
  minSalary: 1300000,
  maxSalary: 1600000,
  trades: [
    { trade: 'Housekeeping', yearsExperience: 3, isPrimary: true, listed: true },
    { trade: 'Laundry / ironing', yearsExperience: 2, isPrimary: false, listed: false },
  ],
  status: 'lead',
  stage: 'registered',
  nextStep: 'consent',
  steps: { phone: step('done', '2026-11-11T05:01:00Z'), consent: step('not_started'), selfie: step('not_started'), idCheck: step('not_started'), payment: step('not_started') },
  consent: { requiredGiven: 0, requiredTotal: 5, promotions: false },
  registrationLinkExpiresAt: null,
  paymentOnlyLink: null,
  paymentConfirmedAt: null,
  paymentReceivedAt: null,
  guaranteeEndsAt: null,
} as JobSeekerStatus;

const render = () =>
  renderScreen(<RegistrationProgress />, {
    portal: 'call-agent',
    path: '/call-agent/register/job-seeker/js-uuid',
    route: '/call-agent/register/job-seeker/:id',
    now: NOW,
  });

describe('Registration step panel (CA08b / CA08c / CA08f)', () => {
  it('shows a just-saved job seeker with nothing sent and sends the one registration link', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      'GET /screens/call-registration/job-seekers/js-uuid': base,
      'POST /consent/links': { success: true, expiresAt: '2026-11-13T05:35:00Z' },
    });
    signInAs('call_agent');
    render();
    expect(await screen.findByText(/Job seeker details saved · Kavya Reddy · JS-01042/)).toBeInTheDocument();
    expect(screen.getByText('Kavya Reddy · 28 · Female')).toBeInTheDocument();
    expect(screen.getByText(/Laundry \/ ironing 2 yrs \(new trade\)/)).toBeInTheDocument();
    expect(screen.getAllByText('Not sent yet')).toHaveLength(4);
    expect(screen.queryByRole('link', { name: 'Send payment link to another number' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send registration link' }));
    await waitFor(() => expect(api.calls('POST /consent/links')[0]?.body).toEqual({ jobSeekerId: 'js-uuid' }));
    expect(await screen.findByText(/Registration link sent by SMS to \*\*\*\*\*\*2345/)).toBeInTheDocument();
  });

  it('shows live ticks, a stuck payment with its reason, and the someone-else-pays link', async () => {
    mockApi({
      'GET /screens/call-registration/job-seekers/js-uuid': {
        ...base,
        stage: 'in_progress',
        nextStep: 'payment',
        registrationLinkExpiresAt: '2026-11-13T05:05:00Z',
        consent: { requiredGiven: 5, requiredTotal: 5, promotions: false },
        steps: {
          ...base.steps,
          consent: step('done', '2026-11-11T05:12:00Z'),
          selfie: step('done', '2026-11-11T05:14:00Z'),
          idCheck: step('done', '2026-11-11T05:16:00Z'),
          payment: step('stuck', null, 'UPI failed twice (bank declined)'),
        },
      },
    });
    signInAs('call_agent');
    render();
    expect(await screen.findByText(/All 5 required given · offers and news: no · 10:42/i)).toBeInTheDocument();
    expect(screen.getByText('Stuck: UPI failed twice (bank declined)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resend link — continues from ₹499 payment' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Send payment link to another number' })).toHaveAttribute('href', '/call-agent/register/job-seeker/js-uuid/other-payer');
    expect(screen.getByRole('link', { name: 'View signed consent' })).toHaveAttribute('href', '/call-agent/register/job-seeker/js-uuid/consent');
  });

  it('says "Paid — confirming" until the bank matches the ₹499', async () => {
    mockApi({
      'GET /screens/call-registration/job-seekers/js-uuid': {
        ...base,
        stage: 'in_progress',
        nextStep: 'payment',
        steps: { ...base.steps, consent: step('done'), selfie: step('done'), idCheck: step('done'), payment: step('confirming') },
      },
    });
    signInAs('call_agent');
    render();
    expect(await screen.findByText(/Paid — confirming with the bank/)).toBeInTheDocument();
  });

  it('shows the active state with the 30-day end date', async () => {
    mockApi({
      'GET /screens/call-registration/job-seekers/js-uuid': {
        ...base,
        stage: 'active',
        nextStep: 'complete',
        status: 'active',
        steps: { phone: step('done'), consent: step('done'), selfie: step('done'), idCheck: step('done'), payment: step('done', '2026-11-11T05:50:00Z') },
        paymentConfirmedAt: '2026-11-11T05:50:00Z',
        paymentOnlyLink: { payerPhone: '******1207', relation: 'brother', sentAt: '2026-11-11T05:40:00Z', expiresAt: '2026-11-11T05:55:00Z', live: false, used: true },
        guaranteeEndsAt: '2026-12-11T05:50:00Z',
      },
    });
    signInAs('call_agent');
    render();
    expect(await screen.findByText(/Registration complete · Kavya Reddy is active/)).toBeInTheDocument();
    expect(screen.getByText(/Payment link sent to brother \(\*\*\*\*\*\*1207\) · confirmed by the bank 11:20/)).toBeInTheDocument();
    expect(screen.getByText(/30 days run to 11 Dec 2026/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Home' })).toBeInTheDocument();
  });

  it('shows the error with a retry', async () => {
    mockApi({ 'GET /screens/call-registration/job-seekers/js-uuid': apiError(500, 'Internal server error', 'req-9') });
    signInAs('call_agent');
    render();
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
