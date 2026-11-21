import { Pressable, Text } from 'react-native';
import * as Network from 'expo-network';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { networkError } from '@/api/errors';
import { OfflineQueue } from '@/device/offline-queue/queue';
import { createMemoryQueueStore } from '@/device/offline-queue/types';
import { useOfflineQueue } from '@/device/offline-queue';
import { kiran, renderWithApp } from '@/test/render';
import { AppHeader } from './AppHeader';
import { QUEUED_NOTICE_MS } from './OfflineNotices';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

function SaveScreen() {
  const queue = useOfflineQueue();
  return (
    <>
      <AppHeader title="Outcome" />
      <Pressable testID="save" onPress={() => void queue.submit('Visit result', { method: 'POST', path: '/field-visits/v-1/outcome', json: { outcome: 'interested_later' } })}>
        <Text>Save</Text>
      </Pressable>
    </>
  );
}

describe('offline notices under every header (21 Nov, M11)', () => {
  it('no signal: says so on every screen (not only Today)', async () => {
    (Network.getNetworkStateAsync as jest.Mock).mockResolvedValueOnce({ isConnected: false, isInternetReachable: false });
    await renderWithApp(<SaveScreen />, { signedInAs: kiran });
    await waitFor(() => screen.getByTestId('offline-banner'));
    expect(screen.getByTestId('offline-banner')).toHaveTextContent(/No signal/);
  });

  it('a tap saved on the phone shows "Saved — will send when online" for a few seconds', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    try {
      const queue = new OfflineQueue({ store: createMemoryQueueStore(), send: async () => Promise.reject(networkError()) });
      await renderWithApp(<SaveScreen />, { signedInAs: kiran, queue });
      expect(screen.queryByTestId('queued-notice')).toBeNull();
      await fireEvent.press(screen.getByTestId('save'));
      await waitFor(() => screen.getByTestId('queued-notice'));
      expect(screen.getByTestId('queued-notice')).toHaveTextContent('Saved — will send when online');
      await act(async () => {
        jest.advanceTimersByTime(QUEUED_NOTICE_MS + 100);
      });
      expect(screen.queryByTestId('queued-notice')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
