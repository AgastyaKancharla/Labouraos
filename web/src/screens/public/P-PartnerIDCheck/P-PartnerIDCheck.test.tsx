import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { mockApi, renderScreen } from '../../../test/utils';
import { DONE, partnerStatus, partnerVerifiedInThisTab, TOKEN } from '../shared/testData';
import PartnerIdCheckPage from './index';

const QR_TEXT = '5550001112223334445';
vi.mock('../shared/aadhaar/AadhaarQrScanner', () => ({
  AadhaarQrScanner: ({ onText }: { onText: (t: string) => void }) => (
    <button type="button" onClick={() => onText(QR_TEXT)}>
      fake camera read
    </button>
  ),
}));

const atId = (extra: Parameters<typeof partnerStatus>[0] = {}) =>
  partnerStatus({ currentStep: 'id_check', steps: { terms: DONE, selfie: DONE, id: { state: 'not_started' }, upi: { state: 'not_started' } }, ...extra });
const render = () => renderScreen(<PartnerIdCheckPage />, { portal: 'public', path: `/p/partner/${TOKEN}/id-check`, route: '/p/partner/:token/id-check' });
const qrAnswer = (over: Record<string, unknown> = {}) => ({
  verificationId: 'v1', method: 'aadhaar_qr', status: 'verified', result: 'verified', verifiedByUidai: true, nameMatches: true, isAdult: true,
  phoneLinked: 'linked', maskedReference: 'XXXX-XXXX-1234', person: { name: 'Ravi Kumar', dateOfBirth: '1990', gender: 'M' },
  failureReason: null, offerOtherId: false, nextStep: 'upi', ...over,
});

describe('P-PartnerIDCheck (step 3, the same Aadhaar QR step)', () => {
  it('scans the Aadhaar QR (only its text is sent) and moves on when verified', async () => {
    partnerVerifiedInThisTab();
    const api = mockApi({
      [`GET /referral-registration/${TOKEN}/status`]: atId(),
      [`POST /referral-registration/${TOKEN}/aadhaar-qr`]: qrAnswer(),
    });
    render();
    expect(await screen.findByText('Step 3 of 4 · ID check')).toBeInTheDocument();
    expect(screen.getByTestId('id-privacy')).toHaveTextContent(/your full Aadhaar number/);
    await userEvent.click(screen.getByRole('button', { name: 'Aadhaar: scan the QR code' }));
    await userEvent.click(screen.getByRole('button', { name: 'fake camera read' }));
    expect(api.calls(`POST /referral-registration/${TOKEN}/aadhaar-qr`)[0]!.body).toEqual({ requestId: 'req-1', qrText: QR_TEXT });
    expect(await screen.findByText('Aadhaar verified by UIDAI')).toBeInTheDocument();
    expect(screen.getByText('1990')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByTestId('navigated-away')).toBeInTheDocument();
  });

  it('on a name mismatch offers another government ID with its number', async () => {
    partnerVerifiedInThisTab();
    const api = mockApi({
      [`GET /referral-registration/${TOKEN}/status`]: atId(),
      [`POST /referral-registration/${TOKEN}/aadhaar-qr`]: qrAnswer({ status: 'failed', result: 'name_mismatch', nameMatches: false, offerOtherId: true, nextStep: 'id_check' }),
      [`POST /referral-registration/${TOKEN}/id-check`]: { status: 'verified', method: 'voter_id', nameMatches: true, isAdult: true, failureReason: null, nextStep: 'upi' },
    });
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Aadhaar: scan the QR code' }));
    await userEvent.click(screen.getByRole('button', { name: 'fake camera read' }));
    expect(await screen.findByText(/doesn't match the name you registered with/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Voter ID' }));
    await userEvent.type(screen.getByLabelText(/Voter ID number/), 'abc1234567');
    await userEvent.click(screen.getByRole('button', { name: 'Check this ID' }));
    expect(api.calls(`POST /referral-registration/${TOKEN}/id-check`)[0]!.body).toEqual({ requestId: 'req-1', method: 'voter_id', documentNumber: 'ABC1234567' });
    expect(await screen.findByTestId('navigated-away')).toBeInTheDocument();
  });

  it('stops under 18', async () => {
    partnerVerifiedInThisTab();
    mockApi({ [`GET /referral-registration/${TOKEN}/status`]: atId({ stopped: 'under_18', idCheck: { serviceDown: false, lastResult: 'under_18' } }) });
    render();
    expect(await screen.findByText(/only register referral partners who are 18 or older/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Aadhaar/ })).not.toBeInTheDocument();
  });

  it('when the other-ID check is down the Aadhaar QR still works', async () => {
    partnerVerifiedInThisTab();
    mockApi({ [`GET /referral-registration/${TOKEN}/status`]: atId({ idCheck: { serviceDown: true, lastResult: 'none' } }) });
    render();
    expect(await screen.findByRole('button', { name: 'Aadhaar: scan the QR code' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Another ID' }));
    expect(screen.getByText(/PAN, driving licence and voter ID checks are busy right now/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'PAN card' })).toBeInTheDocument();
  });
});
