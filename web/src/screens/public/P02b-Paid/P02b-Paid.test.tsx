import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockApi, renderScreen } from '../../../test/utils';
import { openStatus, TOKEN, verifiedInThisTab } from '../shared/testData';
import Paid from './index';

const steps = { consent: true, selfie: true, idCheck: true, payment: false };
const render = () => renderScreen(<Paid />, { portal: 'public', path: `/p/register/${TOKEN}/paid`, route: '/p/register/:token/paid' });

describe('P02b-Paid', () => {
  it('says "Paid — confirming" until the bank confirms; a screenshot is never proof; the UPI reference is only a hint', async () => {
    verifiedInThisTab();
    const api = mockApi({
      [`GET /registration/${TOKEN}/status`]: openStatus({
        currentStep: 'payment', steps,
        payment: { state: 'pending', amountPaise: 49900, upiReference: 'PAY-1-ab', confirmedAt: null, guaranteeEndsAt: null, paymentId: null },
      }),
      'POST /payments/request/PAY-1-ab/utr-hint': { saved: true },
    });
    render();
    expect(await screen.findByText('Paid — confirming.')).toBeInTheDocument();
    expect(screen.queryByText(/Registration complete/)).not.toBeInTheDocument();
    expect(screen.getByText(/A screenshot is never proof/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/12-digit UPI reference/), '123456789012');
    await userEvent.click(screen.getByRole('button', { name: 'Send reference number' }));
    expect(api.calls('POST /payments/request/PAY-1-ab/utr-hint')[0]!.body).toEqual({ utr: '123456789012' });
    expect(await screen.findByText(/We'll match it when the money reaches our bank/)).toBeInTheDocument();
    expect(screen.queryByText(/Registration complete/)).not.toBeInTheDocument();
  });

  it('once the bank confirms, shows the time, the end of the 30 days and the receipt', async () => {
    verifiedInThisTab();
    mockApi({
      [`GET /registration/${TOKEN}/status`]: openStatus({
        currentStep: 'complete', steps: { ...steps, payment: true }, receiptToken: 'rt',
        payment: { state: 'confirmed', amountPaise: 49900, upiReference: null, confirmedAt: '2026-11-09T05:50:00Z', guaranteeEndsAt: '2026-12-09T05:50:00Z', paymentId: 'pay-1' },
      }),
    });
    render();
    expect(await screen.findByText('Registration complete · ₹499 received')).toBeInTheDocument();
    expect(screen.getByText('9 Nov, 11:20 am')).toBeInTheDocument();
    expect(screen.getByText('9 Dec')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View receipt' })).toHaveAttribute('href', '/payments/pay-1/receipt?token=rt');
  });
});
