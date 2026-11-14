import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import { kiran, renderWithApp } from '@/test/render';
import { routeTable, seekerStatus as status } from '@/test/selling-fixtures';
import SeekerProgress from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

// The live camera: a fake that "sees" a QR code when the test presses it.
const QR_TEXT = '2374971804270526477833002468783965837992554564899874087591661303561346432389832';
const mockPermission = { granted: true };
jest.mock('expo-camera', () => {
  const { Pressable } = require('react-native');
  const CameraView = (props: { onBarcodeScanned?: (e: { data: string; type: string }) => void; barcodeScannerSettings?: { barcodeTypes: string[] } }) => (
    <Pressable
      testID="fake-camera"
      accessibilityHint={props.barcodeScannerSettings?.barcodeTypes.join(',')}
      onPress={() => props.onBarcodeScanned?.({ data: QR_TEXT, type: 'qr' })}
    />
  );
  return { CameraView, useCameraPermissions: () => [mockPermission, jest.fn()] };
});

// The live camera for the ID card: a fake that "takes" the photo when pressed.
jest.mock('@/device/camera', () => {
  const actual = jest.requireActual('@/device/camera');
  const { Pressable } = require('react-native');
  const LiveCamera = (props: { facing?: string; onCapture: (p: object) => void }) => (
    <Pressable
      testID="fake-card-camera"
      accessibilityHint={props.facing}
      onPress={() => props.onCapture({ uri: 'file:///card.jpg', width: 1280, height: 960, mimeType: 'image/jpeg', source: 'live_camera', stamp: { lines: [] } })}
    />
  );
  return { ...actual, LiveCamera };
});

const atIdStep = (over: object = {}) =>
  status({
    stage: 'in_progress',
    nextStep: 'id_check',
    registrationLinkExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    steps: { phone: { state: 'done' }, consent: { state: 'done' }, selfie: { state: 'done' }, idCheck: { state: 'not_started' }, payment: { state: 'not_started' } },
    consent: { requiredGiven: 5, requiredTotal: 5, promotions: false },
    ...over,
  });

const verified = {
  verificationId: 'v1', method: 'aadhaar_qr', status: 'verified', result: 'verified', verifiedByUidai: true,
  nameMatches: true, isAdult: true, maskedReference: 'XXXX-XXXX-2697', failureReason: null, offerOtherId: false,
};

describe('FA10c "Scan Aadhaar QR" (guide, Aadhaar verification, 14 Nov)', () => {
  beforeEach(() => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'js-uuid' });
  });

  it('at the ID step, with consent given, scans the card live and sends only the QR text', async () => {
    const { route, calls } = routeTable({
      '/screens/call-registration/job-seekers/js-uuid': atIdStep(),
      'POST /field-work/job-seekers/js-uuid/aadhaar-qr': verified,
    });
    await renderWithApp(<SeekerProgress />, { signedInAs: kiran, route });
    await fireEvent.press(await screen.findByTestId('scan-aadhaar'));
    expect(screen.getByTestId('fake-camera')).toHaveProp('accessibilityHint', 'qr');
    expect(screen.getByText(/no photo is taken or saved on this phone/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('fake-camera'));
    await waitFor(() => expect(screen.getByTestId('aadhaar-scan-verified')).toHaveTextContent('Aadhaar verified by UIDAI · XXXX-XXXX-2697'));
    expect(calls).toContainEqual({ method: 'POST', path: '/field-work/job-seekers/js-uuid/aadhaar-qr', body: { qrText: QR_TEXT, captureSource: 'live_camera' } });
    // Scanning the same frame twice sends once.
    expect(calls.filter((c: { path: string }) => c.path.endsWith('/aadhaar-qr'))).toHaveLength(1);
  });

  it('a name that does not match goes to the Team Lead and he can use another ID on his link', async () => {
    const { route } = routeTable({
      '/screens/call-registration/job-seekers/js-uuid': atIdStep(),
      'POST /field-work/job-seekers/js-uuid/aadhaar-qr': { ...verified, status: 'failed', result: 'name_mismatch', nameMatches: false, offerOtherId: true },
    });
    await renderWithApp(<SeekerProgress />, { signedInAs: kiran, route });
    await fireEvent.press(await screen.findByTestId('scan-aadhaar'));
    await fireEvent.press(screen.getByTestId('fake-camera'));
    await waitFor(() => expect(screen.getByTestId('aadhaar-scan-name_mismatch')).toHaveTextContent(/A Team Lead will check it/));
    expect(screen.getByTestId('aadhaar-scan-again')).toBeTruthy();
  });

  it('is not offered before his consent, nor after the ID step', async () => {
    const { route } = routeTable({
      '/screens/call-registration/job-seekers/js-uuid': atIdStep({ nextStep: 'consent', steps: { phone: { state: 'done' }, consent: { state: 'in_progress' }, selfie: { state: 'not_started' }, idCheck: { state: 'not_started' }, payment: { state: 'not_started' } } }),
    });
    await renderWithApp(<SeekerProgress />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('seeker-banner'));
    expect(screen.queryByTestId('scan-aadhaar')).toBeNull();
  });

  it('"Photo of another ID": type, number, a live photo of the card (back camera) — sent to the Team Lead, pending', async () => {
    const { route, calls } = routeTable({
      '/screens/call-registration/job-seekers/js-uuid': atIdStep(),
      'POST /field-work/job-seekers/js-uuid/other-id': { verificationId: 'v9', method: 'pan', status: 'pending', idNumberLast4: '234F' },
    });
    await renderWithApp(<SeekerProgress />, { signedInAs: kiran, route });
    await fireEvent.press(await screen.findByTestId('other-id-open'));
    expect(screen.getByTestId('other-id-photo')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('other-id-type'));
    await fireEvent.press(await screen.findByText('PAN card'));
    await fireEvent.changeText(screen.getByTestId('other-id-number'), 'abcde1234');
    expect(screen.getByText('Type the number exactly as it is on the card.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('other-id-number'), 'abcde 1234 f');
    await fireEvent.press(screen.getByTestId('other-id-photo'));
    expect(screen.getByTestId('fake-card-camera')).toHaveProp('accessibilityHint', 'back');
    await fireEvent.press(screen.getByTestId('fake-card-camera'));
    await waitFor(() => expect(screen.getByTestId('other-id-pending')).toHaveTextContent('PAN card ending 234F sent to the Team Lead'));
    const sent = calls.find((c: { path: string }) => c.path === '/field-work/job-seekers/js-uuid/other-id') as { body: FormData } | undefined;
    expect(sent?.body.get('idType')).toBe('pan');
    expect(sent?.body.get('idNumber')).toBe('ABCDE1234F');
    expect(sent?.body.get('captureSource')).toBe('live_camera');
  });

  it('shows "waiting for the Team Lead" on the ID step while another ID is pending', async () => {
    const { route } = routeTable({
      '/screens/call-registration/job-seekers/js-uuid': atIdStep({
        steps: { phone: { state: 'done' }, consent: { state: 'done' }, selfie: { state: 'done' }, idCheck: { state: 'in_progress', reason: 'Waiting for the Team Lead to check the ID card photo' }, payment: { state: 'not_started' } },
      }),
    });
    await renderWithApp(<SeekerProgress />, { signedInAs: kiran, route });
    await waitFor(() => expect(screen.getByTestId('step-idCheck')).toHaveTextContent(/waiting for the Team Lead's check/));
  });
});
