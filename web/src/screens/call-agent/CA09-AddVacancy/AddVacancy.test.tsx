import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi, renderScreen, signInAs } from '../../../test/utils';
import AddVacancy from './index';
import { EMPTY_VACANCY, vacancyBody, type VacancyForm } from './payload';

const NOW = new Date('2026-11-11T05:30:00Z');
const cook = { id: 't1', name: 'Cook', salaryMinPaise: 1800000, salaryMaxPaise: 3000000, minimumWageLevel: 'unskilled', legalMinimumPaise: 2340000 };
const hotel = { id: 'b1', code: 'BZ-00318', name: 'Sri Sai Hotel', locality: 'HSR Layout', verificationStatus: 'verified', canShowCandidates: true, contactName: 'Shankar', contactRole: 'owner', branches: [] };
const morning = { id: 'sh-1', name: 'Morning', startTime: '07:00', endTime: '15:00', label: 'Morning 07:00–15:00', category: 'day' };
const form: VacancyForm = {
  ...EMPTY_VACANCY,
  business: hotel,
  trade: 'Cook',
  roleTitle: 'South Indian cook',
  headcount: '2',
  salaryMinPaise: 1800000,
  salaryMaxPaise: 2200000,
  businessShiftId: 'sh-1',
  startsAt: '07:00',
  endsAt: '16:00',
  weeklyOff: 'monday',
  experience: '2',
  startDate: '2026-11-16',
  extras: ['food', 'overtime'],
  interviewDate: '2026-11-12',
};

describe('Add a vacancy (CA09)', () => {
  it('needs the legal minimum wage tick, saves, then the owner confirms with the code read out', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      'GET /trades': [cook],
      'GET /businesses/b1/shifts': [morning],
      'POST /vacancies': { id: 'v1', code: 'VC-00071', status: 'awaiting_confirmation' },
      'POST /vacancies/v1/confirmation/send-code': { otpRequestId: 'otp-v', sentToLast4: '4321', contactName: 'Shankar Rao' },
      'POST /vacancies/v1/confirm': { status: 'open' },
    });
    signInAs('call_agent');
    sessionStorage.setItem('laboura.draft.vacancy.staff-ca', JSON.stringify(form));
    renderScreen(<AddVacancy />, { portal: 'call-agent', path: '/call-agent/vacancies/new', now: NOW });
    expect(await screen.findByText('Below the legal minimum wage.')).toBeInTheDocument();
    // Rev 193: the legal minimum shown is the one for the chosen business's zone.
    expect(api.calls('GET /trades').some((c) => c.query.get('businessId') === 'b1')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Save vacancy' }));
    expect(screen.getByText('Tick this after telling the owner.')).toBeInTheDocument();
    expect(api.calls('POST /vacancies')).toHaveLength(0);
    await user.click(screen.getByLabelText('Owner told about the legal minimum wage'));
    await user.click(screen.getByRole('button', { name: 'Save vacancy' }));
    await waitFor(() => expect(api.calls('POST /vacancies')).toHaveLength(1));
    expect(api.calls('POST /vacancies')[0].body).toMatchObject({
      businessId: 'b1', tradeSkill: 'Cook', headcount: 2, salaryMinPaise: 1800000, salaryMaxPaise: 2200000, salaryPeriod: 'monthly',
      ownerToldMinimumWage: true, businessShiftId: 'sh-1', workingHours: '07:00–16:00', weeklyOff: 'monday', experienceRequiredYears: 2,
      startDate: '2026-11-16', extras: ['food', 'overtime'], interviewType: 'walk_in', walkInDate: '2026-11-12',
    });
    expect(await screen.findByText(/Vacancy saved · VC-00071 · Sri Sai Hotel/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send code to the owner' }));
    expect(await screen.findByText(/sent to Shankar Rao \(\*\*\*\*\*\*4321\)/)).toBeInTheDocument();
    await user.click(screen.getByLabelText('Digit 1 of 6'));
    await user.paste('123456');
    await waitFor(() => expect(api.calls('POST /vacancies/v1/confirm')[0]?.body).toEqual({ otpRequestId: 'otp-v', code: '123456', method: 'code_on_call' }));
    expect(await screen.findByText(/Confirmed by Shankar Rao/)).toBeInTheDocument();
  });

  it('can send the owner a confirmation link instead', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      'GET /trades': [cook],
      'GET /businesses/b1/shifts': [morning],
      'POST /vacancies': { id: 'v1', code: 'VC-00071' },
      'POST /vacancies/v1/confirmation-link': { success: true, expiresAt: '2026-11-13T05:30:00Z', sentToLast4: '4321' },
    });
    signInAs('call_agent');
    sessionStorage.setItem('laboura.draft.vacancy.staff-ca', JSON.stringify({ ...form, salaryMinPaise: 2500000, salaryMaxPaise: 2800000 }));
    renderScreen(<AddVacancy />, { portal: 'call-agent', path: '/call-agent/vacancies/new', now: NOW });
    await user.click(await screen.findByRole('button', { name: 'Save vacancy' }));
    await user.click(await screen.findByRole('button', { name: 'Send a link instead' }));
    await waitFor(() => expect(api.calls('POST /vacancies/v1/confirmation-link')).toHaveLength(1));
    expect(await screen.findByText(/Confirmation link sent to \*\*\*\*\*\*4321/)).toBeInTheDocument();
  });

  it('finishes a staff-needed draft and submits it for the owner’s confirmation', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      'GET /trades': [cook],
      'GET /vacancies/v9': {
        id: 'v9', code: 'VC-00090', tradeSkill: 'Cook', headcount: 2, salaryMinPaise: 2500000, salaryMaxPaise: 2800000, salaryPeriod: 'monthly', shift: 'day',
        startDate: '2026-11-16T00:00:00.000Z', status: 'draft',
        business: { id: 'b1', code: 'BZ-00318', name: 'Annapoorna Mess', locality: 'BTM', verificationStatus: 'lead', inPersonOnboardedAt: null },
      },
      'GET /businesses/b1/shifts': [morning],
      'PATCH /vacancies/v9': {},
      'POST /vacancies/v9/submit-for-confirmation': { id: 'v9', code: 'VC-00090' },
    });
    signInAs('call_agent');
    renderScreen(<AddVacancy />, { portal: 'call-agent', path: '/call-agent/vacancies/new?draft=v9', now: NOW });
    expect(await screen.findByRole('heading', { name: 'Finish the vacancy' })).toBeInTheDocument();
    expect(await screen.findByText(/Annapoorna Mess · BTM · not verified yet/)).toBeInTheDocument();
    // The draft's old shift word shows until a business shift is picked; picking one fills the working hours.
    expect(await screen.findByText('Shift written earlier: day')).toBeInTheDocument();
    await user.selectOptions(await screen.findByTestId('vacancy-shift'), 'sh-1');
    expect(screen.getByLabelText(/^Starts/)).toHaveValue('07:00');
    expect(screen.getByLabelText(/^Ends/)).toHaveValue('15:00');
    await user.selectOptions(screen.getByLabelText(/Weekly off/), 'sunday');
    await user.selectOptions(screen.getByLabelText(/Experience needed/), '1');
    await user.click(screen.getByRole('button', { name: 'Save vacancy' }));
    await waitFor(() => expect(api.calls('POST /vacancies/v9/submit-for-confirmation')).toHaveLength(1));
    expect(api.calls('PATCH /vacancies/v9')[0].body).toMatchObject({ businessShiftId: 'sh-1', workingHours: '07:00–15:00', weeklyOff: 'sunday', startDate: '2026-11-16T00:00:00.000Z' });
    expect(await screen.findByText(/Vacancy saved · VC-00090/)).toBeInTheDocument();
  });

  it('17 Nov: a business with no shifts yet: the call agent adds one on the form and the vacancy picks it', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      'GET /trades': [cook],
      'GET /businesses/b1/shifts': [],
      'POST /businesses/b1/shifts': { ...morning, id: 'sh-9', name: 'Night', startTime: '22:00', endTime: '06:00', label: 'Night 22:00–06:00', category: 'night' },
      'POST /vacancies': { id: 'v1', code: 'VC-00071', status: 'awaiting_confirmation' },
    });
    signInAs('call_agent');
    sessionStorage.setItem('laboura.draft.vacancy.staff-ca', JSON.stringify({ ...form, businessShiftId: '', salaryMinPaise: 2500000, salaryMaxPaise: 2800000 }));
    renderScreen(<AddVacancy />, { portal: 'call-agent', path: '/call-agent/vacancies/new', now: NOW });
    expect(await screen.findByTestId('vacancy-shift-none')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^Shift name/), 'Night');
    await user.type(screen.getByLabelText(/^Shift starts/), '22:00');
    await user.type(screen.getByLabelText(/^Shift ends/), '06:00');
    await user.click(screen.getByRole('button', { name: 'Save shift' }));
    await waitFor(() => expect(api.calls('POST /businesses/b1/shifts')[0]?.body).toEqual({ name: 'Night', startTime: '22:00', endTime: '06:00' }));
    await user.click(screen.getByRole('button', { name: 'Save vacancy' }));
    await waitFor(() => expect(api.calls('POST /vacancies')).toHaveLength(1));
    expect(api.calls('POST /vacancies')[0].body).toMatchObject({ businessShiftId: 'sh-9' });
  });

  it('the legal minimum warning names the business\'s zone, not Bengaluru, outside Zone 1', async () => {
    mockApi({ 'GET /trades': [{ ...cook, zone: 2, legalMinimumPaise: 2340000 }], 'GET /businesses/b1/shifts': [morning] });
    signInAs('call_agent');
    sessionStorage.setItem('laboura.draft.vacancy.staff-ca', JSON.stringify(form));
    renderScreen(<AddVacancy />, { portal: 'call-agent', path: '/call-agent/vacancies/new', now: NOW });
    expect(await screen.findByText(/The legal minimum for this trade in this area \(Zone 2\) is about ₹23,400 a month/)).toBeInTheDocument();
    expect(screen.queryByText(/Bengaluru’s legal minimum/)).not.toBeInTheDocument();
  });

  it('books a fixed-time interview as one slot in IST', () => {
    const body = vacancyBody({ ...form, interviewType: 'scheduled', slotStart: '11:00', slotEnd: '13:00' }, 'Cook');
    expect(body).toMatchObject({ interviewType: 'scheduled', interviewSlots: [{ startsAt: '2026-11-12T05:30:00.000Z', endsAt: '2026-11-12T07:30:00.000Z' }] });
    expect(body).not.toHaveProperty('walkInDate');
  });
});
