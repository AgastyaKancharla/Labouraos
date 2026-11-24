import { legalMinimumOf } from '@/api/types';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { todayKeyIst } from '@/components/form';
import { formOptions, account, bizProfile, jsProfile } from '@/test/fixtures';
import { fakeApi, renderWithApp } from '@/test/render';
import { searchParams } from '@/test/expo-router-mock';
import { belowLegalMinimum } from './form';
import AddVacancy from './index';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

beforeEach(() => {
  jest.clearAllMocks();
  searchParams.current = {};
});

const cook = formOptions.trades[0];
const owner = account({ profiles: [bizProfile] });

async function choose(testID: string, value: string) {
  await fireEvent.press(screen.getByTestId(testID));
  await fireEvent.press(screen.getByTestId(`${testID}-option-${value}`));
}

describe('legal minimum wage', () => {
  it('compares monthly pay directly and daily pay over 26 days', () => {
    expect(belowLegalMinimum(cook, { salaryMinPaise: 2_000_000, salaryPeriod: 'monthly' })).toBe(true);
    expect(belowLegalMinimum(cook, { salaryMinPaise: 2_600_000, salaryPeriod: 'monthly' })).toBe(false);
    expect(belowLegalMinimum(cook, { salaryMinPaise: 100_000, salaryPeriod: 'daily' })).toBe(false); // ₹1,000 × 26 = ₹26,000
  });

  it('uses the figure for the business\'s minimum wage zone (rev 193), Zone 1 when not known', () => {
    const zoned = { ...cook, legalMinimumPaise: 2_828_547, legalMinimumPaiseByZone: { '1': 2_828_547, '2': 2_571_407, '3': 2_337_643 } };
    const pay = { salaryMinPaise: 2_600_000, salaryPeriod: 'monthly' as const };
    expect(legalMinimumOf(zoned, 2)).toBe(2_571_407);
    expect(legalMinimumOf(zoned, null)).toBe(2_828_547);
    expect(belowLegalMinimum(zoned, pay, 1)).toBe(true);
    expect(belowLegalMinimum(zoned, pay, 2)).toBe(false);
    expect(belowLegalMinimum(zoned, pay)).toBe(true);
  });
});

const morning = { id: 'sh-1', name: 'Morning', startTime: '07:00', endTime: '15:00', label: 'Morning 07:00–15:00', category: 'day' as const };

describe('Add a vacancy', () => {
  it('17 Nov: with no shifts yet the owner adds one right here and the vacancy picks it', async () => {
    const api = fakeApi({
      shifts: async () => [],
      addShift: async (_p: string, input: { name: string; startTime: string; endTime: string }) => ({ id: 'sh-7', ...input, label: `${input.name} ${input.startTime}–${input.endTime}`, category: 'night' as const }),
    });
    await renderWithApp(<AddVacancy />, { api, account: owner });
    await waitFor(() => screen.getByTestId('vacancy-add-shift'));
    await fireEvent.changeText(screen.getByTestId('vacancy-add-shift-name'), 'Night');
    await fireEvent.changeText(screen.getByTestId('vacancy-add-shift-start'), '22');
    await fireEvent.changeText(screen.getByTestId('vacancy-add-shift-end'), '6:00');
    await fireEvent.press(screen.getByTestId('vacancy-add-shift-save'));
    await waitFor(() => expect(api.addShift).toHaveBeenCalledWith('p-biz', { name: 'Night', startTime: '22:00', endTime: '06:00' }));
    await waitFor(() => expect(screen.getByTestId('vacancy-shift')).toHaveTextContent(/Night 22:00–06:00/));
  });


  it('warns below the legal minimum and needs the tick; saves a draft, then confirms by OTP', async () => {
    const api = fakeApi({
      shifts: async () => [morning],
      createVacancy: async () => ({ id: 'v-9', code: null, trade: 'Cook', roleTitle: null, openings: 1, salaryMinPaise: 2_000_000, salaryMaxPaise: null, salaryPeriod: 'monthly', status: 'draft', belowLegalMinimum: true }),
      sendStepUp: async () => ({ requestId: 'vreq' }),
      confirmVacancy: async () => ({ id: 'v-9', code: 'VC-0100', trade: 'Cook', roleTitle: null, openings: 1, salaryMinPaise: 2_000_000, salaryMaxPaise: null, salaryPeriod: 'monthly', status: 'waiting_for_visit', belowLegalMinimum: true }),
    });
    await renderWithApp(<AddVacancy />, { api, account: owner });
    await choose('vacancy-trade', 'Cook');
    await fireEvent.changeText(screen.getByTestId('vacancy-salary-min'), '20000');
    expect(screen.getByTestId('vacancy-min-wage')).toHaveTextContent(/legal minimum for this work is about ₹25,700 a month/);
    await waitFor(() => screen.getByTestId('vacancy-shift'));
    await choose('vacancy-shift', 'sh-1');
    await choose('vacancy-experience', '0');
    await fireEvent.press(screen.getByTestId('vacancy-start'));
    await fireEvent.press(screen.getByTestId(`vacancy-start-day-${todayKeyIst()}`));
    await fireEvent.press(screen.getByTestId('vacancy-save'));
    expect(screen.getByTestId('vacancy-min-wage-error')).toBeTruthy();
    expect(api.createVacancy).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('vacancy-min-wage-tick'));
    await fireEvent.press(screen.getByTestId('vacancy-save'));
    await waitFor(() =>
      expect(api.createVacancy).toHaveBeenCalledWith('p-biz', expect.objectContaining({ trade: 'Cook', salaryMinPaise: 2_000_000, legalMinimumAcknowledged: true, businessShiftId: 'sh-1', experienceYears: 0 })),
    );
    await fireEvent.press(await screen.findByTestId('vacancy-otp-card-send'));
    expect(api.sendStepUp).toHaveBeenCalledWith('confirm_vacancy', undefined);
    await fireEvent.changeText(await screen.findByTestId('vacancy-otp-card-code'), '123456');
    await waitFor(() => expect(api.confirmVacancy).toHaveBeenCalledWith('p-biz', 'v-9', { otp: { requestId: 'vreq', code: '123456' }, ownerToldMinimumWage: true }));
    expect(await screen.findByTestId('vacancy-waiting-visit')).toHaveTextContent(/after the verification visit/);
    await fireEvent.press(screen.getByTestId('vacancy-home'));
    expect(router.replace).toHaveBeenCalledWith('/home');
  });

  it('a draft from registration: OTP first; below the legal minimum the server asks for the tick, then it confirms', async () => {
    searchParams.current = { vacancyId: 'v-1' };
    const { ApiError } = require('@/api/errors');
    const confirmVacancy = jest
      .fn()
      .mockRejectedValueOnce(new ApiError({ status: 409, messages: ['tick'], body: { code: 'BELOW_MINIMUM_WAGE_TICK_REQUIRED', legalMinimumPaise: 2_340_000 } }))
      .mockResolvedValueOnce({ id: 'v-1', code: 'VC-0101', trade: '', openings: null, status: 'open', belowLegalMinimum: false });
    const api = fakeApi({ sendStepUp: async () => ({ requestId: 'r' }), confirmVacancy });
    await renderWithApp(<AddVacancy />, { api, account: owner });
    await fireEvent.press(await screen.findByTestId('vacancy-otp-card-send'));
    // One button (rev 193): no separate confirm button; typing the code confirms.
    expect(screen.queryByTestId('vacancy-otp-card-verify')).toBeNull();
    await fireEvent.changeText(await screen.findByTestId('vacancy-otp-card-code'), '123456');
    expect(await screen.findByTestId('vacancy-tick-needed')).toHaveTextContent(/about ₹23,400 a month/);
    expect(screen.getByTestId('vacancy-confirm-after-tick')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('vacancy-otp-tick'));
    await fireEvent.press(screen.getByTestId('vacancy-confirm-after-tick'));
    await waitFor(() => expect(confirmVacancy).toHaveBeenLastCalledWith('p-biz', 'v-1', { otp: null, ownerToldMinimumWage: true }));
    expect(await screen.findByTestId('vacancy-done')).toBeTruthy();
  });

  it('needs a business profile', async () => {
    await renderWithApp(<AddVacancy />, { account: account({ profiles: [jsProfile] }) });
    expect(await screen.findByText(/Pick your business profile first/)).toBeTruthy();
  });
});
