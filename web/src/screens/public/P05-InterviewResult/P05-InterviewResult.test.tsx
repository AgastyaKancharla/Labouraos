import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockApi, renderScreen } from '../../../test/utils';
import InterviewResult from './index';

const details = {
  candidateFirstName: 'Ramesh', businessName: 'Sri Sai Hotel', job: 'Electrician', slotStartsAt: '2026-11-11T05:00:00Z',
  slotEndsAt: '2026-11-11T12:30:00Z', resultDueAt: '2026-11-11T14:30:00Z', vacancySalaryMinPaise: 1600000, maskedPhone: '******8812',
  awaitingResult: true, reasons: ['skills', 'experience', 'communication', 'salary_expectation', 'not_suitable', 'other'], language: null,
};
const render = () => renderScreen(<InterviewResult />, { portal: 'public', path: '/p/interview-result/rtok', route: '/p/interview-result/:token', now: new Date('2026-11-11T13:00:00Z') });

async function typeCode() {
  await userEvent.click(screen.getByRole('button', { name: 'Send code to ******8812' }));
  await userEvent.click(screen.getAllByRole('textbox').find((el) => el.getAttribute('inputmode') === 'numeric' && el.closest('.lb-otp'))!);
  await userEvent.paste('441072');
}

describe('P05-InterviewResult', () => {
  it('records "selected" with the salary in rupees (sent as paise) and goes on to pay the fee', async () => {
    const api = mockApi({
      'GET /interviews/result/rtok': details,
      'POST /interviews/result/rtok/otp': { requestId: 'rreq', phone: '******8812' },
      'POST /interviews/result/rtok': { status: 'completed', result: 'selected', placement: { payment: { upiReference: 'PAY-9-ab' } } },
    });
    const { container } = render();
    expect(await screen.findByRole('heading', { name: "How did Ramesh's interview go?" })).toBeInTheDocument();
    expect(screen.getByText(/at Sri Sai Hotel · please answer by 8:00 pm/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/request id/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Selected' }));
    const salary = screen.getByRole('textbox', { name: /Monthly salary you'll pay/ });
    await userEvent.type(salary, '16000');
    expect(salary).toHaveValue('16,000');
    const joining = container.querySelector('input[type="date"]') as HTMLInputElement;
    await userEvent.type(joining, '2026-11-16');
    await typeCode();
    await userEvent.click(screen.getByRole('button', { name: 'Submit result' }));
    expect(api.calls('POST /interviews/result/rtok')[0]!.body).toEqual({
      otpRequestId: 'rreq', otpCode: '441072', result: 'selected', selectedSalaryPaise: 1600000, selectedJoiningDate: '2026-11-16',
    });
    expect(await screen.findByTestId('navigated-away')).toBeInTheDocument();
  });

  it('records "not selected" with a reason from the list', async () => {
    const api = mockApi({
      'GET /interviews/result/rtok': details,
      'POST /interviews/result/rtok/otp': { requestId: 'rreq', phone: '******8812' },
      'POST /interviews/result/rtok': { status: 'completed', result: 'not_selected', placement: null },
    });
    render();
    await userEvent.click(await screen.findByRole('radio', { name: 'Not selected (pick a reason)' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /Reason/ }), 'experience');
    await typeCode();
    await userEvent.click(screen.getByRole('button', { name: 'Submit result' }));
    expect(api.calls('POST /interviews/result/rtok')[0]!.body).toEqual({ otpRequestId: 'rreq', otpCode: '441072', result: 'not_selected', resultReason: 'experience' });
    expect(await screen.findByText('Thank you — your answer is recorded')).toBeInTheDocument();
  });

  it('records a no-show', async () => {
    const api = mockApi({
      'GET /interviews/result/rtok': details,
      'POST /interviews/result/rtok/otp': { requestId: 'rreq', phone: '******8812' },
      'POST /interviews/result/rtok': { status: 'no_show', result: 'candidate_no_show', placement: null },
    });
    render();
    await userEvent.click(await screen.findByRole('radio', { name: "Ramesh didn't come" }));
    await typeCode();
    await userEvent.click(screen.getByRole('button', { name: 'Submit result' }));
    expect(api.calls('POST /interviews/result/rtok')[0]!.body).toEqual({ otpRequestId: 'rreq', otpCode: '441072', result: 'candidate_no_show' });
  });

  it('says when the result is already recorded', async () => {
    mockApi({ 'GET /interviews/result/rtok': { ...details, awaitingResult: false } });
    render();
    expect(await screen.findByText(/already recorded/)).toBeInTheDocument();
  });
});
