import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi, renderScreen, signInAs } from '../../../test/utils';
import JobSeekerDetail from './index';

/**
 * 17 Nov, item 2: on C-JobSeeker each consent item and each accepted text shows once —
 * "Consent X of Y" with Y every required item he is asked for, each item Given (time) or Not given.
 */
const NOW = new Date('2026-11-17T06:30:00Z');
const detail = {
  id: 'js3', code: 'JS-00301', name: 'Kavya R', phone: '+919845012433', status: 'consented', createdAt: '2026-11-10T05:00:00Z',
  guarantee: { days: 30, paidAt: null, daysLeft: null, floorPaise: 1600000 },
  hits: { count: 0, max: 3 }, offersMade: 0, interviews: 0, activation: null, refunds: [],
  profile: { trades: [{ trade: 'Cook', years: 2, primary: true }], locality: 'JP Nagar', travelDistanceKm: 8, salaryMinPaise: 1600000, salaryMaxPaise: 2000000, salaryPeriod: 'monthly', shiftPreference: 'day', jobType: 'full_time', languages: [], qualification: null, referredBy: null, registeredBy: { id: 's1', name: 'Deepa Nair' }, heardFrom: null },
  registration: { phoneVerified: true, consentsGranted: 4, consentsAsked: 5, consentAt: '2026-11-12T05:12:00Z', selfieAt: null, idCheck: null, paymentAt: null },
  consents: [
    { purpose: 'job_matching', required: true, granted: true, withdrawn: false, at: '2026-11-10T05:12:00Z' },
    { purpose: 'profile_sharing', required: true, granted: true, withdrawn: false, at: '2026-11-10T05:12:00Z' },
    { purpose: 'call_recording', required: true, granted: false, withdrawn: true, at: '2026-11-11T09:00:00Z' },
    { purpose: 'aadhaar_verification', required: true, granted: true, withdrawn: false, at: '2026-11-10T05:12:00Z' },
    { purpose: 'job_updates', required: true, granted: true, withdrawn: false, at: '2026-11-10T05:12:00Z' },
    { purpose: 'promotions', required: false, granted: false, withdrawn: false, at: null },
  ],
  hitList: [], activity: [], placements: [], history: [],
};

describe('C-JobSeeker consent and registration (17 Nov)', () => {
  it('"Consent 4 of 5", each item once with Given (time), Withdrawn (time) or Not given, and one line per accepted text', async () => {
    mockApi({
      'GET /login-codes/pending': [], 'GET /review-flags': [], 'GET /refunds/due': [],
      'GET /ceo/job-seekers/js3': detail,
      'GET /permanent-bans/job_seeker/js3': { banned: false },
      'GET /legal/acceptances/job_seeker/js3': {
        status: { documentKey: 'job_seeker_terms', currentVersion: '1.1', acceptedVersion: '1.1', needsReconsent: false, noticeVersion: '1.2', currentNoticeVersion: '1.2' },
        acceptances: [
          { id: 'a2', documentKey: 'job_seeker_terms', version: '1.1', language: 'en', context: 'payment_terms', method: 'sms_link', otpRequestId: 'o2', noticeVersion: null, purposes: ['guarantee_terms'], acceptedAt: '2026-11-12T06:00:00Z', times: 2, firstAcceptedAt: '2026-11-10T06:00:00Z' },
          { id: 'a1', documentKey: 'job_seeker_terms', version: '1.1', language: 'en', context: 'registration', method: 'sms_link', otpRequestId: 'o1', noticeVersion: '1.2', purposes: [], acceptedAt: '2026-11-10T05:12:00Z', times: 1, firstAcceptedAt: '2026-11-10T05:12:00Z' },
        ],
      },
    });
    signInAs('ceo');
    renderScreen(<JobSeekerDetail />, { portal: 'ceo', path: '/ceo/job-seekers/js3', route: '/ceo/job-seekers/:id', now: NOW });
    expect(await screen.findByText('Consent (4 of 5)')).toBeInTheDocument();
    const items = within(screen.getByRole('list', { name: 'Consent items' })).getAllByRole('listitem');
    expect(items).toHaveLength(6);
    expect(items[0]).toHaveTextContent(/Job matching · Given 10 Nov/);
    expect(items[2]).toHaveTextContent(/Call recording · Withdrawn 11 Nov/);
    expect(items[5]).toHaveTextContent('Promotions (optional) · Not given');
    // Each accepted text once: the repeated payment-step acceptance is one line, with how many times.
    expect(await screen.findAllByText('View signed copy')).toHaveLength(2);
    expect(screen.getByText(/accepted 2 times, first 10 Nov/)).toBeInTheDocument();
  });

  it('rev 211: paid, waiting for ID — the CEO can record "Refund requested (ID not verified)"', async () => {
    const api = mockApi({
      'GET /login-codes/pending': [], 'GET /review-flags': [], 'GET /refunds/due': [],
      'GET /ceo/job-seekers/js3': {
        ...detail,
        status: 'paid_waiting_id',
        guarantee: { days: 30, paidAt: '2026-11-15T05:00:00Z', startsAt: null, paidWaitingForId: true, daysLeft: null, floorPaise: 1600000 },
        activation: { amountPaise: 49900, at: '2026-11-15T05:00:00Z', utr: '431200001111', confirmedBy: 'bank_feed' },
        registration: { ...detail.registration, consentsGranted: 5, selfieAt: '2026-11-14T05:00:00Z', paymentAt: '2026-11-15T05:00:00Z' },
      },
      'GET /permanent-bans/job_seeker/js3': { banned: false },
      'GET /legal/acceptances/job_seeker/js3': { status: { documentKey: 'job_seeker_terms', currentVersion: '1.2', acceptedVersion: '1.2', needsReconsent: false, noticeVersion: '1.3', currentNoticeVersion: '1.3' }, acceptances: [] },
      'POST /job-seekers/js3/refund': { id: 'r1', status: 'approved' },
    });
    signInAs('ceo');
    renderScreen(<JobSeekerDetail />, { portal: 'ceo', path: '/ceo/job-seekers/js3', route: '/ceo/job-seekers/:id', now: NOW });
    expect((await screen.findAllByText('Paid, waiting for ID')).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: 'Refund requested (ID not verified)' }));
    const d = await screen.findByRole('dialog');
    await userEvent.click(within(d).getByRole('button', { name: 'Refund requested by the job seeker (ID not verified)' }));
    await waitFor(() => expect(api.calls('POST /job-seekers/js3/refund')[0]?.body).toEqual({ idNotVerified: true }));
  });
});
