import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  jobSeeker: { firstName: 'Kavya', code: 'JS-01042' }, placement: null, receipt: null, invoicePath: null,
  pay: { amountPaise: 49900, payeeName: 'LABOURA PRIVATE LIMITED', upiReference: 'PAY-1042-K7Q2', upiUri: 'upi://pay?am=499.00&tr=PAY-1042-K7Q2', qrSvg: QR_SVG },
};
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
          payment: { state: accepted ? 'pending' : 'not_started', amountPaise: 49900, upiReference: accepted ? 'PAY-1042-K7Q2' : null, confirmedAt: null, guaranteeEndsAt: null, paymentId: null },
        }),
      [`GET /registration/${TOKEN}/terms`]: terms,
      [`POST /registration/${TOKEN}/terms-and-payment`]: () => {
        accepted = true;
        return { payment: { upiReference: 'PAY-1042-K7Q2', amountPaise: 49900 } };
      },
      'GET /payments/request/PAY-1042-K7Q2/summary': summary,
    });
    render();
    expect(await screen.findByRole('heading', { name: 'Pay ₹499 · Registration' })).toBeInTheDocument();
    expect(screen.getByText('Step 4 of 4 · Payment')).toBeInTheDocument();
    expect(screen.getByText('Housekeeping · within 8 km of your area · day shift · at least ₹13,000 a month')).toBeInTheDocument();
    expect(screen.getByText(/Finding a job yourself ends it too/)).toBeInTheDocument();
    const tick = screen.getByRole('checkbox', { name: 'I have read and agree to these terms' });
    expect(tick).not.toBeChecked();
    expect(screen.queryByRole('img', { name: 'UPI QR code' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay with a UPI app' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Someone else will pay/ })).not.toBeInTheDocument();

    await userEvent.click(tick);
    expect(api.calls(`POST /registration/${TOKEN}/terms-and-payment`)[0]!.body).toEqual({ requestId: 'req-1', acceptTerms: true });
    expect(await screen.findByRole('img', { name: 'UPI QR code' })).toBeInTheDocument();
    expect(screen.getByText('To: LABOURA PRIVATE LIMITED · ref PAY-1042-K7Q2')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pay with a UPI app' })).toHaveAttribute('href', summary.pay.upiUri);
    expect(screen.getByText(/A screenshot is not proof of payment/)).toBeInTheDocument();
  });

  it('sends a payment-only link to another number', async () => {
    verifiedInThisTab();
    const api = mockApi({
      [`GET /registration/${TOKEN}/status`]: openStatus({
        currentStep: 'payment', steps, termsAcceptedAt: '2026-11-11T05:00:00Z',
        payment: { state: 'pending', amountPaise: 49900, upiReference: 'PAY-1042-K7Q2', confirmedAt: null, guaranteeEndsAt: null, paymentId: null },
      }),
      [`GET /registration/${TOKEN}/terms`]: terms,
      'GET /payments/request/PAY-1042-K7Q2/summary': summary,
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
