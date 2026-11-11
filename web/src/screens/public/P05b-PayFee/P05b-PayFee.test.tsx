import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { apiError, mockApi, renderScreen } from '../../../test/utils';
import { QR_SVG } from '../shared/testData';
import PayFee from './index';

const pending = {
  type: 'placement_fee', state: 'pending', amountPaise: 944000, upiReference: 'PAY-9-ab', confirmedAt: null, language: null, jobSeeker: null,
  placement: {
    candidateFirstName: 'Ramesh', businessName: 'Sri Sai Hotel', agreedSalaryPaise: 1600000, feePercent: 50, placementFeePaise: 800000,
    gstPercent: 18, gstPaise: 144000, paymentDueAt: '2026-11-12T09:30:00Z',
  },
  pay: { amountPaise: 944000, payeeName: 'LABOURA PRIVATE LIMITED', upiReference: 'PAY-9-ab', upiUri: 'upi://pay?am=9440.00', qrSvg: QR_SVG },
  receipt: null, invoicePath: null,
};
const render = () => renderScreen(<PayFee />, { portal: 'public', path: '/p/fee/PAY-9-ab', route: '/p/fee/:token' });

describe('P05b-PayFee', () => {
  it('shows the 50% fee, 18% GST, total and deadline, and a UPI link for the exact amount', async () => {
    mockApi({ 'GET /payments/request/PAY-9-ab/summary': pending });
    render();
    expect(await screen.findByText('Thank you — Ramesh selected')).toBeInTheDocument();
    expect(screen.getByText('Fee (50% of ₹16,000)')).toBeInTheDocument();
    expect(screen.getByText('₹8,000')).toBeInTheDocument();
    expect(screen.getByText('GST 18%')).toBeInTheDocument();
    expect(screen.getByText('₹1,440')).toBeInTheDocument();
    expect(screen.getByText('₹9,440')).toBeInTheDocument();
    expect(screen.getByText(/Thu,? 12 Nov, 3:00 PM/)).toBeInTheDocument();
    const pay = screen.getByRole('link', { name: 'Pay ₹9,440 by UPI' });
    expect(pay).toHaveAttribute('href', 'upi://pay?am=9440.00');
    await userEvent.click(pay);
    expect(screen.getByText('Paid — confirming.')).toBeInTheDocument();
    expect(screen.queryByText(/Payment received/)).not.toBeInTheDocument();
  });

  it('shows "received" with the invoice only after the bank confirms', async () => {
    mockApi({
      'GET /payments/request/PAY-9-ab/summary': {
        ...pending, state: 'received', confirmedAt: '2026-11-11T08:00:00Z', pay: null,
        receipt: { paymentId: 'p', token: 't' }, invoicePath: '/placements/pl/invoice/copy?token=x',
      },
    });
    render();
    expect(await screen.findByText('Payment received · ₹9,440')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View invoice' })).toHaveAttribute('href', '/placements/pl/invoice/copy?token=x');
  });

  it('also serves the ₹499 registration payment link with its QR', async () => {
    mockApi({
      'GET /payments/request/PAY-9-ab/summary': {
        ...pending, type: 'activation', amountPaise: 49900, placement: null, jobSeeker: { firstName: 'Kavya', code: 'JS-1042' },
        pay: { ...pending.pay, amountPaise: 49900 },
      },
    });
    render();
    expect(await screen.findByRole('heading', { name: 'Pay ₹499 · Registration' })).toBeInTheDocument();
    expect(screen.getByText('Laboura registration for Kavya · JS-1042')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'UPI QR code' })).toBeInTheDocument();
  });

  it('explains an unknown reference', async () => {
    mockApi({ 'GET /payments/request/PAY-9-ab/summary': apiError(404, 'Payment request not found') });
    render();
    expect(await screen.findByText(/This link isn't valid/)).toBeInTheDocument();
  });
});
