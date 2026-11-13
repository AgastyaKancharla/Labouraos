import { screen } from '@testing-library/react';
import { mockApi, renderScreen } from '../../../test/utils';
import { DONE, partnerStatus, partnerVerifiedInThisTab, TOKEN } from '../shared/testData';
import PartnerSelfiePage from './index';

const render = () => renderScreen(<PartnerSelfiePage />, { portal: 'public', path: `/p/partner/${TOKEN}/selfie`, route: '/p/partner/:token/selfie' });

describe('P-PartnerSelfie (step 2)', () => {
  it('uses the live front camera only — no file picker — and explains a blocked camera', async () => {
    partnerVerifiedInThisTab();
    mockApi({ [`GET /referral-registration/${TOKEN}/status`]: partnerStatus({ currentStep: 'selfie', steps: { terms: DONE, selfie: { state: 'not_started' }, id: { state: 'not_started' }, upi: { state: 'not_started' } } }) });
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
    const { container } = render();
    expect(await screen.findByRole('heading', { name: 'Take a selfie' })).toBeInTheDocument();
    expect(screen.getByText('Step 2 of 4 · Selfie')).toBeInTheDocument();
    expect(screen.getByText(/partner profile/)).toBeInTheDocument();
    expect(await screen.findByText(/Camera access is blocked/)).toBeInTheDocument();
    expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ video: expect.objectContaining({ facingMode: 'user' }), audio: false }));
    expect(container.querySelector('input[type="file"]')).toBeNull();
  });

  it('sends them on when the selfie is already done', async () => {
    partnerVerifiedInThisTab();
    mockApi({ [`GET /referral-registration/${TOKEN}/status`]: partnerStatus({ currentStep: 'id_check' }) });
    render();
    expect(await screen.findByTestId('navigated-away')).toBeInTheDocument();
  });
});
