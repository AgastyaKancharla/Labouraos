import { screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import { kiran, renderWithApp } from '@/test/render';
import { routeTable } from '@/test/selling-fixtures';
import NoMoreScreen from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

describe('FA15x No more matches', () => {
  it('says why there are no more and what salary would add more; the vacancy stays open', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ vacancyId: 'vac-1', businessId: 'biz-1' });
    const { route } = routeTable({
      '/screens/field-selling/vacancies/vac-1/no-more': {
        vacancyId: 'vac-1', trade: 'Cook', businessName: 'Annapoorna Mess', headcount: 2, totalShown: 11, vacancyMaxPaise: 2000000,
        withinDistance: 11, leftOutSalaryAbove: 6, leftOutShift: 3, raiseToPaise: 2200000,
      },
    });
    await renderWithApp(<NoMoreScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByText('No more matches right now'));
    expect(screen.getByText('Annapoorna Mess · Cook × 2 · all 11 matches shown')).toBeTruthy();
    expect(screen.getByTestId('salary-above')).toHaveTextContent('Left out: salary above ₹20,0006');
    expect(screen.getByTestId('shift')).toHaveTextContent(/3$/);
    expect(screen.getByTestId('stays-open')).toHaveTextContent(/stays open.*Raising the salary to ₹22,000 would add 6 more/);
  });
});
