import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { kiran, renderWithApp } from '@/test/render';
import { business, recordingQueue, routeTable } from '@/test/selling-fixtures';
import CallOwnerScreen, { istIso } from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));
beforeEach(() => {
  jest.clearAllMocks();
  (useLocalSearchParams as jest.Mock).mockReturnValue({ businessId: 'biz-1' });
});

describe('FA18 Call the owner', () => {
  it('places a masked call and records a complaint for the Team Lead (saved on the phone if the signal drops)', async () => {
    const { route, calls } = routeTable({ '/screens/field-selling/businesses/biz-1': business, 'POST /calls': { callRecordId: 'call-5' } });
    const { queue, sent } = recordingQueue({ callRecordId: 'call-5' });
    await renderWithApp(<CallOwnerScreen />, { signedInAs: kiran, route, queue });
    await waitFor(() => screen.getByTestId('call-owner'));
    await fireEvent.press(screen.getByTestId('call-owner'));
    await waitFor(() => screen.getByTestId('on-call'));
    expect(calls).toContainEqual({ method: 'POST', path: '/calls', body: { subjectType: 'business', subjectId: 'biz-1', purpose: 'check_in' } });
    await fireEvent.press(screen.getByTestId('outcome-complaint'));
    expect(screen.getByTestId('save')).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId('note'), 'Worker late every day');
    await fireEvent.press(screen.getByTestId('save'));
    await waitFor(() => screen.getByTestId('saved'));
    expect(sent[0].request).toMatchObject({ path: '/field-selling/owner-calls/call-5/outcome', json: { outcome: 'complaint', note: 'Worker late every day' } });
  });

  it('needs more staff → save & add a vacancy', async () => {
    const { route } = routeTable({ '/screens/field-selling/businesses/biz-1': business, 'POST /calls': { callRecordId: 'call-6' } });
    await renderWithApp(<CallOwnerScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('call-owner'));
    await fireEvent.press(screen.getByTestId('call-owner'));
    await waitFor(() => screen.getByTestId('outcome-needs_staff'));
    await fireEvent.press(screen.getByTestId('outcome-needs_staff'));
    await fireEvent.press(screen.getByTestId('save-add'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/vacancies/new?businessId=biz-1'));
  });

  it('turns an IST date and time into an instant', () => {
    expect(istIso('2026-11-16', '11:00')).toBe('2026-11-16T05:30:00.000Z');
  });
});
