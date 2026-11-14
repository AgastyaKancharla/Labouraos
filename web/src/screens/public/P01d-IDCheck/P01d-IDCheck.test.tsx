import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { apiError, mockApi, renderScreen } from '../../../test/utils';
import { openStatus, TOKEN, verifiedInThisTab } from '../shared/testData';
import IdCheck from './index';

// The camera and the PDF reader are tested on their own (shared/aadhaar); here they hand back a QR text.
const QR_TEXT = '1234567890987654321';
vi.mock('../shared/aadhaar/AadhaarQrScanner', () => ({
  AadhaarQrScanner: ({ onText }: { onText: (t: string) => void }) => (
    <button type="button" onClick={() => onText(QR_TEXT)}>
      fake camera read
    </button>
  ),
}));
vi.mock('../shared/aadhaar/EAadhaarPdf', () => ({
  EAadhaarPdf: ({ onText }: { onText: (t: string) => void }) => (
    <button type="button" onClick={() => onText(QR_TEXT)}>
      fake pdf read
    </button>
  ),
}));

const atId = (extra: Partial<ReturnType<typeof openStatus>> = {}) =>
  openStatus({ currentStep: 'id_check', steps: { consent: true, selfie: true, idCheck: false, payment: false }, ...extra });
const render = () => renderScreen(<IdCheck />, { portal: 'public', path: `/p/register/${TOKEN}/id-check`, route: '/p/register/:token/id-check' });

const qrAnswer = (over: Record<string, unknown> = {}) => ({
  verificationId: 'v1',
  method: 'aadhaar_qr',
  status: 'verified',
  result: 'verified',
  verifiedByUidai: true,
  nameMatches: true,
  isAdult: true,
  phoneLinked: 'linked',
  maskedReference: 'XXXX-XXXX-4321',
  person: { name: 'Kavya Ramesh', dateOfBirth: '1998-08-15', gender: 'F' },
  failureReason: null,
  offerOtherId: false,
  ...over,
});

describe('P01d-IDCheck (Aadhaar Secure QR, guide 14 Nov)', () => {
  it('offers the three choices and says what is read, kept and never kept', async () => {
    verifiedInThisTab();
    mockApi({ [`GET /registration/${TOKEN}/status`]: atId() });
    render();
    expect(await screen.findByRole('button', { name: 'Aadhaar: scan the QR code' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aadhaar: open e-Aadhaar PDF' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Another ID' })).toBeInTheDocument();
    const privacy = screen.getByTestId('id-privacy');
    expect(privacy).toHaveTextContent(/never a picture of the card or your e-Aadhaar PDF/);
    expect(privacy).toHaveTextContent(/name, date of birth, gender, area and pincode/);
    expect(privacy).toHaveTextContent(/your full Aadhaar number, any picture of the card, the e-Aadhaar PDF or XML, or your full address/);
    expect(screen.queryByText(/digi\s?locker/i)).not.toBeInTheDocument();
  });

  it('scans the QR with the camera, sends only its text, shows the green UIDAI result and moves on', async () => {
    verifiedInThisTab();
    const api = mockApi({
      [`GET /registration/${TOKEN}/status`]: atId(),
      [`POST /registration/${TOKEN}/aadhaar-qr`]: qrAnswer(),
    });
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Aadhaar: scan the QR code' }));
    await userEvent.click(screen.getByRole('button', { name: 'fake camera read' }));
    expect(api.calls(`POST /registration/${TOKEN}/aadhaar-qr`)[0]!.body).toEqual({ requestId: 'req-1', qrText: QR_TEXT });
    expect(await screen.findByText('Aadhaar verified by UIDAI')).toBeInTheDocument();
    expect(screen.getByText('Kavya Ramesh')).toBeInTheDocument();
    expect(screen.getByText('15-08-1998')).toBeInTheDocument();
    expect(screen.getByText('Female')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByTestId('navigated-away')).toBeInTheDocument();
  });

  it('reads the e-Aadhaar PDF the same way', async () => {
    verifiedInThisTab();
    const api = mockApi({ [`GET /registration/${TOKEN}/status`]: atId(), [`POST /registration/${TOKEN}/aadhaar-qr`]: qrAnswer() });
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Aadhaar: open e-Aadhaar PDF' }));
    await userEvent.click(screen.getByRole('button', { name: 'fake pdf read' }));
    expect(api.calls(`POST /registration/${TOKEN}/aadhaar-qr`)[0]!.body).toEqual({ requestId: 'req-1', qrText: QR_TEXT });
    expect(await screen.findByText('Aadhaar verified by UIDAI')).toBeInTheDocument();
  });

  it('on a name mismatch offers another government ID (Team Lead review)', async () => {
    verifiedInThisTab();
    const api = mockApi({
      [`GET /registration/${TOKEN}/status`]: atId(),
      [`POST /registration/${TOKEN}/aadhaar-qr`]: qrAnswer({ status: 'failed', result: 'name_mismatch', nameMatches: false, offerOtherId: true }),
      [`POST /registration/${TOKEN}/id-check`]: { status: 'pending', method: 'pan', nameMatches: null, isAdult: null, failureReason: null },
    });
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Aadhaar: scan the QR code' }));
    await userEvent.click(screen.getByRole('button', { name: 'fake camera read' }));
    expect(await screen.findByText(/Team Lead will check it, or you can use another ID now/)).toBeInTheDocument();
    expect(screen.getByTestId('other-id')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'PAN card' }));
    const check = screen.getByRole('button', { name: 'Check this ID' });
    await userEvent.type(screen.getByLabelText(/PAN number/), 'abcde1234');
    expect(check).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/PAN number/), 'f');
    await userEvent.click(check);
    expect(api.calls(`POST /registration/${TOKEN}/id-check`)[0]!.body).toEqual({ requestId: 'req-1', method: 'pan', documentNumber: 'ABCDE1234F' });
  });

  it('an old card without a signed QR: download the free e-Aadhaar or use another ID', async () => {
    verifiedInThisTab();
    mockApi({
      [`GET /registration/${TOKEN}/status`]: atId(),
      [`POST /registration/${TOKEN}/aadhaar-qr`]: qrAnswer({ status: 'failed', result: 'old_qr', verifiedByUidai: false, person: null, maskedReference: null, offerOtherId: true }),
    });
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Aadhaar: scan the QR code' }));
    await userEvent.click(screen.getByRole('button', { name: 'fake camera read' }));
    expect(await screen.findByText(/Download your free e-Aadhaar from UIDAI/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'PAN card' })).toBeInTheDocument();
  });

  it('under 18 from the QR: registration stops before payment', async () => {
    verifiedInThisTab();
    mockApi({
      [`GET /registration/${TOKEN}/status`]: atId(),
      [`POST /registration/${TOKEN}/aadhaar-qr`]: qrAnswer({ status: 'failed', result: 'under_18', isAdult: false }),
    });
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Aadhaar: scan the QR code' }));
    await userEvent.click(screen.getByRole('button', { name: 'fake camera read' }));
    expect(await screen.findByText('Registration stops here.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Aadhaar/ })).not.toBeInTheDocument();
  });

  it('stops before payment for someone under 18', async () => {
    verifiedInThisTab();
    mockApi({ [`GET /registration/${TOKEN}/status`]: atId({ stopped: 'under_18' }) });
    render();
    expect(await screen.findByText('Registration stops here.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Aadhaar/ })).not.toBeInTheDocument();
  });

  it('when the PAN / driving licence / voter ID check is down, the QR still works and he can wait for an SMS', async () => {
    verifiedInThisTab();
    const api = mockApi({
      [`GET /registration/${TOKEN}/status`]: atId({ idCheck: { serviceDown: true, waitingForService: false, lastResult: 'failed' } }),
      [`POST /registration/${TOKEN}/id-check-wait`]: { waitingForRecovery: true },
    });
    render();
    expect(await screen.findByRole('button', { name: 'Aadhaar: scan the QR code' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Another ID' }));
    expect(screen.getByText('PAN, driving licence and voter ID checks are busy right now.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: "I'll wait — SMS me when it's back" }));
    expect(api.calls(`POST /registration/${TOKEN}/id-check-wait`)[0]!.body).toEqual({ requestId: 'req-1' });
    expect(await screen.findByText(/we'll send you an SMS when it's back/)).toBeInTheDocument();
  });

  it('shows a refused check', async () => {
    verifiedInThisTab();
    mockApi({
      [`GET /registration/${TOKEN}/status`]: atId(),
      [`POST /registration/${TOKEN}/aadhaar-qr`]: apiError(429, 'Too many Aadhaar QR tries. Wait an hour and try again, or use another ID.'),
    });
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Aadhaar: scan the QR code' }));
    await userEvent.click(screen.getByRole('button', { name: 'fake camera read' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
