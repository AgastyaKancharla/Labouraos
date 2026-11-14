import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { todayKeyIst } from '@/components/form';
import { openSecureSheet } from '@/sheet/openSheet';
import { account, jsProfile } from '@/test/fixtures';
import { fakeApi, renderWithApp } from '@/test/render';
import { checkAge, emptyJobSeeker, salaryHint, validateJobSeeker } from './form';
import RegisterJobSeeker from './index';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));
jest.mock('@/sheet/openSheet', () => ({ openSecureSheet: jest.fn(async () => 'returned') }));

beforeEach(() => jest.clearAllMocks());

const today = todayKeyIst();
const month = today.slice(5, 7);

async function pickDob(year: number, day = '10') {
  await fireEvent.press(screen.getByTestId('js-dob'));
  await fireEvent.press(screen.getByTestId(`js-dob-year-${year}`));
  await fireEvent.press(screen.getByTestId(`js-dob-day-${year}-${month}-${day}`));
}

async function choose(testID: string, value: string) {
  await fireEvent.press(screen.getByTestId(testID));
  await fireEvent.press(screen.getByTestId(`${testID}-option-${value}`));
}

describe('job seeker form rules', () => {
  it('stops under 18 and lets 18 through (to the day)', () => {
    expect(checkAge('', '2026-11-14')).toBe('missing');
    expect(checkAge('2008-11-15', '2026-11-14')).toBe('under18');
    expect(checkAge('2008-11-14', '2026-11-14')).toBe('ok');
  });

  it('requires the agent form fields and a sensible salary range', () => {
    const errors = validateJobSeeker({ ...emptyJobSeeker('en'), salaryMinPaise: 2_000_000, salaryMaxPaise: 1_000_000 });
    expect(Object.keys(errors)).toEqual(
      expect.arrayContaining(['fullName', 'gender', 'bestTimeToCall', 'area', 'pincode', 'travelKm', 'trade0', 'years0', 'availableFrom', 'lookingFor', 'shift', 'jobType', 'languagesSpoken', 'salaryMax']),
    );
    expect(errors.salaryMax).toBe('jobSeeker.maxBelowMin');
  });

  it('warns when the minimum is above the market range (monthly only)', () => {
    const cook = { id: 't', name: 'Cook', salaryMinPaise: 1_600_000, salaryMaxPaise: 2_600_000, legalMinimumPaise: 0 };
    expect(salaryHint(cook, { salaryMinPaise: 3_000_000, salaryPeriod: 'monthly' })?.aboveRange).toBe(true);
    expect(salaryHint(cook, { salaryMinPaise: 2_000_000, salaryPeriod: 'monthly' })?.aboveRange).toBe(false);
    expect(salaryHint(cook, { salaryMinPaise: 3_000_000, salaryPeriod: 'daily' })).toBeNull();
  });
});

describe('Register a job seeker', () => {
  it('asks the date of birth first and stops politely under 18, keeping nothing', async () => {
    const api = fakeApi();
    await renderWithApp(<RegisterJobSeeker />, { api, account: account() });
    await screen.findByTestId('js-age');
    const year = Number(today.slice(0, 4)) - 17;
    await pickDob(year);
    await fireEvent.press(screen.getByTestId('js-age-continue'));
    expect(screen.getByTestId('js-under18')).toHaveTextContent(/18 or older/);
    expect(screen.queryByTestId('js-form')).toBeNull();
    expect(api.registerJobSeeker).not.toHaveBeenCalled();
  });

  it('shows every missing field and sends nothing', async () => {
    const api = fakeApi();
    await renderWithApp(<RegisterJobSeeker />, { api, account: account() });
    await screen.findByTestId('js-age');
    await pickDob(1995);
    await fireEvent.press(screen.getByTestId('js-age-continue'));
    await screen.findByTestId('js-form');
    await fireEvent.press(screen.getByTestId('js-submit'));
    expect(screen.getByTestId('js-errors')).toHaveTextContent('Please fix the fields marked in red.');
    expect(screen.getByTestId('js-gender-error')).toBeTruthy();
    expect(screen.getByTestId('js-area-error')).toBeTruthy();
    expect(api.registerJobSeeker).not.toHaveBeenCalled();
  });

  it('sends the filled form, then offers the secure steps (consent → selfie → ID → ₹499)', async () => {
    const api = fakeApi({
      registerJobSeeker: async () => ({ profile: { ...jsProfile, code: 'JS-2001' }, existing: false }),
      sheetLink: async () => ({ url: 'https://app.test/p/register/tok' }),
    });
    await renderWithApp(<RegisterJobSeeker />, { api, account: account() });
    await screen.findByTestId('js-age');
    await pickDob(1995);
    await fireEvent.press(screen.getByTestId('js-age-continue'));
    await screen.findByTestId('js-form');

    await fireEvent.changeText(screen.getByTestId('js-name'), 'Ravi Kumar');
    await fireEvent.press(screen.getByTestId('js-gender-male'));
    await choose('js-best-time', 'evening');
    await fireEvent.press(screen.getByTestId('js-languages-add'));
    await fireEvent.press(screen.getByTestId('js-languages-option-kannada'));
    await choose('js-area', 'BTM Layout');
    expect(screen.getByTestId('js-pincode').props.value).toBe('560076');
    await choose('js-travel', '10');
    await choose('js-trade-0', 'Cook');
    await fireEvent.changeText(screen.getByTestId('js-years-0'), '5');
    await fireEvent.press(screen.getByTestId('js-available'));
    await fireEvent.press(screen.getByTestId(`js-available-day-${today}`));
    await choose('js-looking', 'under_1_month');
    await choose('js-shift', 'day');
    await choose('js-job-type', 'full_time');
    await fireEvent.changeText(screen.getByTestId('js-salary-min'), '30000');
    await fireEvent.changeText(screen.getByTestId('js-salary-max'), '32000');
    expect(screen.getByTestId('js-salary-hint')).toHaveTextContent('Usual pay for Cook in Bengaluru: ₹16,000 to ₹26,000 a month.');
    expect(screen.getByTestId('js-salary-warning')).toHaveTextContent(/₹26,000 or more counts as suitable/);

    await fireEvent.press(screen.getByTestId('js-submit'));
    await waitFor(() => expect(api.registerJobSeeker).toHaveBeenCalled());
    expect(api.registerJobSeeker.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        fullName: 'Ravi Kumar',
        dateOfBirth: `1995-${month}-10`,
        gender: 'male',
        area: 'BTM Layout',
        pincode: '560076',
        travelKm: 10,
        trades: [{ trade: 'Cook', years: 5 }],
        salaryMinPaise: 3_000_000,
        salaryMaxPaise: 3_200_000,
        salaryPeriod: 'monthly',
        languagesSpoken: ['kannada'],
        heardFrom: 'laboura_app',
      }),
    );
    const saved = await screen.findByTestId('js-saved');
    expect(within(saved).getByText('Your Laboura ID is JS-2001.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('js-saved-continue'));
    await waitFor(() => expect(api.sheetLink).toHaveBeenCalledWith('p-js', 'registration', undefined));
    expect(openSecureSheet).toHaveBeenCalledWith('https://app.test/p/register/tok');
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/home'));
  });
});
