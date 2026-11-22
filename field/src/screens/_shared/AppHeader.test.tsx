import { StyleSheet } from 'react-native';
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { router, segments } from '@/test/expo-router-mock';
import { kiran, renderWithApp } from '@/test/render';
import { AppHeader } from './AppHeader';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

beforeEach(() => jest.clearAllMocks());

describe('the back arrow (redesign, 16 Nov)', () => {
  it('a tab’s main page has no back arrow', async () => {
    await renderWithApp(<AppHeader title="Today" root />, { signedInAs: kiran });
    expect(screen.queryByTestId('header-back')).toBeNull();
    expect(screen.getByTestId('logo-home')).toBeTruthy();
  });

  it('every inner screen has one: it goes one step back inside the tab', async () => {
    segments.current = ['(app)', '(tabs)', 'businesses', 'vacancy', '[id]'];
    await renderWithApp(<AppHeader title="Vacancy" />, { signedInAs: kiran });
    expect(screen.getByLabelText('Back')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('header-back'));
    expect(router.back).toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('with nothing to go back to (opened from a link), it goes to the tab’s main page', async () => {
    (router.canGoBack as jest.Mock).mockReturnValueOnce(false);
    segments.current = ['(app)', '(tabs)', '(visits)', 'visit', 'agreement'];
    await renderWithApp(<AppHeader title="Agreement" />, { signedInAs: kiran });
    await fireEvent.press(screen.getByTestId('header-back'));
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('/visits');
  });
});

describe('the status chip in the header (Laboura Field lists, 22 Nov evening)', () => {
  const openDay = {
    date: '2026-11-22', status: 'available', loginAt: '2026-11-22T03:42:00Z', logoutAt: null, lateMinutes: 0, productionSeconds: 0, breakSeconds: 0,
    idleSeconds: 0, shortfallSeconds: 0, clocks: { shiftStart: '09:30', shiftEnd: '18:30', now: '2026-11-22T05:00:00Z' }, flagged: false, closedReason: null, dayType: 'open',
  };
  const route = (url: string, init: RequestInit) => {
    if (url.endsWith('/attendance/today')) return { status: 200, body: openDay };
    if (url.endsWith('/field-work/notifications')) return { status: 200, body: { unseenCount: 1, items: [] } };
    if (url.endsWith('/attendance/status') && init.method === 'POST') return { status: 200, body: { ...openDay, status: 'lunch' } };
    return undefined;
  };

  it('sits IN the header bar, just left of the bell, on a tab’s main page; tapping it opens the status picker', async () => {
    await renderWithApp(<AppHeader title="My job seekers" root />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('header-status'));
    const right = screen.getByTestId('header-right');
    const order = within(right).getAllByRole('button').map((b) => b.props.testID);
    expect(order.slice(0, 2)).toEqual(['header-status', 'header-bell']);
    expect(screen.getByTestId('header-status')).toHaveTextContent('Active');
    await fireEvent.press(screen.getByTestId('header-status'));
    await waitFor(() => screen.getByTestId('status-choice-lunch'));
    await fireEvent.press(screen.getByTestId('status-choice-lunch'));
    await waitFor(() => expect(screen.getByTestId('header-status')).toHaveTextContent('Lunch'));
  });

  it('never pushes the header wider than a 360 px phone: the chip has a set width and cuts its words', async () => {
    await renderWithApp(<AppHeader title="My businesses" root />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('header-status'));
    const chip = screen.getByTestId('header-status');
    expect(StyleSheet.flatten(screen.getByTestId('header-status-chip').props.style)).toMatchObject({ maxWidth: 112 });
    expect(within(chip).getByText('Active').props.numberOfLines).toBe(1);
    // The status side shrinks before the header grows; the title keeps at least its start.
    expect(StyleSheet.flatten(screen.getByTestId('header-right').props.style)).toMatchObject({ flexShrink: 1, minWidth: 0 });
  });

  it('is not on inner screens', async () => {
    segments.current = ['(app)', '(tabs)', 'businesses', '[id]'];
    await renderWithApp(<AppHeader title="Business" />, { signedInAs: kiran, route });
    await waitFor(() => expect(screen.queryByTestId('header-bell')).toBeNull());
    expect(screen.queryByTestId('header-status')).toBeNull();
  });
});
