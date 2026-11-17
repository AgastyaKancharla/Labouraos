import { screen } from '@testing-library/react';
import { mockApi, renderScreen } from '../../../test/utils';
import { DONE, partnerStatus, partnerVerifiedInThisTab, TOKEN } from '../shared/testData';
import PartnerDonePage from './index';

const render = () => renderScreen(<PartnerDonePage />, { portal: 'public', path: `/p/partner/${TOKEN}/done`, route: '/p/partner/:token/done' });

describe('P-PartnerDone', () => {
  it('shows the RF- ID and where payouts go, masked', async () => {
    partnerVerifiedInThisTab();
    mockApi({
      [`GET /referral-registration/${TOKEN}/status`]: partnerStatus({
        currentStep: 'complete',
        steps: { terms: DONE, selfie: DONE, id: DONE, upi: DONE },
        payout: { method: 'upi', maskedValue: 'ram***@okaxis', status: 'verified', nameMatches: true },
      }),
    });
    render();
    expect(await screen.findByText("You're a Laboura referral partner")).toBeInTheDocument();
    expect(screen.getByText('RF-00031')).toBeInTheDocument();
    expect(screen.getByText('ram***@okaxis')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /referral partner terms/i })).toHaveAttribute('href', '/p/referral-terms');
  });
});
