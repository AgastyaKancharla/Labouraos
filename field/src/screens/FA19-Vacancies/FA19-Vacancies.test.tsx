import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { kiran, renderWithApp } from '@/test/render';
import { hit, routeTable } from '@/test/selling-fixtures';
import VacanciesScreen from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));
beforeEach(() => jest.clearAllMocks());

describe('FA19 Vacancies tab', () => {
  it('lists recent businesses with the vacancies waiting for the owner\'s OTP; tapping one opens the OTP', async () => {
    const { route } = routeTable({
      '/screens/field-selling/recent-vacancies': {
        results: [hit({ waitingForOtp: 1, vacancies: [{ id: 'vac-1', trade: 'Cook', headcount: 2, status: 'open' }, { id: 'vac-2', trade: 'Kitchen helper', headcount: 1, status: 'awaiting_confirmation' }] })],
      },
      '/screens/field-selling/businesses': { query: 'Gr', results: [hit({ id: 'biz-3', code: 'BZ-0291', name: 'Green Leaf Café' })] },
    });
    await renderWithApp(<VacanciesScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('business-BZ-0318'));
    expect(screen.getByTestId('business-BZ-0318')).toHaveTextContent(/Cook × 2 \(OTP confirmed\) · Kitchen helper waiting for OTP.*1 waiting/);
    await fireEvent.press(screen.getByTestId('business-BZ-0318'));
    expect(router.push).toHaveBeenCalledWith('/vacancies/confirm/vac-2');
    await fireEvent.changeText(screen.getByTestId('business-search'), 'Gr');
    await waitFor(() => screen.getByTestId('business-BZ-0291'));
    await fireEvent.press(screen.getByTestId('business-BZ-0291'));
    expect(router.push).toHaveBeenCalledWith('/vacancies/new?businessId=biz-3');
  });
});
