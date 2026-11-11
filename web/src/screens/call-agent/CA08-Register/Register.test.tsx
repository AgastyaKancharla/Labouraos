import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiError, mockApi, renderScreen, signInAs } from '../../../test/utils';
import RegisterJobSeeker from './index';
import { createBody, EMPTY_FORM, profileBody, validate, type JobSeekerForm } from './payload';

const NOW = new Date('2026-11-11T05:30:00Z');
const housekeeping = { id: 't1', name: 'Housekeeping', salaryMinPaise: 1600000, salaryMaxPaise: 2300000, minimumWageLevel: 'unskilled', legalMinimumPaise: 2340000 };
const painter = { id: 't2', name: 'Painter', salaryMinPaise: 1800000, salaryMaxPaise: 2800000, minimumWageLevel: 'skilled', legalMinimumPaise: 2830000 };

const filled: JobSeekerForm = {
  ...EMPTY_FORM,
  name: 'Kavya Reddy',
  mobile: '9845012345',
  dateOfBirth: '1998-03-14',
  gender: 'female',
  messageLanguage: 'kn',
  bestTime: '15-18',
  heardFrom: 'toll_free_missed_call',
  place: { area: 'BTM Layout 2nd Stage', pincode: '560076', latitude: 12.9166, longitude: 77.6101 },
  travelKm: '8',
  preferredAreas: ['JP Nagar'],
  trades: [
    { trade: 'Housekeeping', other: '', years: '3' },
    { trade: '__other__', other: 'Laundry / ironing', years: '2' },
  ],
  lookingSince: '2026-10-01',
  minSalaryPaise: 1300000,
  maxSalaryPaise: 1600000,
  availableFrom: '2026-11-12',
  shift: 'day',
  jobType: 'full_time',
  spoken: ['Kannada', 'Hindi'],
  smartphone: true,
};

function routes(overrides: Record<string, unknown> = {}) {
  return {
    'GET /trades': [housekeeping, painter],
    'GET /screens/call-registration/options': {
      city: 'Bengaluru',
      areas: [
        { name: 'BTM Layout 2nd Stage', pincode: '560076', latitude: 12.9166, longitude: 77.6101 },
        { name: 'JP Nagar', pincode: '560078', latitude: 12.9063, longitude: 77.5857 },
      ],
    },
    'POST /otp/send': { success: true, requestId: 'otp-1' },
    'POST /otp/verify': { verified: true, requestId: 'otp-1' },
    ...overrides,
  };
}

function seedDraft(form: JobSeekerForm) {
  sessionStorage.setItem('laboura.draft.job-seeker.staff-ca', JSON.stringify(form));
}

async function verifyMobile(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Send OTP' }));
  await screen.findByText('Code sent to ******2345');
  await user.click(screen.getByLabelText('Digit 1 of 6'));
  await user.paste('552901');
  expect(await screen.findByText('✓ Verified')).toBeInTheDocument();
}

describe('Register a job seeker (CA08)', () => {
  it('keeps Save locked until the mobile number is checked by OTP', async () => {
    mockApi(routes());
    signInAs('call_agent');
    renderScreen(<RegisterJobSeeker />, { portal: 'call-agent', path: '/call-agent/register/job-seeker', now: NOW });
    expect(await screen.findByRole('heading', { name: 'Register a job seeker' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save job seeker' })).toBeDisabled();
    expect(screen.getByText(/Verify the mobile number first/)).toBeInTheDocument();
  });

  it('sends every field the API requires, then the optional extras, and opens the step panel', async () => {
    const user = userEvent.setup();
    const api = mockApi(
      routes({
        'POST /job-seekers': { id: 'js-uuid', code: 'JS-01042' },
        'PATCH /job-seekers/js-uuid/profile': { id: 'js-uuid' },
      }),
    );
    signInAs('call_agent');
    seedDraft(filled);
    renderScreen(<RegisterJobSeeker />, { portal: 'call-agent', path: '/call-agent/register/job-seeker', now: NOW });
    expect(await screen.findByText(/Draft restored/)).toBeInTheDocument();
    await verifyMobile(user);
    expect(await screen.findByText(/Housekeeping in Bengaluru usually earns ₹16,000–₹23,000 a month/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save job seeker' }));

    await waitFor(() => expect(api.calls('POST /job-seekers')).toHaveLength(1));
    expect(api.calls('POST /job-seekers')[0].body).toEqual({
      name: 'Kavya Reddy',
      phone: '9845012345',
      otpRequestId: 'otp-1',
      messageLanguage: 'kn',
      bestTimeToCall: '15-18',
      dateOfBirth: '1998-03-14',
      gender: 'female',
      heardFrom: 'toll_free_missed_call',
      locality: 'BTM Layout 2nd Stage',
      pincode: '560076',
      latitude: 12.9166,
      longitude: 77.6101,
      travelDistanceKm: 8,
      trades: [
        { trade: 'Housekeeping', yearsExperience: 3 },
        { trade: 'Laundry / ironing', yearsExperience: 2 },
      ],
      availableFrom: '2026-11-12',
      lookingSince: '2026-10-01',
      minSalary: 1300000,
      maxSalary: 1600000,
      salaryPeriod: 'monthly',
      shiftPreference: 'day',
      jobType: 'full_time',
      spokenLanguages: ['Kannada', 'Hindi'],
      city: 'Bengaluru',
    });
    await waitFor(() => expect(api.calls('PATCH /job-seekers/js-uuid/profile')).toHaveLength(1));
    expect(api.calls('PATCH /job-seekers/js-uuid/profile')[0].body).toMatchObject({
      whatsappPhone: '9845012345',
      preferredLocalities: ['JP Nagar'],
      hasSmartphone: true,
      reason: 'Filled on the registration form',
    });
    expect(await screen.findByTestId('navigated-away')).toBeInTheDocument();
    expect(sessionStorage.getItem('laboura.draft.job-seeker.staff-ca')).toBeNull();
  });

  it('shows "Already registered — open it" when the OTP send finds the number (CA08x)', async () => {
    const user = userEvent.setup();
    mockApi(
      routes({
        'POST /otp/send': { alreadyRegistered: true, type: 'job_seeker', code: 'JS-01042' },
        'GET /screens/call-registration/records/JS-01042': {
          type: 'job_seeker', id: 'js-uuid', code: 'JS-01042', name: 'Kavya Reddy', registeredAt: '2026-11-09T05:00:00Z', registeredBy: 'Deepa Nair',
        },
      }),
    );
    signInAs('call_agent');
    seedDraft(filled);
    renderScreen(<RegisterJobSeeker />, { portal: 'call-agent', path: '/call-agent/register/job-seeker', now: NOW });
    await user.click(await screen.findByRole('button', { name: 'Send OTP' }));
    await user.click(await screen.findByRole('button', { name: /Already registered — open it/ }));
    expect(await screen.findByText('This number is already registered')).toBeInTheDocument();
    expect(await screen.findByText(/registered 9 Nov 2026 by Deepa Nair/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Kavya’s record' })).toHaveAttribute('href', '/call-agent/register/job-seeker/js-uuid');
    await user.click(screen.getByRole('button', { name: 'Use a different number' }));
    expect(screen.getByRole('button', { name: 'Send OTP' })).toBeDisabled();
  });

  it('opens the existing record when the save itself answers 409 with existingJobSeekerCode', async () => {
    const user = userEvent.setup();
    mockApi(
      routes({
        'POST /job-seekers': {
          status: 409,
          body: { statusCode: 409, message: 'Already registered — open it.', details: { existingJobSeekerCode: 'JS-01042' } },
        },
        'GET /screens/call-registration/records/JS-01042': apiError(403, 'no'),
      }),
    );
    signInAs('call_agent');
    seedDraft(filled);
    renderScreen(<RegisterJobSeeker />, { portal: 'call-agent', path: '/call-agent/register/job-seeker', now: NOW });
    await verifyMobile(user);
    await user.click(screen.getByRole('button', { name: 'Save job seeker' }));
    expect(await screen.findByText('This number is already registered')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Already registered — open it/ })).toHaveAttribute('href', '/call-agent/register/job-seeker/JS-01042');
  });

  it('warns above the trade’s usual range and needs a decision before saving (CA08w)', async () => {
    const user = userEvent.setup();
    const api = mockApi(routes({ 'POST /job-seekers': { id: 'js-2', code: 'JS-01043' }, 'PATCH /job-seekers/js-2/profile': {} }));
    signInAs('call_agent');
    seedDraft({ ...filled, trades: [{ trade: 'Painter', other: '', years: '5' }], minSalaryPaise: 3000000, maxSalaryPaise: 4000000 });
    renderScreen(<RegisterJobSeeker />, { portal: 'call-agent', path: '/call-agent/register/job-seeker', now: NOW });
    await verifyMobile(user);
    const warning = await screen.findByText('⚠ Above the usual range.');
    const box = warning.closest('.warn') as HTMLElement;
    expect(within(box).getByText(/any offer of ₹28,000 or more as suitable/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save job seeker' }));
    expect(api.calls('POST /job-seekers')).toHaveLength(0);
    expect(screen.getByText(/update it or choose “Keep” first/)).toBeInTheDocument();
    await user.click(within(box).getByRole('button', { name: 'Keep ₹30,000 and continue' }));
    await user.click(screen.getByRole('button', { name: 'Save job seeker' }));
    await waitFor(() => expect(api.calls('POST /job-seekers')).toHaveLength(1));
  });

  it('marks missing required fields instead of sending', async () => {
    const user = userEvent.setup();
    const api = mockApi(routes());
    signInAs('call_agent');
    seedDraft({ ...EMPTY_FORM, mobile: '9845012345' });
    renderScreen(<RegisterJobSeeker />, { portal: 'call-agent', path: '/call-agent/register/job-seeker', now: NOW });
    await verifyMobile(user);
    await user.click(screen.getByRole('button', { name: 'Save job seeker' }));
    expect(await screen.findByText(/fields still need attention/)).toBeInTheDocument();
    expect(screen.getByText('Type the full name.')).toBeInTheDocument();
    expect(api.calls('POST /job-seekers')).toHaveLength(0);
  });
});

describe('job seeker payload', () => {
  it('lists every missing required field', () => {
    expect(validate(EMPTY_FORM)).toEqual(
      expect.arrayContaining(['name', 'dateOfBirth', 'gender', 'messageLanguage', 'bestTime', 'heardFrom', 'area', 'pincode', 'pin', 'travelKm', 'trade', 'lookingSince', 'minSalary', 'maxSalary', 'availableFrom', 'shift', 'jobType', 'spoken']),
    );
    expect(validate(filled)).toEqual([]);
    expect(validate({ ...filled, minSalaryPaise: 2000000, maxSalaryPaise: 1000000 })).toContain('salaryOrder');
    expect(validate({ ...filled, trades: [{ trade: 'Housekeeping', other: '', years: '1' }, { trade: 'Housekeeping', other: '', years: '2' }] })).toContain('duplicateTrade');
  });

  it('links a referral partner and sets how they heard to referral partner', () => {
    const body = createBody({ ...filled, referredBy: { id: 'ref-1', code: 'RF-00042', name: 'Raju' } }, 'otp-1');
    expect(body).toMatchObject({ referredById: 'ref-1', heardFrom: 'referral_partner' });
  });

  it('sends current salary instead of last salary when working now', () => {
    expect(profileBody({ ...filled, workingNow: 'yes', lastSalaryPaise: 1200000 })).toMatchObject({ currentlyWorking: true, currentSalaryPaise: 1200000 });
    expect(profileBody({ ...filled, workingNow: 'no', lastSalaryPaise: 1200000, noQualification: true })).toMatchObject({ lastSalaryPaise: 1200000, educationLevel: 'none' });
  });
});
