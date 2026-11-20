import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { I18nProvider } from '@/i18n';
import { createMemoryStore } from '@/lib/storage';
import { LiveCamera } from './LiveCamera';

jest.mock('expo-camera', () => ({ useCameraPermissions: () => [{ granted: true }, jest.fn()] }));
const mockMounts: { facing: string; onError: (kind: string) => void; onReady: () => void }[] = [];
jest.mock('./CameraSurface', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    CameraSurface: React.forwardRef((props: { facing: string; onError: (kind: string) => void; onReady: () => void }, _ref: unknown) => {
      React.useEffect(() => {
        mockMounts.push(props);
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return <View testID="camera-surface" />;
    }),
  };
});

async function renderCamera() {
  await render(
    <I18nProvider storage={createMemoryStore()} initialLanguage="en">
      <LiveCamera onCapture={jest.fn()} requireLocation={false} />
    </I18nProvider>,
  );
}

describe('LiveCamera says why the camera did not start (17 Nov)', () => {
  beforeEach(() => (mockMounts.length = 0));

  it.each([
    ['denied', /not allowed to use the camera.*Permissions → Camera → Allow/],
    ['in_use', /could not start. Close other apps/],
    ['no_camera', /No camera was found/],
    ['insecure', /secure https address/],
  ])('%s has its own sentence and Try again opens the camera again', async (kind, sentence) => {
    await renderCamera();
    await waitFor(() => expect(mockMounts).toHaveLength(1));
    await act(async () => mockMounts[0].onError(kind));
    await waitFor(() => screen.getByTestId('camera-error'));
    expect(screen.getByTestId('camera-error')).toHaveTextContent(sentence);
    expect(screen.getByTestId('camera-take')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('camera-retry'));
    await waitFor(() => expect(mockMounts).toHaveLength(2));
    expect(screen.queryByTestId('camera-error')).toBeNull();
  });
});
