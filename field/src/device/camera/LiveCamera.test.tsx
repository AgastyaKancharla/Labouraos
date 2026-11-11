import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { I18nProvider } from '@/i18n';
import { createMemoryStore } from '@/lib/storage';
import { LiveCamera } from './LiveCamera';

const mockPermission = { granted: true };
const mockRequest = jest.fn();
jest.mock('expo-camera', () => {
  const React = require('react');
  const { View } = require('react-native');
  const CameraView = React.forwardRef((props: { onCameraReady?: () => void }, ref: React.Ref<unknown>) => {
    React.useImperativeHandle(ref, () => ({
      takePictureAsync: async () => ({ uri: 'file:///cache/photo.jpg', width: 1280, height: 960, format: 'jpg' }),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    React.useEffect(() => props.onCameraReady?.(), []);
    return <View testID="camera-view" />;
  });
  return { CameraView, useCameraPermissions: () => [mockPermission, mockRequest] };
});

async function renderCamera(onCapture = jest.fn()) {
  await render(
    <I18nProvider storage={createMemoryStore()} initialLanguage="en">
      <LiveCamera onCapture={onCapture} label="BZ-00012" now={() => new Date('2026-11-11T08:35:00Z')} />
    </I18nProvider>,
  );
  return onCapture;
}

describe('LiveCamera', () => {
  beforeEach(() => {
    mockPermission.granted = true;
  });

  it('asks for the camera when it is not allowed yet', async () => {
    mockPermission.granted = false;
    await renderCamera();
    await fireEvent.press(screen.getByTestId('camera-allow'));
    expect(mockRequest).toHaveBeenCalled();
  });

  it('takes a live photo stamped with time and GPS, previews it, then hands it over', async () => {
    const onCapture = await renderCamera();
    await waitFor(() => expect(screen.getByTestId('camera-take')).toBeEnabled());
    await fireEvent.press(screen.getByTestId('camera-take'));
    await waitFor(() => screen.getByTestId('camera-preview'));
    expect(screen.getByText('11 Nov 2026, 2:05 PM IST')).toBeTruthy();
    expect(screen.getByText('12.91160, 77.63890 ±12 m')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('camera-use'));
    expect(onCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        uri: 'file:///cache/photo.jpg',
        source: 'live_camera',
        stamp: expect.objectContaining({ latitude: 12.9116, longitude: 77.6389, accuracy: 12, takenAt: '2026-11-11T08:35:00.000Z' }),
      }),
    );
  });

  it('lets the agent retake', async () => {
    await renderCamera();
    await waitFor(() => expect(screen.getByTestId('camera-take')).toBeEnabled());
    await fireEvent.press(screen.getByTestId('camera-take'));
    await waitFor(() => screen.getByTestId('camera-retake'));
    await fireEvent.press(screen.getByTestId('camera-retake'));
    expect(screen.getByTestId('live-camera')).toBeTruthy();
  });

  it('has no way to pick from the gallery (no image picker installed)', () => {
    const pkg = require('../../../package.json') as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies)).not.toContain('expo-image-picker');
    expect(Object.keys(pkg.dependencies)).not.toContain('expo-media-library');
  });
});
