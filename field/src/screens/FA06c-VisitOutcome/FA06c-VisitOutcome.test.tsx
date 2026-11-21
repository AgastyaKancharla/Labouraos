import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, searchParams } from '@/test/expo-router-mock';
import { OfflineQueue } from '@/device/offline-queue/queue';
import { createMemoryQueueStore } from '@/device/offline-queue/types';
import { ApiError, networkError } from '@/api/errors';
import { clearAllFormDrafts } from '@/lib/formDraft';
import { kiran, renderWithApp } from '@/test/render';
import { sampleVisit } from '@/test/visit-fakes';
import { saveDraft } from '../_visits/visitDraft';
import VisitOutcomeScreen from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

const route = (url: string) => (url.endsWith('/field-visits/v-1') ? { status: 200, body: sampleVisit } : undefined);

beforeEach(() => {
  jest.clearAllMocks();
  clearAllFormDrafts();
  searchParams.current = { id: 'v-1' };
});

describe('FA06c How did the visit go?', () => {
  it('"not interested" needs a reason; Onboarded is never picked here (the business form sets it)', async () => {
    const sent: unknown[] = [];
    const queue = new OfflineQueue({ store: createMemoryQueueStore(), send: async (item) => void sent.push(item.request) });
    await renderWithApp(<VisitOutcomeScreen />, { signedInAs: kiran, route, queue });
    await waitFor(() => screen.getByTestId('fa06c-outcome'));
    expect(screen.queryByTestId('fa06c-outcome-onboarded')).toBeNull();
    await fireEvent.press(screen.getByTestId('fa06c-outcome-not_interested'));
    await fireEvent.press(screen.getByTestId('fa06c-save'));
    expect(screen.getByTestId('fa06c-problem')).toHaveTextContent(/why they are not interested/);
    await fireEvent.press(screen.getByTestId('fa06c-reason-fee_too_high'));
    await fireEvent.press(screen.getByTestId('fa06c-save'));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ path: '/field-visits/v-1/outcome', json: { outcome: 'not_interested', reason: 'fee_too_high', shopName: 'Sri Krishna Hotel' } });
    expect(screen.getByTestId('fa06c-saved')).toHaveTextContent(/Visit saved/);
    // Back to Visits closes every step of the visit, so back never reopens them.
    await fireEvent.press(screen.getByTestId('fa06c-done'));
    expect(router.dismissTo).toHaveBeenCalledWith('/visits');
  });

  it('"come back" needs a date from the picker and is saved on the phone without signal', async () => {
    searchParams.current = { id: 'v-1', outcome: 'interested_later' };
    const queue = new OfflineQueue({ store: createMemoryQueueStore(), send: async () => Promise.reject(networkError()) });
    await renderWithApp(<VisitOutcomeScreen />, { signedInAs: kiran, route, queue });
    await waitFor(() => screen.getByTestId('fa06c-date'));
    await fireEvent.press(screen.getByTestId('fa06c-save'));
    expect(screen.getByTestId('fa06c-problem')).toHaveTextContent(/date to come back/);
    await fireEvent.press(screen.getByText('Tomorrow'));
    // 21 Nov: an optional come-back time.
    await fireEvent.press(screen.getByTestId('fa06c-time'));
    await fireEvent.press(screen.getByTestId('fa06c-time-option-16:30'));
    await fireEvent.changeText(screen.getByTestId('fa06c-note'), 'Owner wants 2 cooks after Deepavali');
    await fireEvent.press(screen.getByTestId('fa06c-save'));
    await waitFor(() => expect(screen.getByTestId('fa06c-saved')).toHaveTextContent(/sent when the signal returns/));
    const json = queue.list()[0].request.json as Record<string, string>;
    expect(json).toMatchObject({ outcome: 'interested_later', note: 'Owner wants 2 cooks after Deepavali', revisitTime: '16:30' });
    expect(json.revisitOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('a finished visit never opens the question again: it is read fresh from the server and goes to visit details', async () => {
    // The phone's copy says nothing about the result; the server says Onboarded.
    saveDraft({ id: 'v-1', startedAt: sampleVisit.startedAt, latitude: 1, longitude: 1, accuracy: 5, shopName: 'Sri Krishna Hotel', businessId: null, businessName: null, spokeTo: 'owner', contactPhone: '', endedAt: null, proofDistance: null, proofAt: null });
    await renderWithApp(<VisitOutcomeScreen />, {
      signedInAs: kiran,
      route: (url) => (url.endsWith('/field-visits/v-1') ? { status: 200, body: { ...sampleVisit, outcome: 'onboarded', business: { id: 'b-1', code: 'BZ-1', name: 'Sri Krishna Hotel' } } } : undefined),
    });
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/visit/details/v-1'));
    expect(screen.queryByTestId('fa06c-outcome')).toBeNull();
  });

  it('if the server already has a result when saving, it shows the visit details instead', async () => {
    const queue = new OfflineQueue({
      store: createMemoryQueueStore(),
      send: async () => Promise.reject(new ApiError({ status: 409, messages: ['set'], body: { code: 'VISIT_RESULT_ALREADY_SET', currentOutcome: 'onboarded' } })),
    });
    await renderWithApp(<VisitOutcomeScreen />, { signedInAs: kiran, route, queue });
    await waitFor(() => screen.getByTestId('fa06c-outcome'));
    await fireEvent.press(screen.getByTestId('fa06c-outcome-owner_not_there'));
    await fireEvent.press(screen.getByText('Tomorrow'));
    await fireEvent.press(screen.getByTestId('fa06c-save'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/visit/details/v-1'));
  });
});
