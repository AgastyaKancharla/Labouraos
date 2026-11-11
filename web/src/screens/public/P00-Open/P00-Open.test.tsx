import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { apiError, mockApi, renderScreen } from '../../../test/utils';
import { openStatus, TOKEN, verifiedInThisTab } from '../shared/testData';
import RegistrationOpen from './index';

const locked = { otpRequired: true, maskedPhone: '******2345', language: 'kn', registrationComplete: false };
const render = () => renderScreen(<RegistrationOpen />, { portal: 'public', path: `/p/register/${TOKEN}`, route: '/p/register/:token' });

describe('P00-Open / P02r-Resume', () => {
  it('shows nothing about him before the code, starts in his language, and needs the code typed', async () => {
    const api = mockApi({
      [`GET /registration/${TOKEN}/status`]: locked,
      'POST /consent/send-otp': { requestId: 'req-1', phone: '******2345' },
      [`POST /registration/${TOKEN}/verify-otp`]: openStatus(),
    });
    render();
    expect(await screen.findByRole('heading', { name: 'ನಿಮ್ಮ ನೋಂದಣಿ ಪೂರ್ಣಗೊಳಿಸಿ' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('kn');
    await userEvent.click(screen.getByRole('button', { name: 'EN' }));
    expect(screen.getByText('4. Pay ₹499')).toBeInTheDocument();
    expect(screen.queryByText(/Kavya/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Send code to ******2345' }));
    expect(api.calls('POST /consent/send-otp')[0]!.body).toEqual({ token: TOKEN });
    expect(screen.getByText('Code sent to ******2345')).toBeInTheDocument();
    expect(screen.getByText(/No smartphone\?/)).toBeInTheDocument();
    const continueButton = screen.getByRole('button', { name: 'Continue' });
    expect(continueButton).toBeDisabled();
    expect(screen.getByRole('button', { name: /Send again in/ })).toBeDisabled();

    const boxes = screen.getAllByRole('textbox');
    await userEvent.click(boxes[0]!);
    await userEvent.paste('123456');
    await userEvent.click(continueButton);
    expect(api.calls(`POST /registration/${TOKEN}/verify-otp`)[0]!.body).toEqual({ requestId: 'req-1', code: '123456' });
    expect(await screen.findByTestId('navigated-away')).toBeInTheDocument();
    expect(sessionStorage.getItem(`laboura_reg_otp:${TOKEN}`)).toBe('req-1');
  });

  it('a wrong code says so and keeps him on the page', async () => {
    mockApi({
      [`GET /registration/${TOKEN}/status`]: { ...locked, language: null },
      'POST /consent/send-otp': { requestId: 'req-1', phone: '******2345' },
      [`POST /registration/${TOKEN}/verify-otp`]: apiError(400, 'Wrong or expired code. Check the SMS or ask for a new code.'),
    });
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Send code to ******2345' }));
    await userEvent.click(screen.getAllByRole('textbox')[0]!);
    await userEvent.paste('000000');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That code is wrong or has run out');
  });

  it('opening the link again shows the finished steps and carries on (P02r)', async () => {
    verifiedInThisTab();
    mockApi({
      [`GET /registration/${TOKEN}/status`]: openStatus({
        currentStep: 'payment',
        steps: { consent: true, selfie: true, idCheck: true, payment: false },
        payment: { state: 'failed', amountPaise: 49900, upiReference: null, confirmedAt: null, guaranteeEndsAt: null, paymentId: null },
      }),
    });
    render();
    expect(await screen.findByRole('heading', { name: 'Welcome back, Kavya' })).toBeInTheDocument();
    expect(screen.getByText('You’ve already done 3 of 4 steps. You won’t be asked again.'.replace(/’/g, "'"))).toBeInTheDocument();
    expect(screen.getAllByText('Done')).toHaveLength(3);
    expect(screen.getByText("Last try didn't go through")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));
    expect(await screen.findByTestId('navigated-away')).toBeInTheDocument();
  });

  it('explains an expired link and offers no retry for it', async () => {
    mockApi({ [`GET /registration/${TOKEN}/status`]: apiError(400, 'Public link has expired') });
    render();
    expect(await screen.findByText(/This link has expired/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('offers a retry when the connection fails', async () => {
    mockApi({ [`GET /registration/${TOKEN}/status`]: apiError(500, 'Internal server error') });
    render();
    expect(await screen.findByText(/Something went wrong on our side/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
