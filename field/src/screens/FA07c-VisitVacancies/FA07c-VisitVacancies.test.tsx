import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, searchParams, segments } from '@/test/expo-router-mock';
import { kiran, renderWithApp } from '@/test/render';
import { routeTable } from '@/test/selling-fixtures';
import { businessPage } from '@/test/redesign-fixtures';
import VisitVacanciesScreen from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

beforeEach(() => {
  jest.clearAllMocks();
  searchParams.current = { businessId: 'b-1', visitId: 'v-1' };
  segments.current = ['(app)', '(tabs)', '(visits)', 'visit', 'vacancies'];
});

describe('FA07c vacancies, step 6 of 7', () => {
  it('each draft is checked and sent to the owner with one tap, inside the Visits tab', async () => {
    const { route, calls } = routeTable({
      '/field-work/businesses/b-1/page': businessPage(),
      'POST /vacancies/vac-1/submit-for-confirmation': { id: 'vac-1', code: 'VC-00031', status: 'awaiting_confirmation', confirmation: { otpRequestId: 'otp-1', sentToLast4: '4321', contactName: 'Manjunath' } },
    });
    await renderWithApp(<VisitVacanciesScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('vacancy-vac-1'));
    expect(screen.getByTestId('step-counter')).toHaveTextContent('Step 6 of 7 · vacancies');
    await fireEvent.press(screen.getByTestId('vacancy-vac-1-send'));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/visit/vacancy/vac-1?otp=otp-1&last4=4321'));
    expect(calls).toContainEqual({ method: 'POST', path: '/vacancies/vac-1/submit-for-confirmation', body: {} });
    await fireEvent.press(screen.getByTestId('vacancy-vac-2-code'));
    expect(router.push).toHaveBeenCalledWith('/visit/vacancy/vac-2');
    await fireEvent.press(screen.getByTestId('fa07c-next'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/visit/done', params: { businessId: 'b-1', visitId: 'v-1' } });
    expect(screen.getByTestId('finish-later')).toBeTruthy();
  });

  it('a business with no vacancy can still be onboarded: it adds them later', async () => {
    const { route } = routeTable({ '/field-work/businesses/b-1/page': businessPage({ vacancies: [] }) });
    await renderWithApp(<VisitVacanciesScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('fa07c-list'));
    expect(screen.getByTestId('fa07c-list')).toHaveTextContent(/No vacancy yet.*Laboura app or by calling the Laboura team/);
    expect(screen.getByTestId('fa07c-next')).not.toBeDisabled();
  });
});
