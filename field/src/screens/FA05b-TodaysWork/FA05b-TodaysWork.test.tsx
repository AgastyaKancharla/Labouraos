import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, searchParams } from '@/test/expo-router-mock';
import { kiran, renderWithApp } from '@/test/render';
import { dayView } from '@/test/redesign-fixtures';
import TodaysWorkScreen from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

beforeEach(() => jest.clearAllMocks());

describe('FA05b Today’s work', () => {
  it('opens on the day and kind it was given (a number on Today), and the kind chips filter it', async () => {
    searchParams.current = { date: '2026-11-15', kind: 'business_registered' };
    const asked: string[] = [];
    await renderWithApp(<TodaysWorkScreen />, {
      signedInAs: kiran,
      route: (url) => {
        if (!url.includes('/field-work/day')) return undefined;
        asked.push(new URL(url).searchParams.get('date') ?? '');
        return { status: 200, body: dayView('2026-11-15') };
      },
    });
    await waitFor(() => screen.getByTestId('work-business:b-1'));
    expect(asked).toEqual(['2026-11-15']);
    expect(screen.queryByTestId('work-visit:v-1')).toBeNull();
    await fireEvent.press(screen.getByTestId('work-kind-all'));
    expect(screen.getByTestId('work-visit:v-1')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('work-kind-visit'));
    expect(screen.queryByTestId('work-business:b-1')).toBeNull();
    await fireEvent.press(screen.getByTestId('work-visit:v-1'));
    expect(router.push).toHaveBeenCalledWith('/visit/details/v-1');
  });

  it('the Onboarded number shows businesses registered and visits marked onboarded', async () => {
    searchParams.current = { date: '2026-11-16', kind: 'onboarded' };
    await renderWithApp(<TodaysWorkScreen />, { signedInAs: kiran, route: (url) => (url.includes('/field-work/day') ? { status: 200, body: dayView('2026-11-16') } : undefined) });
    await waitFor(() => screen.getByTestId('work-business:b-1'));
    expect(screen.getByTestId('work-visit:v-1')).toBeTruthy();
    expect(screen.queryByTestId('work-visit:v-3')).toBeNull();
    expect(screen.queryByTestId('work-js:js-1')).toBeNull();
  });
});
