import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import { addDays, todayKeyIst } from '@/components/form';
import { kiran, renderWithApp } from '@/test/render';
import { placement, recordingQueue, routeTable } from '@/test/selling-fixtures';
import JoiningScreen from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));
beforeEach(() => (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'pl-1' }));

const answered = (subjectType: string) => ({ id: `c-${subjectType}`, subjectType, answered: true, durationSec: 65, agentOutcome: null, createdAt: '' });

describe('FA11 Confirm joining', () => {
  it('"He joined" only once both calls were answered — nobody types a joining date', async () => {
    const { route, calls } = routeTable({
      '/screens/field-selling/placements/pl-1': placement({ status: 'confirmed', paidAt: '2026-11-11T07:00:00Z', ownerCall: answered('business') }),
      'POST /calls': { callRecordId: 'c-new' },
    });
    const { queue, sent } = recordingQueue();
    await renderWithApp(<JoiningScreen />, { signedInAs: kiran, route, queue });
    await waitFor(() => screen.getByTestId('owner-says-joined'));
    expect(screen.getByText('Confirmed by bank')).toBeTruthy();
    expect(screen.getByText('Answered · 1:05')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('owner-says-joined'));
    expect(screen.getByTestId('save')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('call-worker'));
    await waitFor(() => expect(calls).toContainEqual({
      method: 'POST', path: '/calls', body: { subjectType: 'job_seeker', subjectId: 'js-1', purpose: 'joining_confirmation', relatedType: 'placement', relatedId: 'pl-1' },
    }));
    expect(sent).toHaveLength(0);
  });

  it('joining moved: pick the new date on the calendar; both are told', async () => {
    const { route } = routeTable({ '/screens/field-selling/placements/pl-1': placement({ status: 'confirmed', paidAt: '2026-11-11T07:00:00Z', ownerCall: answered('business') }) });
    const { queue, sent } = recordingQueue();
    await renderWithApp(<JoiningScreen />, { signedInAs: kiran, route, queue });
    await waitFor(() => screen.getByTestId('owner-says-moved'));
    await fireEvent.press(screen.getByTestId('owner-says-moved'));
    const tomorrow = addDays(todayKeyIst(), 1);
    await fireEvent.press(screen.getByTestId('new-date'));
    if (tomorrow.slice(0, 7) !== todayKeyIst().slice(0, 7)) await fireEvent.press(screen.getByLabelText('Next month'));
    await fireEvent.press(screen.getByTestId(`new-date-day-${tomorrow}`));
    await fireEvent.press(screen.getByTestId('save'));
    await waitFor(() => screen.getByTestId('saved'));
    expect(sent[0].request).toMatchObject({ path: '/field-selling/placements/pl-1/owner-says', json: { answer: 'moved', newJoiningDate: tomorrow } });
  });

  describe('Report worker left (replacement claim, from the old Admin Dashboard)', () => {
    const today = todayKeyIst();
    const leftForm = (over: Record<string, unknown> = {}) => ({
      placement: { id: 'pl-1', code: 'PL-00001', status: 'active', workerName: 'Manjunath', businessId: 'biz-1', businessName: 'Annapoorna Mess', joinedDate: `${addDays(today, -10)}T04:30:00.000Z` },
      guarantee: { windowDays: 60, endsAt: null, reportWithinDays: 7, decisionHours: 48 },
      leftOnLatest: new Date().toISOString(),
      canReport: true,
      blocked: null,
      openClaim: null,
      ownerCalls: [{ id: 'call-7', code: 'CL-7', at: new Date().toISOString(), durationSec: 95, by: 'Kiran' }],
      reasons: { covered: ['resigned', 'never_joined'], notCovered: ['business_closed'] },
      ...over,
    });
    const joined = placement({ status: 'active', paidAt: '2026-11-01T07:00:00Z', joinedDate: `${addDays(today, -10)}T04:30:00.000Z` });

    it('records the claim on the answered owner call with the date and the reason', async () => {
      const { route } = routeTable({ '/screens/field-selling/placements/pl-1': joined, '/placements/pl-1/worker-left': leftForm() });
      const { queue, sent } = recordingQueue();
      await renderWithApp(<JoiningScreen />, { signedInAs: kiran, route, queue });
      await fireEvent.press(await screen.findByTestId('left-open'));
      expect(screen.getByTestId('left-send')).toBeDisabled();
      const day = addDays(today, -1);
      await fireEvent.press(screen.getByTestId('left-on'));
      if (day.slice(0, 7) !== today.slice(0, 7)) await fireEvent.press(screen.getByLabelText('Previous month'));
      await fireEvent.press(screen.getByTestId(`left-on-day-${day}`));
      await fireEvent.press(screen.getByTestId('left-reason'));
      await fireEvent.press(screen.getByTestId('left-reason-option-resigned'));
      expect(screen.getByTestId('left-call')).toBeTruthy();
      await fireEvent.press(screen.getByTestId('left-send'));
      await waitFor(() => screen.getByTestId('left-saved'));
      expect(sent[0].request).toMatchObject({ method: 'POST', path: '/placements/pl-1/claims', json: { workerLeftOn: day, reason: 'resigned', callRecordId: 'call-7' } });
    });

    it('warns on a reason the guarantee does not cover', async () => {
      const { route } = routeTable({ '/screens/field-selling/placements/pl-1': joined, '/placements/pl-1/worker-left': leftForm() });
      await renderWithApp(<JoiningScreen />, { signedInAs: kiran, route, queue: recordingQueue().queue });
      await fireEvent.press(await screen.findByTestId('left-open'));
      await fireEvent.press(screen.getByTestId('left-reason'));
      await fireEvent.press(screen.getByTestId('left-reason-option-business_closed'));
      expect(screen.getByTestId('left-not-covered')).toBeTruthy();
    });

    it('with no answered owner call, asks to call the owner first and cannot be sent', async () => {
      const { route, calls } = routeTable({ '/screens/field-selling/placements/pl-1': joined, '/placements/pl-1/worker-left': leftForm({ ownerCalls: [] }), 'POST /calls': { callRecordId: 'c-9' } });
      await renderWithApp(<JoiningScreen />, { signedInAs: kiran, route, queue: recordingQueue().queue });
      await fireEvent.press(await screen.findByTestId('left-open'));
      expect(screen.getByTestId('left-no-call')).toBeTruthy();
      expect(screen.getByTestId('left-send')).toBeDisabled();
      await fireEvent.press(screen.getByTestId('left-call-owner'));
      await waitFor(() => expect(calls).toContainEqual({
        method: 'POST', path: '/calls', body: { subjectType: 'business', subjectId: 'biz-1', purpose: 'general', relatedType: 'placement', relatedId: 'pl-1' },
      }));
    });

    it('shows a claim already waiting instead of the form, and nothing before joining', async () => {
      const { route } = routeTable({ '/screens/field-selling/placements/pl-1': joined, '/placements/pl-1/worker-left': leftForm({ canReport: false, blocked: 'open_claim', openClaim: { code: 'RC-3', reportedAt: '', decisionDueAt: '' } }) });
      await renderWithApp(<JoiningScreen />, { signedInAs: kiran, route, queue: recordingQueue().queue });
      expect(await screen.findByText('Claim RC-3 is waiting for a decision.')).toBeTruthy();
      expect(screen.queryByTestId('left-open')).toBeNull();
    });
  });
});
