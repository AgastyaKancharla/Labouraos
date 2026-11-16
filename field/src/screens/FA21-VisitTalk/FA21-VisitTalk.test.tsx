import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, searchParams } from '@/test/expo-router-mock';
import { OfflineQueue } from '@/device/offline-queue/queue';
import { createMemoryQueueStore } from '@/device/offline-queue/types';
import { kiran, renderWithApp } from '@/test/render';
import { sampleVisit } from '@/test/visit-fakes';
import { getDraft, saveDraft } from '../_visits/visitDraft';
import VisitTalkScreen from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

function draft(id: string) {
  saveDraft({
    id, startedAt: new Date(Date.now() - 6 * 60_000).toISOString(), latitude: 12.9116, longitude: 77.6101, accuracy: 8,
    shopName: '', businessId: null, businessName: null, spokeTo: '', contactPhone: '', endedAt: null, proofDistance: null, proofAt: null,
  });
}

beforeEach(() => jest.clearAllMocks());

describe('FA21 Visit a shop · talking', () => {
  it('runs the visit timer and needs the shop name and who he spoke to', async () => {
    draft('t-1');
    searchParams.current = { id: 't-1' };
    await renderWithApp(<VisitTalkScreen />, { signedInAs: kiran });
    expect(screen.getByTestId('fa21-timer')).toHaveTextContent(/^06:0\d$/);
    await fireEvent.press(screen.getByTestId('fa21-not-interested'));
    expect(screen.getByTestId('fa21-problem')).toHaveTextContent(/shop name and who you spoke to/);
    expect(router.push).not.toHaveBeenCalled();
  });

  it('"Interested — onboard now" closes the timer through the queue and opens the proof step', async () => {
    draft('t-2');
    searchParams.current = { id: 't-2' };
    const sent: unknown[] = [];
    const queue = new OfflineQueue({ store: createMemoryQueueStore(), send: async (item) => void sent.push(item.request) });
    await renderWithApp(<VisitTalkScreen />, { signedInAs: kiran, queue });
    await fireEvent.changeText(screen.getByTestId('fa21-shop-name'), 'Sri Krishna Hotel');
    await fireEvent.press(screen.getByTestId('fa21-spoke-owner'));
    await fireEvent.changeText(screen.getByTestId('fa21-mobile'), '99000 54321');
    await fireEvent.press(screen.getByTestId('fa21-onboard'));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      method: 'POST',
      path: '/field-visits/t-2/outcome',
      json: { outcome: 'onboard_now', shopName: 'Sri Krishna Hotel', spokeTo: 'owner', contactPhone: '9900054321' },
    });
    expect(router.push).toHaveBeenCalledWith({ pathname: '/visit/proof', params: { id: 't-2' } });
    expect(getDraft('t-2')?.endedAt).not.toBeNull();
  });

  it('the other outcomes open the outcome form, and an app reopened mid-visit reads the visit back', async () => {
    searchParams.current = { id: 'v-1' };
    await renderWithApp(<VisitTalkScreen />, {
      signedInAs: kiran,
      route: (url) => (url.endsWith('/field-visits/v-1') ? { status: 200, body: sampleVisit } : undefined),
    });
    await waitFor(() => screen.getByTestId('fa21-shop-name'));
    expect(screen.getByTestId('fa21-shop-name').props.value).toBe('Sri Krishna Hotel');
    await fireEvent.press(screen.getByTestId('fa21-owner-not-there'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/visit/outcome', params: { id: 'v-1', outcome: 'owner_not_there' } });
  });

  it('what was typed survives going back to this step', async () => {
    draft('t-9');
    searchParams.current = { id: 't-9' };
    const first = await renderWithApp(<VisitTalkScreen />, { signedInAs: kiran });
    await fireEvent.changeText(screen.getByTestId('fa21-shop-name'), 'Hotel Udupi Grand');
    await first.unmount();
    await renderWithApp(<VisitTalkScreen />, { signedInAs: kiran });
    expect(screen.getByTestId('fa21-shop-name').props.value).toBe('Hotel Udupi Grand');
    expect(screen.getByTestId('step-counter')).toHaveTextContent('Step 2 of 7 · talking to the owner');
  });

  it('the pitch during a visit opens inside the Visits tab', async () => {
    draft('t-10');
    searchParams.current = { id: 't-10' };
    await renderWithApp(<VisitTalkScreen />, { signedInAs: kiran });
    await fireEvent.press(screen.getByTestId('fa21-pitch'));
    expect(router.push).toHaveBeenCalledWith('/visit/pitch');
  });

  it('a visit that already has a result opens its visit details: no timer, no result buttons (A5)', async () => {
    searchParams.current = { id: 'v-1' };
    await renderWithApp(<VisitTalkScreen />, {
      signedInAs: kiran,
      route: (url) => (url.endsWith('/field-visits/v-1') ? { status: 200, body: { ...sampleVisit, outcome: 'not_interested', endedAt: '2026-11-09T06:20:00.000Z' } } : undefined),
    });
    await waitFor(() => screen.getByTestId('redirect'));
    expect(screen.getByTestId('redirect')).toHaveTextContent('/visit/details/v-1');
    expect(screen.queryByTestId('fa21-timer')).toBeNull();
    expect(screen.queryByTestId('fa21-onboard')).toBeNull();
  });

  it('even with the visit still in memory, a result saved on the server wins (A5)', async () => {
    draft('v-8');
    searchParams.current = { id: 'v-8' };
    await renderWithApp(<VisitTalkScreen />, {
      signedInAs: kiran,
      route: (url) => (url.endsWith('/field-visits/v-8') ? { status: 200, body: { ...sampleVisit, id: 'v-8', outcome: 'onboard_now' } } : undefined),
    });
    await waitFor(() => screen.getByTestId('redirect'));
    expect(screen.getByTestId('redirect')).toHaveTextContent('/visit/details/v-8');
  });

  it('a visit with no result yet stays on the talk step', async () => {
    searchParams.current = { id: 'v-1' };
    await renderWithApp(<VisitTalkScreen />, {
      signedInAs: kiran,
      route: (url) => (url.endsWith('/field-visits/v-1') ? { status: 200, body: sampleVisit } : undefined),
    });
    await waitFor(() => screen.getByTestId('fa21-timer'));
    expect(screen.queryByTestId('redirect')).toBeNull();
  });
});
