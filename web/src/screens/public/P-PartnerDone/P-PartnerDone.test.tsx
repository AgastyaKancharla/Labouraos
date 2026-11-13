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
        language: 'hi',
        currentStep: 'complete',
        steps: { terms: DONE, selfie: DONE, id: DONE, upi: DONE },
        payout: { method: 'upi', maskedValue: 'ram***@okaxis', status: 'verified', nameMatches: true },
      }),
    });
    render();
    expect(await screen.findByText('अब आप Laboura रेफ़रल पार्टनर हैं')).toBeInTheDocument();
    expect(screen.getByText('RF-00031')).toBeInTheDocument();
    expect(screen.getByText('ram***@okaxis')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'रेफ़रल पार्टनर की शर्तें पढ़ें' })).toHaveAttribute('href', '/p/referral-terms?lang=hi');
  });
});
