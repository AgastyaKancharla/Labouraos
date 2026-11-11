import { screen } from '@testing-library/react';
import { mockApi, renderScreen } from '../../../test/utils';
import { openStatus, TOKEN, verifiedInThisTab } from '../shared/testData';
import Selfie from './index';

const render = () => renderScreen(<Selfie />, { portal: 'public', path: `/p/register/${TOKEN}/selfie`, route: '/p/register/:token/selfie' });

describe('P01c-Selfie', () => {
  it('uses the live camera only — no file picker — and explains a blocked camera', async () => {
    verifiedInThisTab();
    mockApi({ [`GET /registration/${TOKEN}/status`]: openStatus({ currentStep: 'selfie', steps: { consent: true, selfie: false, idCheck: false, payment: false } }) });
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
    const { container } = render();
    expect(await screen.findByRole('heading', { name: 'Take a selfie' })).toBeInTheDocument();
    expect(screen.getByText('Step 2 of 4 · Selfie')).toBeInTheDocument();
    expect(await screen.findByText(/Camera access is blocked/)).toBeInTheDocument();
    expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ video: expect.objectContaining({ facingMode: 'user' }), audio: false }));
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(screen.getByText(/photos from the gallery aren't accepted/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('sends him to the step he is on when the selfie is already done', async () => {
    verifiedInThisTab();
    mockApi({ [`GET /registration/${TOKEN}/status`]: openStatus({ currentStep: 'id_check', steps: { consent: true, selfie: true, idCheck: false, payment: false } }) });
    render();
    expect(await screen.findByTestId('navigated-away')).toBeInTheDocument();
  });
});
