import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { apiError, mockApi, renderScreen } from '../../../test/utils';
import { partnerStatus, partnerVerifiedInThisTab, TOKEN } from '../shared/testData';
import PartnerTermsPage from './index';

const terms = { referralPayoutPaise: 20000, activationFeePaise: 49900, version: 'v1', language: 'en', termsHtml: '<h1>Laboura Referral Partner Terms</h1><p>₹200 when they join.</p>', payoutDetailsCoolingHours: 48 };
const render = () => renderScreen(<PartnerTermsPage />, { portal: 'public', path: `/p/partner/${TOKEN}/terms`, route: '/p/partner/:token/terms' });

describe('P-PartnerTerms (step 1: referral terms and call-recording consent)', () => {
  it('shows the frozen amounts, needs both boxes ticked by the partner, and saves with the code from the first page', async () => {
    partnerVerifiedInThisTab();
    const api = mockApi({
      [`GET /referral-registration/${TOKEN}/status`]: partnerStatus(),
      [`GET /referral-registration/${TOKEN}/terms`]: terms,
      'POST /consent/submit': { success: true },
    });
    render();
    expect(await screen.findByRole('heading', { name: 'Referral partner terms' })).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 4 · Terms')).toBeInTheDocument();
    expect(screen.getByText(/You earn ₹200 when a job seeker you referred joins/)).toBeInTheDocument();
    expect(screen.getByText(/pay their ₹499/)).toBeInTheDocument();
    expect(screen.getByText(/48-hour wait/)).toBeInTheDocument();
    expect(api.calls(`GET /referral-registration/${TOKEN}/terms`)[0]!.query.get('requestId')).toBe('req-1');
    const agree = screen.getByRole('button', { name: 'I agree — continue' });
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    boxes.forEach((b) => expect(b).not.toBeChecked());
    expect(agree).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /referral partner terms/ }));
    expect(agree).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /calls with Laboura are recorded/ }));
    await userEvent.click(agree);
    expect(api.calls('POST /consent/submit')[0]!.body).toEqual({ token: TOKEN, otpRequestId: 'req-1', purposes: ['agreement_terms', 'call_recording'], language: 'en' });
    expect(await screen.findByTestId('navigated-away')).toBeInTheDocument();
  });

  it('without a verified code goes back to the first page', async () => {
    mockApi({ [`GET /referral-registration/${TOKEN}/status`]: { valid: true, otpRequired: true, maskedPhone: '******3210', language: null, registrationComplete: false } });
    render();
    expect(await screen.findByTestId('navigated-away')).toBeInTheDocument();
  });

  it('shows a failed save and lets them try again', async () => {
    partnerVerifiedInThisTab();
    mockApi({
      [`GET /referral-registration/${TOKEN}/status`]: partnerStatus(),
      [`GET /referral-registration/${TOKEN}/terms`]: terms,
      'POST /consent/submit': apiError(500, 'Internal server error'),
    });
    render();
    await userEvent.click(await screen.findByRole('checkbox', { name: /referral partner terms/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /calls with Laboura are recorded/ }));
    await userEvent.click(screen.getByRole('button', { name: 'I agree — continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong on our side');
  });
});
