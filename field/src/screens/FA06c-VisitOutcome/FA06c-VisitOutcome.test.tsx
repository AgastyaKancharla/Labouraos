import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { searchParams } from '@/test/expo-router-mock';
import { OfflineQueue } from '@/device/offline-queue/queue';
import { createMemoryQueueStore } from '@/device/offline-queue/types';
import { networkError } from '@/api/errors';
import { kiran, renderWithApp } from '@/test/render';
import { sampleVisit } from '@/test/visit-fakes';
import VisitOutcomeScreen from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

const route = (url: string) => (url.endsWith('/field-visits/v-1') ? { status: 200, body: sampleVisit } : undefined);

beforeEach(() => {
  jest.clearAllMocks();
  searchParams.current = { id: 'v-1' };
});

describe('FA06c Visit outcome', () => {
  it('every visit gets an outcome: "not interested" needs a reason; onboarded only for a registered business', async () => {
    const sent: unknown[] = [];
    const queue = new OfflineQueue({ store: createMemoryQueueStore(), send: async (item) => void sent.push(item.request) });
    await renderWithApp(<VisitOutcomeScreen />, { signedInAs: kiran, route, queue });
    await waitFor(() => screen.getByTestId('fa06c-outcome'));
    expect(screen.getByTestId('fa06c-outcome-onboarded').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByTestId('fa06c-outcome-not_interested'));
    await fireEvent.press(screen.getByTestId('fa06c-save'));
    expect(screen.getByTestId('fa06c-problem')).toHaveTextContent(/why they are not interested/);
    await fireEvent.press(screen.getByTestId('fa06c-reason-fee_too_high'));
    await fireEvent.press(screen.getByTestId('fa06c-save'));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ path: '/field-visits/v-1/outcome', json: { outcome: 'not_interested', reason: 'fee_too_high', shopName: 'Sri Krishna Hotel' } });
    expect(screen.getByTestId('fa06c-saved')).toHaveTextContent(/Visit saved/);
  });

  it('"come back" needs a date from the picker and is saved on the phone without signal', async () => {
    searchParams.current = { id: 'v-1', outcome: 'interested_later' };
    const queue = new OfflineQueue({ store: createMemoryQueueStore(), send: async () => Promise.reject(networkError()) });
    await renderWithApp(<VisitOutcomeScreen />, { signedInAs: kiran, route, queue });
    await waitFor(() => screen.getByTestId('fa06c-date'));
    await fireEvent.press(screen.getByTestId('fa06c-save'));
    expect(screen.getByTestId('fa06c-problem')).toHaveTextContent(/date to come back/);
    const tomorrow = screen.getByText('Tomorrow');
    await fireEvent.press(tomorrow);
    await fireEvent.changeText(screen.getByTestId('fa06c-note'), 'Owner wants 2 cooks after Deepavali');
    await fireEvent.press(screen.getByTestId('fa06c-save'));
    await waitFor(() => expect(screen.getByTestId('fa06c-saved')).toHaveTextContent(/sent when the signal returns/));
    const json = queue.list()[0].request.json as Record<string, string>;
    expect(json).toMatchObject({ outcome: 'interested_later', note: 'Owner wants 2 cooks after Deepavali' });
    expect(json.revisitOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
