import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { todayKeyIst } from '@/components/form';
import { kiran, renderWithApp } from '@/test/render';
import { business, recordingQueue, routeTable } from '@/test/selling-fixtures';
import AddVacancyScreen from '.';
import { vacancyBody, vacancyErrors, EMPTY_VACANCY } from './payload';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));
beforeEach(() => {
  jest.clearAllMocks();
  (useLocalSearchParams as jest.Mock).mockReturnValue({ businessId: 'biz-1' });
});

const waiter = { id: 't-1', name: 'Waiter', salaryMinPaise: 1500000, salaryMaxPaise: 2200000, minimumWageLevel: 'unskilled', legalMinimumPaise: 2340000 };

const morning = { id: 'sh-1', businessId: 'biz-1', name: 'Morning', startTime: '07:00', endTime: '15:00', label: 'Morning 07:00–15:00', category: 'day' };

describe('FA17 Add a vacancy', () => {
  it('17 Nov: a business with no shifts yet: the agent adds one right here and the vacancy picks it', async () => {
    const { route, calls } = routeTable({
      '/screens/field-selling/businesses/biz-1': business,
      '/trades': [waiter],
      '/businesses/biz-1/shifts': [],
      'POST /businesses/biz-1/shifts': { ...morning, id: 'sh-new', name: 'Night', startTime: '22:00', endTime: '06:00', label: 'Night 22:00–06:00', category: 'night' },
    });
    await renderWithApp(<AddVacancyScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('vacancy-add-shift'));
    await fireEvent.press(screen.getByTestId('vacancy-add-shift-save'));
    expect(screen.getByTestId('vacancy-add-shift-invalid')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('vacancy-add-shift-name'), 'Night');
    await fireEvent.changeText(screen.getByTestId('vacancy-add-shift-start'), '22');
    await fireEvent.changeText(screen.getByTestId('vacancy-add-shift-end'), '6:00');
    await fireEvent.press(screen.getByTestId('vacancy-add-shift-save'));
    await waitFor(() => expect(screen.getByTestId('shift')).toHaveTextContent(/Night 22:00–06:00/));
    expect(calls).toContainEqual({ method: 'POST', path: '/businesses/biz-1/shifts', body: { name: 'Night', startTime: '22:00', endTime: '06:00' } });
    expect(screen.queryByTestId('vacancy-add-shift')).toBeNull();
  });


  it('warns below the legal minimum and needs the "owner told" tick; saving sends the owner the OTP', async () => {
    const { route } = routeTable({ '/screens/field-selling/businesses/biz-1': business, '/trades': [waiter], '/businesses/biz-1/shifts': [morning] });
    const { queue, sent } = recordingQueue({ id: 'vac-9', code: 'VC-9', status: 'awaiting_confirmation', confirmation: { otpRequestId: 'otp-3', sentToLast4: '3310', contactName: 'Shankar' } });
    await renderWithApp(<AddVacancyScreen />, { signedInAs: kiran, route, queue });
    await waitFor(() => screen.getByTestId('role'));
    await fireEvent.press(screen.getByTestId('role'));
    await fireEvent.press(screen.getByTestId('role-option-Waiter'));
    expect(screen.getByTestId('market-hint')).toHaveTextContent('Waiter in Bengaluru usually earns ₹15,000–22,000 a month.');
    await fireEvent.changeText(screen.getByTestId('salary-min'), '14000');
    await fireEvent.changeText(screen.getByTestId('salary-max'), '16000');
    expect(screen.getByTestId('below-minimum')).toHaveTextContent(/₹23,400/);
    await waitFor(() => screen.getByTestId('shift'));
    await fireEvent.press(screen.getByTestId('shift'));
    await fireEvent.press(screen.getByTestId('shift-option-sh-1'));
    expect(screen.getByTestId('shift')).toHaveTextContent(/Morning 07:00–15:00/);
    await fireEvent.press(screen.getByTestId('start-date'));
    await fireEvent.press(screen.getByTestId(`start-date-day-${todayKeyIst()}`));
    await fireEvent.press(screen.getByTestId('extra-food'));
    await fireEvent.press(screen.getByTestId('save-vacancy'));
    expect(screen.getByText('Tell the owner about the legal minimum and tick the box.')).toBeTruthy();
    expect(sent).toHaveLength(0);
    await fireEvent.press(screen.getByTestId('owner-told'));
    await fireEvent.press(screen.getByTestId('save-vacancy'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/businesses/vacancy/vac-9?otp=otp-3&last4=3310'));
    expect(sent[0].request).toMatchObject({
      method: 'POST', path: '/vacancies',
      json: { businessId: 'biz-1', tradeSkill: 'Waiter', headcount: 1, salaryMinPaise: 1400000, salaryMaxPaise: 1600000, salaryPeriod: 'monthly', businessShiftId: 'sh-1', extras: ['food'], ownerToldMinimumWage: true },
    });
  });

  it('the quick form maps onto the API in paise', () => {
    const form = { ...EMPTY_VACANCY, trade: 'Cook', salaryMinPaise: 1600000, businessShiftId: 'sh-1', startDate: '2026-11-12' };
    expect(vacancyErrors(form, undefined)).toEqual([]);
    expect(vacancyErrors({ ...form, businessShiftId: '' }, undefined)).toEqual(['shift']);
    expect(vacancyBody('b', form)).toMatchObject({ businessShiftId: 'sh-1' });
    expect(vacancyBody('b', form)).not.toHaveProperty('shift');
    expect(vacancyErrors({ ...form, salaryMaxPaise: 100 }, undefined)).toEqual(['salaryOrder']);
    expect(vacancyBody('b', form)).not.toHaveProperty('salaryMaxPaise');
  });
});
