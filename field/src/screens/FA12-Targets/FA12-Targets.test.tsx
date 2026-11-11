import { screen, waitFor } from '@testing-library/react-native';
import { kiran, renderWithApp } from '@/test/render';
import TargetsScreen from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

const metric = (achieved: number, target: number, behind = false) => ({ metric: '', label: '', status: '', storedTarget: target, effectiveTarget: target, achieved, expectedPace: null, isBehindPace: behind, isBreached: false });

describe('FA12 My targets', () => {
  it('shows the three targets, the activated count without a target, and the leaderboard without targets', async () => {
    await renderWithApp(<TargetsScreen />, {
      signedInAs: kiran,
      route: (url) => {
        if (url.endsWith('/targets/dashboard'))
          return {
            status: 200,
            body: {
              scope: 'agent',
              period: { year: 2026, month: 11, daysInMonth: 30, currentDay: 9, asOf: '' },
              agent: { staff: kiran, achieved: {}, metrics: { placementsClosed: metric(9, 12), replacementsInside15Days: metric(1, 1), repeatBusinesses: metric(2, 3) }, isBehindPace: false, isBreached: false },
            },
          };
        if (url.endsWith('/field-work/targets')) return { status: 200, body: { year: 2026, month: 11, candidatesActivated: 6 } };
        if (url.endsWith('/targets/leaderboard'))
          return { status: 200, body: { leaderboard: [{ position: 1, staffId: 'fa-1', staffCode: 'FA-00017', name: 'Kiran Kumar', placementsClosed: 9 }, { position: 2, staffId: 'fa-2', staffCode: 'FA-2', name: 'Meera Joshi', placementsClosed: 7 }] } };
        return undefined;
      },
    });
    await waitFor(() => screen.getByTestId('fa12-placements'));
    expect(screen.getByText('My targets · November')).toBeTruthy();
    expect(screen.getByTestId('fa12-placements')).toHaveTextContent(/Placements closed.*9 \/ 12.*On pace/);
    expect(screen.getByTestId('fa12-replacements')).toHaveTextContent(/1 \/ 1/);
    expect(screen.getByTestId('fa12-repeat')).toHaveTextContent(/2 \/ 3/);
    await waitFor(() => expect(screen.getByTestId('fa12-activated')).toHaveTextContent(/Job seekers you activated.*6.*no target/));
    await waitFor(() => expect(screen.getByTestId('fa12-leaderboard')).toHaveTextContent(/1\. You.*9.*2\. Meera Joshi.*7/));
  });
});
