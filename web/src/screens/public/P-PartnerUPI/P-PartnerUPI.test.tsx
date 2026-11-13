import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockApi, renderScreen } from '../../../test/utils';
import { DONE, partnerStatus, partnerVerifiedInThisTab, TOKEN } from '../shared/testData';
import PartnerUpiPage from './index';

const atUpi = (extra: Parameters<typeof partnerStatus>[0] = {}) =>
  partnerStatus({ currentStep: 'upi', steps: { terms: DONE, selfie: DONE, id: DONE, upi: { state: 'not_started' } }, ...extra });
const render = () => renderScreen(<PartnerUpiPage />, { portal: 'public', path: `/p/partner/${TOKEN}/upi`, route: '/p/partner/:token/upi' });

describe('P-PartnerUPI (step 4)', () => {
  it('takes a UPI ID in their own name and sends it with the code from the first page', async () => {
    partnerVerifiedInThisTab();
    const api = mockApi({
      [`GET /referral-registration/${TOKEN}/status`]: atUpi(),
      [`POST /referral-registration/${TOKEN}/upi`]: { id: 'pa1', maskedValue: 'ram***@okaxis', status: 'pending_validation' },
    });
    render();
    expect(await screen.findByRole('heading', { name: 'Where should we pay you?' })).toBeInTheDocument();
    expect(screen.getByText(/name on your ID/)).toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Save payout details' });
    await userEvent.type(screen.getByLabelText('UPI ID (like name@okaxis)'), 'ramesh');
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText('UPI ID (like name@okaxis)'), '@okaxis');
    await userEvent.click(save);
    expect(api.calls(`POST /referral-registration/${TOKEN}/upi`)[0]!.body).toEqual({ otpRequestId: 'req-1', method: 'upi', upiId: 'ramesh@okaxis' });
    expect(await screen.findByText('Details received.')).toBeInTheDocument();
    expect(screen.getByText('ram***@okaxis')).toBeInTheDocument();
    expect(screen.queryByText('ramesh@okaxis')).not.toBeInTheDocument();
  });

  it('takes a bank account with its IFSC instead', async () => {
    partnerVerifiedInThisTab();
    const api = mockApi({
      [`GET /referral-registration/${TOKEN}/status`]: atUpi(),
      [`POST /referral-registration/${TOKEN}/upi`]: { id: 'pa1', maskedValue: '••••9012', status: 'pending_validation' },
    });
    render();
    await userEvent.click(await screen.findByRole('radio', { name: 'Bank account' }));
    await userEvent.type(screen.getByLabelText('Bank account number'), '123456789012');
    await userEvent.type(screen.getByLabelText(/IFSC/), 'hdfc0001234');
    await userEvent.click(screen.getByRole('button', { name: 'Save payout details' }));
    expect(api.calls(`POST /referral-registration/${TOKEN}/upi`)[0]!.body).toEqual({ otpRequestId: 'req-1', method: 'bank', accountNumber: '123456789012', ifsc: 'HDFC0001234' });
    // Saving finishes the link: the page shows the answer and does not ask for the status again.
    expect(await screen.findByText('••••9012')).toBeInTheDocument();
    expect(api.calls(`GET /referral-registration/${TOKEN}/status`)).toHaveLength(1);
  });

  it('says when the account name does not match the ID', async () => {
    partnerVerifiedInThisTab();
    mockApi({ [`GET /referral-registration/${TOKEN}/status`]: atUpi({ payout: { method: 'bank', maskedValue: '••••9012', status: 'flagged', nameMatches: false } }) });
    render();
    expect(await screen.findByText(/doesn't match the name on your ID/)).toBeInTheDocument();
    expect(screen.getByText('••••9012')).toBeInTheDocument();
  });
});
