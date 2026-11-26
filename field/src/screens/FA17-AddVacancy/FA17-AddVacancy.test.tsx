import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import { todayKeyIst } from '@/components/form';
import { kiran, renderWithApp } from '@/test/render';
import { business, routeTable } from '@/test/selling-fixtures';
import AddVacancyScreen from '.';
import { anotherShift, legalMinimumFor, vacancyBody, vacancyErrors, vacancyRow, EMPTY_VACANCY } from './payload';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));
beforeEach(() => {
  jest.clearAllMocks();
  (useLocalSearchParams as jest.Mock).mockReturnValue({ businessId: 'biz-1' });
});

const waiter = { id: 't-1', name: 'Waiter', salaryMinPaise: 1500000, salaryMaxPaise: 2200000, minimumWageLevel: 'unskilled', legalMinimumPaise: 2340000 };

const morning = { id: 'sh-1', businessId: 'biz-1', name: 'Morning', startTime: '07:00', endTime: '15:00', label: 'Morning 07:00–15:00', category: 'day' };

describe('FA17 Add vacancies', () => {
  const pickDate = async (id = 'start-date') => {
    await fireEvent.press(screen.getByTestId(id));
    await fireEvent.press(screen.getByTestId(`${id}-day-${todayKeyIst()}`));
  };
  const pick = async (id: string, value: string) => {
    await fireEvent.press(screen.getByTestId(id));
    await fireEvent.press(screen.getByTestId(`${id}-option-${value}`));
  };

  it('one vacancy: tap a business shift, the legal-minimum tick, a note; ONE code confirms it', async () => {
    const { route, calls } = routeTable({
      '/screens/field-selling/businesses/biz-1': business,
      '/trades': [waiter],
      '/businesses/biz-1/shifts': [morning],
      'POST /vacancies/batch': {
        vacancies: [{ id: 'vac-9', code: 'VC-9', status: 'awaiting_confirmation', tradeSkill: 'Waiter', headcount: 1 }],
        confirmation: { otpRequestId: 'otp-3', sentToLast4: '3310', contactName: 'Shankar' },
      },
      'POST /vacancies/batch/confirm': { confirmed: 1, vacancies: [{ id: 'vac-9', code: 'VC-9', confirmed: true, status: 'open' }] },
    });
    await renderWithApp(<AddVacancyScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('role'));
    await pick('role', 'Waiter');
    expect(screen.getByTestId('market-hint')).toHaveTextContent('Waiter in Bengaluru usually earns ₹15,000–22,000 a month.');
    await pick('experience', '0');
    await fireEvent.changeText(screen.getByTestId('salary-min'), '14000');
    await fireEvent.changeText(screen.getByTestId('salary-max'), '16000');
    expect(screen.getByTestId('below-minimum')).toHaveTextContent(/₹23,400/);
    await waitFor(() => screen.getByTestId('shift-sh-1'));
    await fireEvent.press(screen.getByTestId('shift-sh-1'));
    await pickDate();
    await fireEvent.press(screen.getByTestId('extra-food'));
    await fireEvent.changeText(screen.getByTestId('note'), 'Bed and 2 meals');
    await fireEvent.press(screen.getByTestId('save-vacancy'));
    expect(screen.getByText('Tell the owner about the legal minimum and tick the box.')).toBeTruthy();
    expect(calls.some((c) => c.path === '/vacancies/batch')).toBe(false);
    await fireEvent.press(screen.getByTestId('owner-told'));
    await fireEvent.press(screen.getByTestId('save-vacancy'));
    await waitFor(() => screen.getByTestId('vacancies-otp-sent'));
    expect(calls.find((c) => c.path === '/vacancies/batch')?.body).toEqual({
      businessId: 'biz-1',
      vacancies: [{
        tradeSkill: 'Waiter', headcount: 1, experienceRequiredYears: 0, salaryMinPaise: 1400000, salaryMaxPaise: 1600000, salaryPeriod: 'monthly',
        businessShiftId: 'sh-1', startDate: todayKeyIst(), extras: ['food'], description: 'Bed and 2 meals', ownerToldMinimumWage: true,
        interviewType: 'walk_in', capturedChannel: 'field_visit',
      }],
    });
    // The business already has this shift: nothing new is saved.
    expect(calls.some((c) => c.method === 'POST' && c.path === '/businesses/biz-1/shifts')).toBe(false);
    // The sixth digit confirms by itself.
    await fireEvent.changeText(screen.getByTestId('vacancies-otp-code'), '714026');
    await waitFor(() => screen.getByTestId('vacancies-confirmed'));
    expect(calls.find((c) => c.path === '/vacancies/batch/confirm')?.body).toEqual({
      businessId: 'biz-1', vacancyIds: ['vac-9'], otpRequestId: 'otp-3', code: '714026', method: 'code_on_visit',
    });
    expect(screen.getByTestId('vacancies-confirmed')).toHaveTextContent('Confirmed. The vacancy is live.');
  });

  it('26 Nov: two helpers on different shifts and a cook, saved together; clock times become a new business shift', async () => {
    const night = { ...morning, id: 'sh-new', name: 'Evening', startTime: '18:00', endTime: '23:00', label: 'Evening 18:00–23:00', category: 'night' };
    const cook = { ...waiter, id: 't-2', name: 'Cook', legalMinimumPaise: 1000000 };
    const { route, calls } = routeTable({
      '/screens/field-selling/businesses/biz-1': business,
      '/trades': [{ ...waiter, legalMinimumPaise: 1000000 }, cook],
      '/businesses/biz-1/shifts': [morning],
      'POST /businesses/biz-1/shifts': night,
      'POST /vacancies/batch': {
        vacancies: [
          { id: 'v1', code: 'VC-1', status: 'awaiting_confirmation', tradeSkill: 'Waiter', headcount: 1 },
          { id: 'v2', code: 'VC-2', status: 'awaiting_confirmation', tradeSkill: 'Waiter', headcount: 1 },
          { id: 'v3', code: 'VC-3', status: 'awaiting_confirmation', tradeSkill: 'Cook', headcount: 1 },
        ],
        confirmation: { otpRequestId: 'otp-7', sentToLast4: '3310', contactName: 'Shankar' },
      },
    });
    await renderWithApp(<AddVacancyScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('role'));
    await pick('role', 'Waiter');
    await pick('experience', '1');
    await fireEvent.changeText(screen.getByTestId('salary-min'), '15000');
    await waitFor(() => screen.getByTestId('shift-sh-1'));
    await fireEvent.press(screen.getByTestId('shift-sh-1'));
    await pickDate();
    await fireEvent.press(screen.getByTestId('extra-food'));
    // Same role, another shift: everything copied but the shift.
    await fireEvent.press(screen.getByTestId('add-same-role'));
    expect(screen.getByTestId('vacancy-card-1')).toHaveTextContent(/Vacancy 2/);
    expect(screen.getByTestId('role-1')).toHaveTextContent(/Waiter/);
    await fireEvent.press(screen.getByTestId('save-vacancy'));
    expect(screen.getByTestId('card-error')).toHaveTextContent('Vacancy 2: check the boxes marked in red.');
    expect(screen.getByTestId('shift-error-1')).toBeTruthy();
    await pick('shift-start-1', '18:00');
    await pick('shift-end-1', '23:00');
    expect(screen.getByTestId('shift-new-1')).toHaveTextContent('New shift 6:00 PM–11:00 PM, saved to this business.');
    // Another role: an empty card (the date is kept).
    await fireEvent.press(screen.getByTestId('add-another-role'));
    await pick('role-2', 'Cook');
    await pick('experience-2', '2');
    await fireEvent.changeText(screen.getByTestId('salary-min-2'), '18000');
    await fireEvent.press(screen.getByTestId('shift-evening-2'));
    expect(screen.getByTestId('save-vacancy')).toHaveTextContent('Save 3 vacancies — owner confirms by one OTP');
    await fireEvent.press(screen.getByTestId('save-vacancy'));
    await waitFor(() => screen.getByTestId('vacancies-otp-sent'));
    // Card 2's clock times and card 3's usual Evening (15:00–23:00) are new to the business: each saved once,
    // the second with a name the business does not have yet.
    const shiftPosts = calls.filter((c) => c.method === 'POST' && c.path === '/businesses/biz-1/shifts');
    expect(shiftPosts.map((c) => c.body)).toEqual([
      { name: 'Evening', startTime: '18:00', endTime: '23:00' },
      { name: 'Evening 2', startTime: '15:00', endTime: '23:00' },
    ]);
    const body = calls.find((c) => c.path === '/vacancies/batch')?.body as { vacancies: Array<Record<string, unknown>> };
    expect(body.vacancies.map((v) => [v.tradeSkill, v.businessShiftId, v.experienceRequiredYears, v.extras])).toEqual([
      ['Waiter', 'sh-1', 1, ['food']],
      ['Waiter', 'sh-new', 1, ['food']],
      ['Cook', 'sh-new', 2, []],
    ]);
    expect(screen.getByTestId('vacancies-otp-sent')).toHaveTextContent(/one code to Shankar \(\*\*\*\*\*\*3310\) for all 3 vacancies/);
  });

  it('a server refusal for one card (legal minimum) shows that card\'s warning and tick, not a raw message', async () => {
    const { route } = routeTable({
      '/screens/field-selling/businesses/biz-1': business,
      '/trades': [],
      '/businesses/biz-1/shifts': [morning],
      'POST /vacancies/batch': () => ({
        status: 400,
        body: { statusCode: 400, message: 'below', details: { code: 'MINIMUM_WAGE_TICK_REQUIRED', legalMinimumPaise: 2828547, vacancyIndex: 0 } },
      }),
    });
    await renderWithApp(<AddVacancyScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('role'));
    await pick('role', '__other__');
    await fireEvent.changeText(screen.getByTestId('other-trade'), 'Field Agent');
    await pick('experience', '0');
    await fireEvent.changeText(screen.getByTestId('salary-min'), '20000');
    await waitFor(() => screen.getByTestId('shift-sh-1'));
    await fireEvent.press(screen.getByTestId('shift-sh-1'));
    await pickDate();
    await fireEvent.press(screen.getByTestId('save-vacancy'));
    await waitFor(() => screen.getByTestId('below-minimum'));
    expect(screen.getByTestId('below-minimum')).toHaveTextContent(/₹28,285/);
    expect(screen.getByTestId('owner-told')).toBeTruthy();
    expect(screen.queryByTestId('error-banner')).toBeNull();
  });

  it('the quick form maps onto the API in paise', () => {
    const form = { ...EMPTY_VACANCY, trade: 'Cook', experience: '0', salaryMinPaise: 1600000, businessShiftId: 'sh-1', startDate: '2026-11-12' };
    expect(vacancyErrors(form, undefined)).toEqual([]);
    expect(vacancyErrors({ ...form, businessShiftId: '' }, undefined)).toEqual(['shift']);
    expect(vacancyErrors({ ...form, businessShiftId: '', shiftStart: '18:00', shiftEnd: '23:00' }, undefined)).toEqual([]);
    expect(vacancyErrors({ ...form, businessShiftId: '', shiftStart: '18:00', shiftEnd: '18:00' }, undefined)).toEqual(['shift']);
    expect(vacancyErrors({ ...form, experience: '' }, undefined)).toEqual(['experience']);
    expect(vacancyErrors({ ...form, note: 'x'.repeat(501) }, undefined)).toEqual(['note']);
    expect(vacancyBody('b', form)).toMatchObject({ businessShiftId: 'sh-1', experienceRequiredYears: 0 });
    expect(vacancyBody('b', form)).not.toHaveProperty('shift');
    expect(vacancyBody('b', form)).not.toHaveProperty('description');
    expect(vacancyRow({ ...form, note: '  Bed  ' }, 'sh-9')).toMatchObject({ businessShiftId: 'sh-9', description: 'Bed' });
    expect(vacancyErrors({ ...form, salaryMaxPaise: 100 }, undefined)).toEqual(['salaryOrder']);
    expect(vacancyBody('b', form)).not.toHaveProperty('salaryMaxPaise');
    expect(anotherShift({ ...form, headcount: '3', extras: ['food'] })).toMatchObject({ trade: 'Cook', headcount: '1', businessShiftId: '', extras: ['food'] });
  });
  it('26 Nov: a typed trade is checked against the unskilled figure; the server\'s answer wins', () => {
    const cook = { ...waiter, id: 't-2', name: 'Cook', minimumWageLevel: 'skilled', legalMinimumPaise: 2900000 };
    expect(legalMinimumFor([waiter, cook], 'Field Agent')).toBe(2340000);
    expect(legalMinimumFor([waiter, cook], 'cook')).toBe(2900000);
    expect(legalMinimumFor([waiter], 'Field Agent', { trade: 'field agent', legalMinimumPaise: 2828547 })).toBe(2828547);
    expect(legalMinimumFor([waiter], 'Cook', { trade: 'Field Agent', legalMinimumPaise: 2828547 })).toBe(2340000);
    const form = { ...EMPTY_VACANCY, trade: '__other__', otherTrade: 'Field Agent', experience: '0', salaryMinPaise: 2000000, businessShiftId: 'sh-1', startDate: '2026-11-30' };
    expect(vacancyErrors(form, legalMinimumFor([waiter], 'Field Agent'))).toEqual(['ownerTold']);
    expect(vacancyErrors({ ...form, ownerTold: true }, legalMinimumFor([waiter], 'Field Agent'))).toEqual([]);
  });
});
