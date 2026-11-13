import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { apiError, mockApi, renderScreen } from '../../../test/utils';
import { DONE, partnerStatus, partnerVerifiedInThisTab, TOKEN } from '../shared/testData';
import PartnerOpenPage from './index';

const locked = { valid: true, otpRequired: true, maskedPhone: '******3210', language: 'kn', registrationComplete: false };
const render = () => renderScreen(<PartnerOpenPage />, { portal: 'public', path: `/p/partner/${TOKEN}`, route: '/p/partner/:token' });

describe('P-PartnerOpen (referral partner link, mirrors P00 / P02r)', () => {
  it('shows nothing about the partner before the code, starts in their language, then goes to the terms', async () => {
    const api = mockApi({
      [`GET /referral-registration/${TOKEN}/status`]: locked,
      'POST /consent/send-otp': { requestId: 'req-1', phone: '******3210' },
      [`POST /referral-registration/${TOKEN}/verify-otp`]: partnerStatus(),
    });
    render();
    expect(await screen.findByRole('heading', { name: 'Laboura ರೆಫರಲ್ ಪಾಲುದಾರರಾಗಿ' })).toBeInTheDocument();
    await waitFor(() => expect(document.documentElement.lang).toBe('kn'));
    await userEvent.click(screen.getByRole('button', { name: 'हिंदी' }));
    expect(screen.getByRole('heading', { name: 'Laboura रेफ़रल पार्टनर बनें' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'EN' }));
    expect(screen.getByText('4. UPI for your payouts')).toBeInTheDocument();
    expect(screen.queryByText(/Ramesh/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Send code to ******3210' }));
    expect(api.calls('POST /consent/send-otp')[0]!.body).toEqual({ token: TOKEN });
    await userEvent.click(screen.getAllByRole('textbox')[0]!);
    await userEvent.paste('123456');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(api.calls(`POST /referral-registration/${TOKEN}/verify-otp`)[0]!.body).toEqual({ requestId: 'req-1', code: '123456' });
    expect(await screen.findByTestId('navigated-away')).toBeInTheDocument();
    expect(sessionStorage.getItem(`laboura_partner_otp:${TOKEN}`)).toBe('req-1');
  });

  it('a wrong code says so and keeps them on the page', async () => {
    mockApi({
      [`GET /referral-registration/${TOKEN}/status`]: { ...locked, language: null },
      'POST /consent/send-otp': { requestId: 'req-1', phone: '******3210' },
      [`POST /referral-registration/${TOKEN}/verify-otp`]: apiError(400, 'Wrong or expired code. Check the SMS or ask for a new code.'),
    });
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Send code to ******3210' }));
    await userEvent.click(screen.getAllByRole('textbox')[0]!);
    await userEvent.paste('000000');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That code is wrong or has run out');
  });

  it('opening the link again shows the finished steps and carries on from the first unfinished one', async () => {
    partnerVerifiedInThisTab();
    mockApi({
      [`GET /referral-registration/${TOKEN}/status`]: partnerStatus({ currentStep: 'id_check', steps: { terms: DONE, selfie: DONE, id: { state: 'not_started' }, upi: { state: 'not_started' } } }),
    });
    render();
    expect(await screen.findByRole('heading', { name: 'Welcome back, Ramesh K.' })).toBeInTheDocument();
    expect(screen.getByText("You've already done 2 of 4 steps. You won't be asked again.")).toBeInTheDocument();
    expect(screen.getByText('Your partner ID: RF-00031')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Continue to the ID check' }));
    expect(await screen.findByTestId('navigated-away')).toBeInTheDocument();
  });

  it('says when the registration is already complete, still behind the code', async () => {
    mockApi({ [`GET /referral-registration/${TOKEN}/status`]: { ...locked, language: 'en', registrationComplete: true } });
    render();
    expect(await screen.findByText(/already complete/)).toBeInTheDocument();
  });

  it('opening the link after the payout details were saved says the registration is complete', async () => {
    mockApi({ [`GET /referral-registration/${TOKEN}/status`]: apiError(400, 'Public link has already been used') });
    render();
    expect(await screen.findByText(/registration on this link is complete/)).toBeInTheDocument();
  });

  it('explains a link that has expired', async () => {
    mockApi({ [`GET /referral-registration/${TOKEN}/status`]: apiError(400, 'Public link has expired') });
    render();
    expect(await screen.findByText(/This link has expired/)).toBeInTheDocument();
  });
});
