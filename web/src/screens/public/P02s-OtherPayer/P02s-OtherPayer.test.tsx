import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockApi, renderScreen } from '../../../test/utils';
import { QR_SVG } from '../shared/testData';
import OtherPayer from './index';

const now = new Date('2026-11-11T06:00:00Z');
const expiresAt = '2026-11-11T06:14:52Z';
const render = () => renderScreen(<OtherPayer />, { portal: 'public', path: '/p/pay/ptok', route: '/p/pay/:token', now });

describe('P02s-OtherPayer', () => {
  it('works from the SMS: code to the payer, then only first name, ID, amount and the QR', async () => {
    const api = mockApi({
      'GET /registration/payment/ptok/info': { maskedPhone: '******0000', language: null, expiresAt },
      'POST /registration/payment/ptok/send-otp': { requestId: 'preq', phone: '******0000' },
      'POST /registration/payment/ptok/verify-otp': {
        firstName: 'Kavya', displayName: 'Kavya R.', jobSeekerCode: 'JS-1042', amountPaise: 49900, linkExpiresAt: expiresAt, language: null,
        payment: { amountPaise: 49900, payeeName: 'LABOURA PRIVATE LIMITED', upiReference: 'PAY-1042-K7Q2', upiUri: 'upi://pay?am=499.00', qrSvg: QR_SVG },
      },
    });
    render();
    expect(await screen.findByText('This link works for 14:52 more minutes')).toBeInTheDocument();
    expect(screen.queryByText(/Kavya/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send code to ******0000' }));
    await userEvent.click(screen.getAllByRole('textbox')[0]!);
    await userEvent.paste('654321');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(api.calls('POST /registration/payment/ptok/verify-otp')[0]!.body).toEqual({ requestId: 'preq', code: '654321' });
    expect(await screen.findByRole('heading', { name: 'Pay ₹499 for Kavya R.' })).toBeInTheDocument();
    expect(screen.getByText('Laboura registration · JS-1042 · sent by Kavya')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'UPI QR code' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Pay with a UPI app' }));
    expect(screen.getByText('Paid — confirming.')).toBeInTheDocument();
    expect(screen.getByText(/shows only her first name and ID/)).toBeInTheDocument();
  });

  it('says when the 15 minutes are over', async () => {
    mockApi({ 'GET /registration/payment/ptok/info': { maskedPhone: '******0000', language: null, expiresAt: '2026-11-11T05:59:00Z' } });
    render();
    expect(await screen.findByText(/Payment links work for 15 minutes/)).toBeInTheDocument();
  });
});
