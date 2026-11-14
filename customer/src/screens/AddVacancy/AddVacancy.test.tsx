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
});

describe('Add a vacancy', () => {
  it('warns below the legal minimum and needs the tick; saves a draft, then confirms by OTP', async () => {
    const api = fakeApi({
      createVacancy: async () => ({ id: 'v-9', code: null, trade: 'Cook', roleTitle: null, openings: 1, salaryMinPaise: 2_000_000, salaryMaxPaise: null, salaryPeriod: 'monthly', status: 'awaiting_otp', belowLegalMinimum: true }),
      sendVacancyOtp: async () => ({ requestId: 'vreq' }),
      confirmVacancy: async () => ({ id: 'v-9', code: 'VC-0100', trade: 'Cook', roleTitle: null, openings: 1, salaryMinPaise: 2_000_000, salaryMaxPaise: null, salaryPeriod: 'monthly', status: 'waiting_for_visit', belowLegalMinimum: true }),
    });
    await renderWithApp(<AddVacancy />, { api, account: owner });
    await choose('vacancy-trade', 'Cook');
    await fireEvent.changeText(screen.getByTestId('vacancy-salary-min'), '20000');
    expect(screen.getByTestId('vacancy-min-wage')).toHaveTextContent(/legal minimum for this work is about ₹25,700 a month/);
    await choose('vacancy-shift', 'day');
    await fireEvent.press(screen.getByTestId('vacancy-start'));
    await fireEvent.press(screen.getByTestId(`vacancy-start-day-${todayKeyIst()}`));
    await fireEvent.press(screen.getByTestId('vacancy-save'));
    expect(screen.getByTestId('vacancy-min-wage-error')).toBeTruthy();
    expect(api.createVacancy).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('vacancy-min-wage-tick'));
    await fireEvent.press(screen.getByTestId('vacancy-save'));
    await waitFor(() =>
      expect(api.createVacancy).toHaveBeenCalledWith('p-biz', expect.objectContaining({ trade: 'Cook', salaryMinPaise: 2_000_000, legalMinimumAcknowledged: true, shift: 'day' })),
    );
    await fireEvent.press(await screen.findByTestId('vacancy-send-otp'));
    expect(api.sendVacancyOtp).toHaveBeenCalledWith('p-biz', 'v-9');
    await fireEvent.changeText(await screen.findByTestId('vacancy-code'), '123456');
    await waitFor(() => expect(api.confirmVacancy).toHaveBeenCalledWith('p-biz', 'v-9', { requestId: 'vreq', code: '123456' }));
    expect(await screen.findByTestId('vacancy-waiting-visit')).toHaveTextContent(/after the verification visit/);
    await fireEvent.press(screen.getByTestId('vacancy-home'));
    expect(router.replace).toHaveBeenCalledWith('/home');
  });

  it('opens straight at the OTP step for a draft from registration', async () => {
    searchParams.current = { vacancyId: 'v-1' };
    const api = fakeApi({ sendVacancyOtp: async () => ({ requestId: 'r' }) });
    await renderWithApp(<AddVacancy />, { api, account: owner });
    await fireEvent.press(await screen.findByTestId('vacancy-send-otp'));
    expect(api.sendVacancyOtp).toHaveBeenCalledWith('p-biz', 'v-1');
  });

  it('needs a business profile', async () => {
    await renderWithApp(<AddVacancy />, { account: account({ profiles: [jsProfile] }) });
    expect(await screen.findByText(/Pick your business profile first/)).toBeTruthy();
  });
});
