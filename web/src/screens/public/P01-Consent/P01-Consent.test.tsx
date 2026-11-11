import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { apiError, mockApi, renderScreen } from '../../../test/utils';
import { openStatus, TOKEN, verifiedInThisTab } from '../shared/testData';
import Consent from './index';

const render = () => renderScreen(<Consent />, { portal: 'public', path: `/p/register/${TOKEN}/consent`, route: '/p/register/:token/consent' });

describe('P01-Consent', () => {
  it('never pre-ticks a box, needs all five required ones, and saves each purpose with the language', async () => {
    verifiedInThisTab();
    const api = mockApi({
      [`GET /registration/${TOKEN}/status`]: openStatus(),
      'POST /consent/submit': { success: true },
    });
    render();
    expect(await screen.findByRole('heading', { name: 'Your permission' })).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 4 · Consent')).toBeInTheDocument();
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(6);
    boxes.forEach((box) => expect(box).not.toBeChecked());
    expect(screen.getByRole('checkbox', { name: /Record calls/ })).toBeInTheDocument();
    const agree = screen.getByRole('button', { name: 'I agree — continue' });
    expect(agree).toBeDisabled();
    for (const name of [/Match me to jobs/, /Share my profile/, /Record calls/, /Check my ID/]) {
      await userEvent.click(screen.getByRole('checkbox', { name }));
    }
    expect(agree).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /Job updates/ }));
    expect(agree).toBeEnabled();
    await userEvent.click(agree);
    expect(api.calls('POST /consent/submit')[0]!.body).toEqual({
      token: TOKEN,
      otpRequestId: 'req-1',
      purposes: ['job_matching', 'profile_sharing', 'call_recording', 'aadhaar_verification', 'job_updates'],
      language: 'en',
    });
    expect(await screen.findByTestId('navigated-away')).toBeInTheDocument();
  });

  it('sends him back to the start for a fresh code when his code has lapsed', async () => {
    verifiedInThisTab();
    mockApi({ [`GET /registration/${TOKEN}/status`]: { otpRequired: true, maskedPhone: '******2345', language: null, registrationComplete: false } });
    render();
    expect(await screen.findByTestId('navigated-away')).toBeInTheDocument();
    expect(sessionStorage.getItem(`laboura_reg_otp:${TOKEN}`)).toBeNull();
  });

  it('shows a failed save', async () => {
    verifiedInThisTab();
    mockApi({
      [`GET /registration/${TOKEN}/status`]: openStatus(),
      'POST /consent/submit': apiError(500, 'Internal server error'),
    });
    render();
    for (const box of await screen.findAllByRole('checkbox')) await userEvent.click(box);
    await userEvent.click(screen.getByRole('button', { name: 'I agree — continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong on our side');
  });
});
