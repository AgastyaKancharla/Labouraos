import { renderReceiptPage } from './receipt-page';

describe('Receipt page opened from the SMS link', () => {
  it('shows "received" only for money the bank confirmed', () => {
    const received = renderReceiptPage({
      paymentCode: 'PAY-00042', amountPaise: 49900, status: 'succeeded', confirmedAt: new Date('2026-11-09T05:50:00Z'), type: 'activation',
    });
    expect(received).toContain('₹499');
    expect(received).toContain('Received by the bank');
    expect(received).toContain('no GST added');
    const pending = renderReceiptPage({ paymentCode: 'PAY-00043', amountPaise: 49900, status: 'pending', confirmedAt: null, type: 'activation' });
    expect(pending).toContain('Not received yet');
    expect(pending).not.toContain('Received by the bank');
  });
});
