import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { kiran, renderWithApp } from '@/test/render';
import StaffPhotoScreen from './index';

const mockPermission = { granted: true };
jest.mock('expo-camera', () => {
  const React = require('react');
  const { View } = require('react-native');
  const CameraView = React.forwardRef((props: { onCameraReady?: () => void; facing?: string }, ref: React.Ref<unknown>) => {
    React.useImperativeHandle(ref, () => ({
      takePictureAsync: async () => ({ uri: 'file:///cache/selfie.jpg', width: 960, height: 1280, format: 'jpg' }),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    React.useEffect(() => props.onCameraReady?.(), []);
    return <View testID={`camera-view-${props.facing}`} />;
  });
  return { CameraView, useCameraPermissions: () => [mockPermission, jest.fn()] };
});

describe('Staff photo before going on (Laboura Field)', () => {
  it('takes a live front-camera selfie and sends it as a live capture', async () => {
    let sent: RequestInit | undefined;
    const { queryClient } = await renderWithApp(<StaffPhotoScreen reason="missing" />, {
      signedInAs: kiran,
      route: (url, init) => {
        if (url.endsWith('/staff/me/photo') && init.method === 'POST') {
          sent = init;
          return { status: 200, body: { required: false, reason: null, photoUrl: 'https://photos.test/fa-1.jpg' } };
        }
        return undefined;
      },
    });
    const setData = jest.spyOn(queryClient, 'setQueryData');
    expect(screen.getByText('Your staff photo')).toBeTruthy();
    expect(screen.getByText(/whoever gives you a login code can see it is you/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('staff-photo-open'));
    expect(screen.getByTestId('camera-view-front')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('camera-take')).toBeEnabled());
    await fireEvent.press(screen.getByTestId('camera-take'));
    await waitFor(() => screen.getByTestId('camera-preview'));
    await fireEvent.press(screen.getByTestId('camera-use'));
    await waitFor(() => expect(sent).toBeDefined());
    const form = sent!.body as FormData;
    expect(form.get('captureSource')).toBe('live_camera');
    // The gate (app/(app)/_layout.tsx) reads this and lets the agent go on.
    await waitFor(() => expect(setData).toHaveBeenCalledWith(['staff-photo', 'me', 'fa-1'], expect.objectContaining({ required: false })));
  });

  it('says when the CEO asked for a new photo, and shows a failed save', async () => {
    await renderWithApp(<StaffPhotoScreen reason="retake" />, {
      signedInAs: kiran,
      route: (url, init) => (url.endsWith('/staff/me/photo') && init.method === 'POST' ? { status: 500, body: { message: 'down' } } : undefined),
    });
    expect(screen.getByText(/The CEO asked for a new photo/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('staff-photo-open'));
    await waitFor(() => expect(screen.getByTestId('camera-take')).toBeEnabled());
    await fireEvent.press(screen.getByTestId('camera-take'));
    await waitFor(() => screen.getByTestId('camera-preview'));
    await fireEvent.press(screen.getByTestId('camera-use'));
    expect(await screen.findByText(/could not be saved/)).toBeTruthy();
  });
});
