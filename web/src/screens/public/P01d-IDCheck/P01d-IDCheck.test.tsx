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
// The live camera is tested in P01c; here "taking the photo" hands back a JPEG.
vi.mock('../shared/LiveSelfie', () => ({
  LiveSelfie: ({ onCapture, takeLabel, facing }: { onCapture: (b: Blob) => Promise<string>; takeLabel?: string; facing?: string }) => (
    <button type="button" data-facing={facing} onClick={() => void onCapture(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' }))}>
      {takeLabel ?? 'Take selfie'}
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
    expect(privacy).toHaveTextContent(/your full Aadhaar number, any picture of your Aadhaar card, the e-Aadhaar PDF or XML, your full address, or the full number of another ID/);
    expect(privacy).toHaveTextContent(/the photo of the card only until a Team Lead checks it/);
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

  it('on a name mismatch offers another ID: the number, then a live photo of the card (back camera), then "sent to a Team Lead"', async () => {
    verifiedInThisTab();
    let pending = false;
    const api = mockApi({
      [`GET /registration/${TOKEN}/status`]: () => atId({ idCheck: { waitingForTeamLead: pending, lastResult: pending ? 'pending' : 'name_mismatch' } }),
      [`POST /registration/${TOKEN}/aadhaar-qr`]: qrAnswer({ status: 'failed', result: 'name_mismatch', nameMatches: false, offerOtherId: true }),
      [`POST /registration/${TOKEN}/other-id`]: () => {
        pending = true;
        return { verificationId: 'v2', method: 'pan', status: 'pending', idNumberLast4: '234F' };
      },
    });
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Aadhaar: scan the QR code' }));
    await userEvent.click(screen.getByRole('button', { name: 'fake camera read' }));
    expect(await screen.findByText(/Team Lead will check it, or you can use another ID now/)).toBeInTheDocument();
    expect(screen.getByTestId('other-id')).toHaveTextContent(/take a photo of the card with your camera and type its number/);
    await userEvent.click(screen.getByRole('button', { name: 'PAN card' }));
    const next = screen.getByRole('button', { name: 'Next: photo of the card' });
    await userEvent.type(screen.getByLabelText(/PAN number/), 'abcde1234');
    expect(next).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/PAN number/), 'f');
    await userEvent.click(next);
    // The card camera: no file input anywhere, the back camera.
    expect(screen.getByTestId('id-card-camera')).toHaveTextContent('PAN card · ABCDE1234F');
    expect(document.querySelector('input[type="file"]')).toBeNull();
    const take = screen.getByRole('button', { name: 'Take photo of the card' });
    expect(take).toHaveAttribute('data-facing', 'environment');
    await userEvent.click(take);
    expect(await screen.findByTestId('id-pending')).toHaveTextContent(/Sent to a Team Lead\..*nothing is charged before the check/);
    const sent = api.fetch.mock.calls.find(([url]) => String(url).endsWith(`/registration/${TOKEN}/other-id`));
    const form = sent![1]!.body as FormData;
    expect(form.get('idType')).toBe('pan');
    expect(form.get('idNumber')).toBe('ABCDE1234F');
    expect(form.get('captureSource')).toBe('live_camera');
    expect(form.get('requestId')).toBe('req-1');
    expect(form.get('photo')).toBeInstanceOf(Blob);
  });

  it('while another ID waits for the Team Lead it says so (no payment), and the Aadhaar QR is still offered', async () => {
    verifiedInThisTab();
    mockApi({ [`GET /registration/${TOKEN}/status`]: atId({ idCheck: { waitingForTeamLead: true, lastResult: 'pending' } }) });
    render();
    expect(await screen.findByTestId('id-pending')).toHaveTextContent(/Open this link again later to pay/);
    expect(screen.getByRole('button', { name: 'Aadhaar: scan the QR code' })).toBeEnabled();
    expect(screen.queryByTestId('navigated-away')).not.toBeInTheDocument();
  });

  it('an Aadhaar newer than our certificate: "please use another ID" (not called fake)', async () => {
    verifiedInThisTab();
    mockApi({
      [`GET /registration/${TOKEN}/status`]: atId(),
      [`POST /registration/${TOKEN}/aadhaar-qr`]: qrAnswer({ status: 'failed', result: 'cert_missing', verifiedByUidai: false, person: null, maskedReference: null, offerOtherId: true }),
    });
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Aadhaar: scan the QR code' }));
    await userEvent.click(screen.getByRole('button', { name: 'fake camera read' }));
    expect(await screen.findByText('This Aadhaar is newer than our check supports. Please use another ID.')).toBeInTheDocument();
    expect(screen.queryByText(/failed UIDAI's signature check/)).not.toBeInTheDocument();
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

  it('has no "busy, SMS me when it\'s back" any more (no outside ID company)', async () => {
    verifiedInThisTab();
    mockApi({ [`GET /registration/${TOKEN}/status`]: atId() });
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Another ID' }));
    expect(screen.queryByText(/busy right now/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /SMS me/ })).not.toBeInTheDocument();
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
