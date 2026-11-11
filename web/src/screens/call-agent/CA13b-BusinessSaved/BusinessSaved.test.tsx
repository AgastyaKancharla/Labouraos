import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi, renderScreen, signInAs } from '../../../test/utils';
import BusinessSaved from './index';

const status = {
  id: 'biz-1', code: 'BZ-00318', name: 'Annapoorna Mess', contactName: 'Shankar Rao', contactRole: 'owner', contactLanguage: 'kn', phone: '******4321',
  verificationStatus: 'lead', paused: false,
  steps: {
    phone: { state: 'done', time: '2026-11-11T05:35:00Z' },
    agreement: { state: 'in_progress', time: '2026-11-11T05:38:00Z' },
    visit: { state: 'in_progress', suggestedStaffName: 'Kiran Kumar', assignedStaffName: null },
    teamLeadApproval: { state: 'not_started' },
    verified: { state: 'not_started' },
  },
  draftVacancies: [
    { id: 'v1', code: 'VC-00001', trade: 'Cook', headcount: 2, salaryMinPaise: 1600000, salaryMaxPaise: 2000000, salaryPeriod: 'monthly', startDate: '2026-11-16T00:00:00.000Z', status: 'draft' },
  ],
};

describe('Business saved (CA13b)', () => {
  it('shows what is left before candidates can be shown, the drafts, and resends the agreement', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      'GET /screens/call-registration/businesses/biz-1': status,
      'POST /businesses/biz-1/agreement-links': { success: true },
    });
    signInAs('call_agent');
    renderScreen(<BusinessSaved />, { portal: 'call-agent', path: '/call-agent/register/business/saved?id=biz-1&sent=1' });
    expect(await screen.findByText(/Business saved · Annapoorna Mess · BZ-00318 · agreement link sent to Shankar Rao/)).toBeInTheDocument();
    expect(screen.getByText('Shankar Rao (owner) · ******4321 · 11:05')).toBeInTheDocument();
    expect(screen.getByText(/waiting for Shankar to agree by OTP/)).toBeInTheDocument();
    expect(screen.getByText('Suggested: Kiran Kumar · Team Lead confirms')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Cook × 2 · ₹16,000–20,000 · from 16 Nov/ })).toHaveAttribute('href', '/call-agent/vacancies/new?draft=v1');
    await user.click(screen.getByRole('button', { name: 'Resend agreement link' }));
    await waitFor(() => expect(api.calls('POST /businesses/biz-1/agreement-links')[0]?.body).toEqual({ language: 'kn' }));
  });
});
