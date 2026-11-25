import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach } from 'vitest';
import { mockApi, renderScreen } from '../../../test/utils';
import { openStatus, QR_SVG, TOKEN, verifiedInThisTab } from '../shared/testData';
import Payment from './index';

const steps = { consent: true, selfie: true, idCheck: true, payment: false };
const terms = {
  jobSeekerCode: 'JS-01042', trade: 'Housekeeping', travelDistanceKm: 8, shiftPreference: 'day',
  guaranteeFloorPaise: 1300000, guaranteeDays: 30, amountPaise: 49900, termsAcceptedAt: null,
};
const summary = {
  type: 'activation', state: 'pending', amountPaise: 49900, upiReference: 'PAY-1042-K7Q2', confirmedAt: null, language: null,
  jobSeeker: { firstName: 'Kavya', code: 'JS-01042' }, placement: null,
  pay: { amountPaise: 49900, payeeName: 'LABOURA PRIVATE LIMITED', upiReference: 'PAY-1042-K7Q2', upiUri: 'upi://pay?am=499.00&tr=PAY-1042-K7Q2', qrSvg: QR_SVG },
};
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
const realUa = navigator.userAgent;
const setUa = (ua: string) => Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
afterEach(() => setUa(realUa));
const render = () => renderScreen(<Payment />, { portal: 'public', path: `/p/register/${TOKEN}/payment`, route: '/p/register/:token/payment' });

describe('P02-Payment', () => {
  it('shows his exact terms, needs the tick before any QR, then gives a QR and UPI link for the exact amount', async () => {
    verifiedInThisTab();
    let accepted = false;
    const api = mockApi({
      [`GET /registration/${TOKEN}/status`]: () =>
        openStatus({
          currentStep: 'payment', steps,
          termsAcceptedAt: accepted ? '2026-11-11T05:00:00Z' : null,
          // INF-1: the pay page is opened by its own token, not the UPI reference.
          payPageToken: accepted ? 'PPT-1042' : null,
          payment: { state: accepted ? 'pending' : 'not_started', amountPaise: 49900, upiReference: accepted ? 'PAY-1042-K7Q2' : null, confirmedAt: null, guaranteeEndsAt: null, paymentId: null },
        }),
      [`GET /registration/${TOKEN}/terms`]: terms,
      [`POST /registration/${TOKEN}/terms-and-payment`]: () => {
        accepted = true;
        return { payment: { upiReference: 'PAY-1042-K7Q2', amountPaise: 49900 } };
      },
      'GET /payments/request/PPT-1042/summary': summary,
    });
    render();
    expect(await screen.findByRole('heading', { name: 'Pay ₹499 · Registration' })).toBeInTheDocument();
    expect(screen.getByText('Step 3 of 4 · Payment')).toBeInTheDocument();
    expect(screen.getByText('Housekeeping · within 8 km of your area · day shift · at least ₹13,000 a month')).toBeInTheDocument();
    expect(screen.getByText(/Finding a job yourself ends it too/)).toBeInTheDocument();
    const tick = screen.getByRole('checkbox', { name: 'I have read and agree to these terms' });
    expect(tick).not.toBeChecked();
    expect(screen.queryByRole('img', { name: 'UPI QR code' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay with a UPI app' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Someone else will pay/ })).not.toBeInTheDocument();

    await userEvent.click(tick);
    expect(api.calls(`POST /registration/${TOKEN}/terms-and-payment`)[0]!.body).toEqual({ requestId: 'req-1', acceptTerms: true, language: 'en' });
    expect(await screen.findByRole('img', { name: 'UPI QR code' })).toBeInTheDocument();
    expect(screen.getByText('To: LABOURA PRIVATE LIMITED · ref PAY-1042-K7Q2')).toBeInTheDocument();
    // On a laptop (the test browser): the QR and a short note, no app buttons (21 Nov).
    expect(screen.getByText(/Scan the QR code with any UPI app on your phone/)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Or pay with' })).not.toBeInTheDocument();
    expect(screen.getByText(/A screenshot is not proof of payment/)).toBeInTheDocument();
  });

  it('21 Nov: on a phone, "Or pay with" PhonePe, Google Pay, Paytm, BHIM and other UPI apps — same payee, amount and reference as the QR', async () => {
    setUa(ANDROID);
    verifiedInThisTab();
    const upiUri = 'upi://pay?pa=laboura%40icici&pn=Laboura+Staffing&am=499.00&tn=PAY-01042&tr=PAY-1042-K7Q2&cu=INR';
    mockApi({
      [`GET /registration/${TOKEN}/status`]: openStatus({
        currentStep: 'payment', steps, termsAcceptedAt: '2026-11-11T05:00:00Z', payPageToken: 'PPT-1042',
        payment: { state: 'pending', amountPaise: 49900, upiReference: 'PAY-1042-K7Q2', confirmedAt: null, guaranteeEndsAt: null, paymentId: null },
      }),
      [`GET /registration/${TOKEN}/terms`]: { ...terms, termsAcceptedAt: '2026-11-11T05:00:00Z' },
      'GET /payments/request/PPT-1042/summary': { ...summary, pay: { ...summary.pay, upiUri, extraMethods: [], confirmsAutomatically: false } },
    });
    render();
    expect(await screen.findByRole('img', { name: 'UPI QR code' })).toBeInTheDocument();
    const group = screen.getByRole('group', { name: 'Or pay with' });
    expect(group).toBeInTheDocument();
    const names = ['PhonePe', 'Google Pay', 'Paytm', 'BHIM', 'Other UPI app'];
    for (const name of names) {
      const href = screen.getByRole('link', { name }).getAttribute('href')!;
      for (const part of ['pa=laboura%40icici', 'am=499.00', 'tr=PAY-1042-K7Q2', 'cu=INR']) expect([name, href.includes(part)]).toEqual([name, true]);
    }
    expect(screen.getByRole('link', { name: 'PhonePe' }).getAttribute('href')).toMatch(/^intent:\/\/pay\?.*#Intent;scheme=upi;package=com\.phonepe\.app;/);
    expect(screen.getByRole('link', { name: 'Other UPI app' })).toHaveAttribute('href', upiUri.replace('upi://pay?', 'upi://pay?'));
    // No card or netbanking without a bank API.
    expect(screen.queryByRole('link', { name: /card|netbanking/i })).not.toBeInTheDocument();
  });

  it('rev 181 (H2): while his details are checked there is no QR or pay button, only a neutral "being checked"', async () => {
    verifiedInThisTab();
    mockApi({
      [`GET /registration/${TOKEN}/status`]: openStatus({
        currentStep: 'payment', steps, termsAcceptedAt: '2026-11-11T05:00:00Z', payPageToken: 'PPT-1042',
        payment: { state: 'pending', amountPaise: 49900, upiReference: 'PAY-1042-K7Q2', confirmedAt: null, guaranteeEndsAt: null, paymentId: null },
      }),
      [`GET /registration/${TOKEN}/terms`]: { ...terms, termsAcceptedAt: '2026-11-11T05:00:00Z' },
      'GET /payments/request/PPT-1042/summary': { ...summary, pay: null, underReview: true },
    });
    render();
    expect(await screen.findByText('Your details are being checked by our team. We will call you soon.')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'UPI QR code' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Or pay with' })).not.toBeInTheDocument();
    expect(screen.queryByText(/ban/i)).not.toBeInTheDocument();
  });

  it('sends a payment-only link to another number', async () => {
    verifiedInThisTab();
    const api = mockApi({
      [`GET /registration/${TOKEN}/status`]: openStatus({
        currentStep: 'payment', steps, termsAcceptedAt: '2026-11-11T05:00:00Z', payPageToken: 'PPT-1042',
        payment: { state: 'pending', amountPaise: 49900, upiReference: 'PAY-1042-K7Q2', confirmedAt: null, guaranteeEndsAt: null, paymentId: null },
      }),
      [`GET /registration/${TOKEN}/terms`]: terms,
      'GET /payments/request/PPT-1042/summary': summary,
      [`POST /registration/${TOKEN}/payment-only-link`]: { expiresAt: '2026-11-11T06:15:00Z' },
    });
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Someone else will pay — send them this' }));
    await userEvent.type(screen.getByRole('textbox', { name: /Their mobile number/ }), '9811100000');
    await userEvent.click(screen.getByRole('button', { name: 'Send payment link' }));
    expect(api.calls(`POST /registration/${TOKEN}/payment-only-link`)[0]!.body).toEqual({ requestId: 'req-1', phone: '+919811100000' });
    expect(await screen.findByText(/works for 15 minutes/)).toBeInTheDocument();
  });

  it('waits when his new trade has no salary floor yet', async () => {
    verifiedInThisTab();
    mockApi({ [`GET /registration/${TOKEN}/status`]: openStatus({ currentStep: 'payment', steps, waitingForTrade: true }) });
    render();
    expect(await screen.findByText(/adding your trade to our list/)).toBeInTheDocument();
  });
});
