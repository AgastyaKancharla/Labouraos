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
});
