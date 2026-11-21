import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from '@/test/expo-router-mock';
import { kiran, renderWithApp } from '@/test/render';
import MeScreen from '../FA24-Me';
import NotificationsScreen, { notificationHref } from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

const items = [
  { id: 'n-1', kind: 'field_visit_assigned', title: 'Verification visit: Sri Sai Tiffins', body: 'JP Nagar', createdAt: '2026-11-23T05:00:00.000Z', seenAt: null, clearedAt: null, target: { type: 'visit_assignment', id: 'va-1' } },
  { id: 'n-2', kind: 'new_match_registered', title: 'New match for VC-00012 (Cook)', body: 'JS-00031 Ravi just registered', createdAt: '2026-11-23T04:00:00.000Z', seenAt: null, clearedAt: null, target: { type: 'vacancy_matches', id: 'vac-12', vacancyId: 'vac-12', businessId: 'b-4' } },
  { id: 'n-3', kind: 'request_decided', title: 'Your leave was approved', body: null, createdAt: '2026-11-22T10:00:00.000Z', seenAt: '2026-11-22T11:00:00.000Z', clearedAt: null, target: { type: 'leave', id: 'l-1' } },
];

describe('FA25 Notifications (the bell, 21 Nov)', () => {
  it('a tab page shows the bell with the unread count; it opens Notifications', async () => {
    await renderWithApp(<MeScreen />, {
      signedInAs: kiran,
      route: (url) => (url.endsWith('/field-work/notifications') ? { status: 200, body: { unseenCount: 2, openCount: 3, items, asOf: '' } } : undefined),
    });
    await waitFor(() => expect(screen.getByTestId('header-bell-count')).toHaveTextContent('2'));
    await fireEvent.press(screen.getByTestId('header-bell'));
    expect(router.push).toHaveBeenLastCalledWith('/notifications');
  });

  it('lists every notification, unread marked; tapping one marks it read and opens its record; Mark all as read', async () => {
    const seen: string[] = [];
    await renderWithApp(<NotificationsScreen />, {
      signedInAs: kiran,
      route: (url, init) => {
        if (url.endsWith('/field-work/notifications')) return { status: 200, body: { unseenCount: 2, openCount: 3, items, asOf: '' } };
        if (init.method === 'POST' && url.includes('/notifications/')) {
          seen.push(url.replace('https://api.test', ''));
          return { status: 201, body: {} };
        }
        return undefined;
      },
    });
    await waitFor(() => screen.getByTestId('bell-n-1'));
    expect(screen.getByTestId('bell-n-1')).toHaveTextContent(/Verification visit: Sri Sai Tiffins.*JP Nagar.*New/);
    await fireEvent.press(screen.getByTestId('bell-n-2'));
    expect(router.push).toHaveBeenLastCalledWith('/businesses/candidates/b-4?vacancyId=vac-12');
    await waitFor(() => expect(seen).toContain('/notifications/n-2/seen'));
    await fireEvent.press(screen.getByTestId('bell-n-3'));
    expect(router.push).toHaveBeenLastCalledWith('/me/attendance/leave');
    expect(seen).not.toContain('/notifications/n-3/seen');
    await fireEvent.press(screen.getByTestId('bell-mark-all'));
    await waitFor(() => expect(seen).toContain('/notifications/seen'));
  });

  it('every target opens the right Field screen', () => {
    expect(notificationHref({ type: 'visit_assignment', id: 'va-1' })).toBe('/visits');
    expect(notificationHref({ type: 'business', id: 'b-1' })).toBe('/businesses/b-1');
    expect(notificationHref({ type: 'placement', id: 'pl-1' })).toBe('/businesses/placement/pl-1/joining');
    expect(notificationHref({ type: 'revisit', id: 'v-1' })).toEqual({ pathname: '/visit/start', params: { revisitOf: 'v-1' } });
    expect(notificationHref({ type: 'job_seeker', id: 'js-1' })).toBe('/job-seekers/js-1');
    expect(notificationHref(null)).toBeNull();
  });
});
