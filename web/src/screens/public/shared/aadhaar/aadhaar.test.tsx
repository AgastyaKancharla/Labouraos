import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { AppProviders } from '../../../../App';
import { AadhaarQrScanner } from './AadhaarQrScanner';
import { EAadhaarPdf } from './EAadhaarPdf';

/**
 * The live scanner and the e-Aadhaar PDF reader, with the QR decoder (and
 * pdf.js) replaced: what matters here is that only the QR's text leaves the
 * component, that nothing is uploaded, and that the camera is released.
 */
const QR_TEXT = '2374971804270526477833002468783965837992554564899874087591661303561346432389832';

function fakeCamera() {
  const stop = vi.fn();
  const track = { stop, applyConstraints: vi.fn(async () => undefined) };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  const getUserMedia = vi.fn(async () => stream);
  vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia } });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 1920 });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 1080 });
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ({ drawImage, getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(4), width: w, height: h }) }) as unknown as CanvasRenderingContext2D,
  );
  return { getUserMedia, stop, drawImage };
}

describe('AadhaarQrScanner (live camera, decoded in the browser)', () => {
  it('opens the back camera, reads frames until a QR is found, hands over only its text and stops the camera', async () => {
    const camera = fakeCamera();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const decode = vi.fn().mockResolvedValueOnce(null).mockResolvedValue(QR_TEXT);
    const onText = vi.fn();
    render(
      <AppProviders>
        <AadhaarQrScanner onText={onText} onCancel={() => undefined} decode={decode} />
      </AppProviders>,
    );
    await waitFor(() => expect(camera.getUserMedia).toHaveBeenCalled());
    const constraints = (camera.getUserMedia.mock.calls[0] as unknown as [MediaStreamConstraints])[0];
    expect(constraints).toMatchObject({ audio: false, video: { facingMode: { ideal: 'environment' } } });
    await waitFor(() => expect(onText).toHaveBeenCalledWith(QR_TEXT), { timeout: 3000 });
    expect(onText).toHaveBeenCalledTimes(1);
    // The middle square of the 1920×1080 frame, at full resolution.
    expect(decode.mock.calls[0]![0]).toMatchObject({ width: 1080, height: 1080 });
    expect(camera.stop).toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/no photo is taken or sent/)).toBeInTheDocument();
  });

  it('"Zoom in" reads a smaller middle part, with tips for light and framing', async () => {
    fakeCamera();
    const decode = vi.fn().mockResolvedValue(null);
    render(
      <AppProviders>
        <AadhaarQrScanner onText={() => undefined} onCancel={() => undefined} decode={decode} />
      </AppProviders>,
    );
    expect(screen.getByText('Good light, and no shine on the card.')).toBeInTheDocument();
    expect(screen.getByText('Bring the phone close so the QR code fills the square.')).toBeInTheDocument();
    const zoom = await screen.findByRole('button', { name: 'Zoom in' });
    await waitFor(() => expect(zoom).toBeEnabled());
    await userEvent.click(zoom);
    expect(screen.getByRole('button', { name: 'Zoom out' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(decode.mock.calls.some(([img]) => (img as ImageData).width === 648)).toBe(true), { timeout: 3000 });
  });

  it('explains a blocked camera and offers to try again', async () => {
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia: vi.fn(async () => Promise.reject(new DOMException('no', 'NotAllowedError'))) } });
    render(
      <AppProviders>
        <AadhaarQrScanner onText={() => undefined} onCancel={() => undefined} decode={vi.fn()} />
      </AppProviders>,
    );
    expect(await screen.findByText(/Camera access is blocked/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('EAadhaarPdf (opened in the browser, never uploaded)', () => {
  const pdf = () => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'eaadhaar.pdf', { type: 'application/pdf' });

  it('asks for the password with the hint, reads the QR in the browser and hands over only its text', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const read = vi.fn(async (_data: ArrayBuffer, password: string) => (password === 'KAVY1998' ? { ok: true as const, text: QR_TEXT } : { ok: false as const, reason: 'password_wrong' as const }));
    const onText = vi.fn();
    render(
      <AppProviders>
        <EAadhaarPdf onText={onText} onCancel={() => undefined} read={read} />
      </AppProviders>,
    );
    expect(screen.getByText(/first 4 letters of your name in capitals and your year of birth/)).toBeInTheDocument();
    await userEvent.upload(screen.getByLabelText('Your e-Aadhaar PDF'), pdf());
    await userEvent.type(screen.getByLabelText('PDF password'), 'kavy1990');
    await userEvent.click(screen.getByRole('button', { name: 'Open and read the QR code' }));
    expect(await screen.findByText(/Wrong password/)).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('PDF password'));
    await userEvent.type(screen.getByLabelText('PDF password'), 'kavy1998');
    await userEvent.click(screen.getByRole('button', { name: 'Open and read the QR code' }));
    await waitFor(() => expect(onText).toHaveBeenCalledWith(QR_TEXT));
    expect(read.mock.calls[1]![1]).toBe('KAVY1998');
    expect(read.mock.calls[1]![0]).toBeInstanceOf(ArrayBuffer);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/The PDF stays on your phone/)).toBeInTheDocument();
  });

  it('says when no Aadhaar QR is in the PDF', async () => {
    const read = vi.fn(async () => ({ ok: false as const, reason: 'no_qr' as const }));
    render(
      <AppProviders>
        <EAadhaarPdf onText={vi.fn()} onCancel={() => undefined} read={read} />
      </AppProviders>,
    );
    await userEvent.upload(screen.getByLabelText('Your e-Aadhaar PDF'), pdf());
    await userEvent.click(screen.getByRole('button', { name: 'Open and read the QR code' }));
    expect(await screen.findByText(/No Aadhaar QR code was found/)).toBeInTheDocument();
  });
});
