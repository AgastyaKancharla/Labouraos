import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { apiError, mockApi, renderScreen } from '../../../test/utils';
import VacancyConfirm from './index';

const details = {
  vacancyCode: 'VC-00031', status: 'awaiting_confirmation', maskedPhone: '******4321', sentToLast4: '4321',
  expiresAt: '2026-11-18T07:10:00Z', preferredLanguage: 'en', business: 'Sri Sai Bakery', trade: 'Baker', roleTitle: null,
  headcountCount: 2, headcount: '2', salaryMinPaise: 1500000, salaryMaxPaise: 1800000, salaryPeriod: 'monthly', shift: 'day', startDate: '2026-11-20',
};
const render = () => renderScreen(<VacancyConfirm />, { portal: 'public', path: '/p/vacancy-confirm/vtok', route: '/p/vacancy-confirm/:token' });

describe('P07-VacancyConfirm', () => {
  it('shows the vacancy (job, people, salary, shift, start date, business), confirms with the owner OTP, then says thank you', async () => {
    const api = mockApi({
      'GET /vacancy-confirm/vtok': details,
      'POST /vacancy-confirm/vtok/send-otp': { requestId: 'vreq', otpRequestId: 'vreq', phone: '******4321' },
      'POST /vacancy-confirm/vtok': { vacancyCode: 'VC-00031', status: 'open', confirmedAt: '2026-11-16T07:10:00Z' },
    });
    render();
    expect(await screen.findByRole('heading', { name: 'Confirm your vacancy · Sri Sai Bakery' })).toBeInTheDocument();
    expect(screen.getByText('Baker')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText(/₹15,000–18,000/)).toBeInTheDocument();
    expect(screen.getByText('day shift')).toBeInTheDocument();
    expect(screen.getByText('Fri, 20 Nov')).toBeInTheDocument();
    expect(screen.getByText('This link works until 18 Nov, 12:40 PM.')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Confirm vacancy' });
    expect(confirm).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Send code to ******4321' }));
    expect(confirm).toBeDisabled();
    await userEvent.click(screen.getAllByRole('textbox').find((el) => el.getAttribute('inputmode') === 'numeric')!);
    await userEvent.paste('802291');
    await userEvent.click(confirm);
    expect(api.calls('POST /vacancy-confirm/vtok')[0]!.body).toEqual({ otpRequestId: 'vreq', code: '802291' });
    expect(await screen.findByText('Confirmed, thank you')).toBeInTheDocument();
    expect(screen.getByText("We'll start finding 2 people for Baker. Your Laboura agent will be in touch.")).toBeInTheDocument();
  });

  it('a wrong code keeps the page and says so in the reader’s words', async () => {
    mockApi({
      'GET /vacancy-confirm/vtok': details,
      'POST /vacancy-confirm/vtok/send-otp': { requestId: 'vreq', phone: '******4321' },
      'POST /vacancy-confirm/vtok': apiError(400, 'Wrong or expired code'),
    });
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Send code to ******4321' }));
    await userEvent.click(screen.getAllByRole('textbox').find((el) => el.getAttribute('inputmode') === 'numeric')!);
    await userEvent.paste('111111');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm vacancy' }));
    expect(await screen.findByText(/That code is wrong or has run out/)).toBeInTheDocument();
    expect(screen.queryByText('Confirmed, thank you')).not.toBeInTheDocument();
  });

  it('a vacancy already confirmed (by code on the visit) says so, with no button', async () => {
    mockApi({ 'GET /vacancy-confirm/vtok': { ...details, status: 'open' } });
    render();
    expect(await screen.findByText('This vacancy is already confirmed. Thank you.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm vacancy' })).not.toBeInTheDocument();
  });

  it('opening the used link again explains it', async () => {
    mockApi({ 'GET /vacancy-confirm/vtok': apiError(400, 'Public link has already been used') });
    render();
    expect(await screen.findByText(/This link has already been used/)).toBeInTheDocument();
  });

  it('explains an expired link', async () => {
    mockApi({ 'GET /vacancy-confirm/vtok': apiError(400, 'Public link has expired') });
    render();
    expect(await screen.findByText(/This link has expired/)).toBeInTheDocument();
  });

  it('opens in the language the link was sent in (Kannada)', async () => {
    mockApi({ 'GET /vacancy-confirm/vtok': { ...details, preferredLanguage: 'kn' } });
    render();
    expect(await screen.findByRole('heading', { name: 'ನಿಮ್ಮ ಖಾಲಿ ಹುದ್ದೆ ದೃಢೀಕರಿಸಿ · Sri Sai Bakery' })).toBeInTheDocument();
  });
});
