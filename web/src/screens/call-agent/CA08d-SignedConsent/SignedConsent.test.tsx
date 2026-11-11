import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi, renderScreen, signInAs } from '../../../test/utils';
import SignedConsentCopy from './index';

const purpose = (p: string, given: boolean) => ({ purpose: p, required: p !== 'promotions', given, grantedAt: given ? '2026-11-09T05:12:00Z' : null, withdrawnAt: null });

describe('Signed consent copy (CA08d)', () => {
  it('lists each purpose given or not, with OTP, language, notice version and the explaining call', async () => {
    mockApi({
      'GET /screens/call-registration/job-seekers/js-uuid/signed-consent': {
        jobSeekerId: 'js-uuid', code: 'JS-01042', name: 'Kavya Reddy', signed: true,
        purposes: [purpose('job_matching', true), purpose('profile_sharing', true), purpose('call_recording', true), purpose('aadhaar_verification', true), purpose('job_updates', true), purpose('promotions', false)],
        givenAt: '2026-11-09T05:12:00Z', otpPhone: '******2345', otpVerifiedAt: '2026-11-09T05:11:00Z', language: 'kn', noticeVersion: 'v3',
        explainedOnCall: { staffName: 'Deepa Nair', at: '2026-11-09T04:59:00Z', recorded: true },
      },
    });
    signInAs('call_agent');
    renderScreen(<SignedConsentCopy />, { portal: 'call-agent', path: '/call-agent/register/job-seeker/js-uuid/consent', route: '/call-agent/register/job-seeker/:id/consent' });
    expect(await screen.findByRole('heading', { name: 'Signed consent · Kavya Reddy' })).toBeInTheDocument();
    expect(screen.getAllByText('Given')).toHaveLength(5);
    expect(screen.getByText('Not given')).toBeInTheDocument();
    expect(screen.getByText('******2345 · 10:41')).toBeInTheDocument();
    expect(screen.getByText('Kannada')).toBeInTheDocument();
    expect(screen.getByText('v3')).toBeInTheDocument();
    expect(screen.getByText('Recorded call with Deepa Nair, 10:29')).toBeInTheDocument();
    expect(screen.getByText(/Read-only. Nobody can change it./)).toBeInTheDocument();
  });

  it('says when nothing is signed yet', async () => {
    mockApi({ 'GET /screens/call-registration/job-seekers/js-uuid/signed-consent': { jobSeekerId: 'js-uuid', code: 'JS-01042', name: 'Kavya Reddy', signed: false } });
    signInAs('call_agent');
    renderScreen(<SignedConsentCopy />, { portal: 'call-agent', path: '/call-agent/register/job-seeker/js-uuid/consent', route: '/call-agent/register/job-seeker/:id/consent' });
    expect(await screen.findByText('Not signed yet')).toBeInTheDocument();
  });
});
