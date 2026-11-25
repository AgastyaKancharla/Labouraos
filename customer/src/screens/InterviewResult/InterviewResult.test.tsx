import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { ApiError } from '@/api/errors';
import { searchParams } from '@/test/expo-router-mock';
import { account, bizProfile } from '@/test/fixtures';
import { fakeApi, renderWithApp } from '@/test/render';
import { mockInterviewToken, mockStepsApi, onMockInterview } from '@/verify/mockSteps';
import type { StepsApi } from '@/verify/stepsApi';
import { StepsApiProvider } from '@/verify/StepsApiProvider';
import InterviewResultScreen from './index';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

const IV = 'iv-p-biz-1';
const results: [string, string, string | null][] = [];

function spiedSteps(): jest.Mocked<StepsApi> {
  onMockInterview(
    (id) => (id === IV ? { id, candidateFirstName: 'Ravi', businessName: 'Hotel Annapoorna', job: 'Cook', startsAt: '2026-11-26T06:30:00Z', endsAt: '2026-11-26T07:30:00Z', salaryMinPaise: 1_500_000 } : null),
    (id, result, reason) => void results.push([id, result, reason]),
  );
  const steps = mockStepsApi(0);
  for (const key of Object.keys(steps) as (keyof StepsApi)[]) jest.spyOn(steps, key);
  return steps as jest.Mocked<StepsApi>;
}

async function renderResult(steps: StepsApi, link?: () => Promise<{ url: string }>) {
  searchParams.current = { profileId: 'p-biz', interviewId: IV };
  const api = fakeApi({ interviewResultLink: link ?? (async () => ({ url: `https://app.test/p/interview-result/${mockInterviewToken(IV)}` })) });
  return renderWithApp(
    <StepsApiProvider api={steps}>
      <InterviewResultScreen />
    </StepsApiProvider>,
    { api, account: account({ profiles: [bizProfile] }), activeProfileId: 'p-biz' },
  );
}

async function confirmWithCode() {
  await fireEvent.press(screen.getByTestId('iv-result-otp-send'));
  await fireEvent.changeText(await screen.findByTestId('iv-result-otp-code'), '123456');
}

beforeEach(() => {
  jest.clearAllMocks();
  results.length = 0;
});

describe('Interview result in the app (26 Nov)', () => {
  it('happened → Selected with salary and joining date → code; "Pay now" shows but is switched off', async () => {
    const steps = spiedSteps();
    const { api } = await renderResult(steps);
    expect(await screen.findByTestId('iv-result-form')).toHaveTextContent(/Ravi · Cook interview/);
    expect(api.interviewResultLink).toHaveBeenCalledWith('p-biz', IV);

    // Nothing answered yet: the code is not sent.
    await fireEvent.press(screen.getByTestId('iv-result-otp-send'));
    expect(await screen.findByText('Answer the questions above first.')).toBeTruthy();
    expect(steps.sendInterviewResultOtp).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('iv-result-happened-yes'));
    await fireEvent.press(screen.getByTestId('iv-result-decision-selected'));
    expect(screen.getByTestId('iv-result-salary').props.value).toBe('15,000'); // starts at the vacancy's salary
    await fireEvent.changeText(screen.getByTestId('iv-result-salary'), '16000');
    await fireEvent.changeText(screen.getByTestId('iv-result-joining-type'), '15/01/2030');
    await confirmWithCode();
    await waitFor(() =>
      expect(steps.submitInterviewResult).toHaveBeenCalledWith(mockInterviewToken(IV), expect.stringMatching(/^otp-/), '123456', {
        result: 'selected',
        selectedSalaryPaise: 1_600_000,
        selectedJoiningDate: '2030-01-15T00:00:00.000Z',
      }),
    );
    expect(await screen.findByTestId('iv-result-done')).toHaveTextContent(/Ravi is selected/);
    expect(screen.getByTestId('iv-result-pay-now')).toBeDisabled();
    expect(results).toEqual([[IV, 'selected', null]]);
    await fireEvent.press(screen.getByTestId('iv-result-home'));
    expect(router.replace).toHaveBeenCalledWith('/home');
  });

  it('Not selected needs a reason; then "we will send more profiles"', async () => {
    const steps = spiedSteps();
    await renderResult(steps);
    await fireEvent.press(await screen.findByTestId('iv-result-happened-yes'));
    await fireEvent.press(screen.getByTestId('iv-result-decision-not_selected'));
    await fireEvent.press(screen.getByTestId('iv-result-reason-salary_expectation'));
    await confirmWithCode();
    await waitFor(() => expect(steps.submitInterviewResult).toHaveBeenCalledWith(expect.any(String), expect.any(String), '123456', { result: 'not_selected', resultReason: 'salary_expectation' }));
    expect(await screen.findByTestId('iv-result-done')).toHaveTextContent(/more profiles in the coming days/);
    expect(screen.queryByTestId('iv-result-pay')).toBeNull();
  });

  it('did not happen: "did not come" is sent', async () => {
    const steps = spiedSteps();
    await renderResult(steps);
    await fireEvent.press(await screen.findByTestId('iv-result-happened-no'));
    await confirmWithCode();
    await waitFor(() => expect(steps.submitInterviewResult).toHaveBeenCalledWith(expect.any(String), expect.any(String), '123456', { result: 'candidate_no_show' }));
    expect(await screen.findByTestId('iv-result-done')).toHaveTextContent(/more profiles/);
  });

  it('too early: the server says when it opens', async () => {
    const steps = spiedSteps();
    await renderResult(steps, async () => {
      throw new ApiError({ status: 409, messages: ['You can give the result after the interview'] });
    });
    expect(await screen.findByTestId('iv-result-early')).toHaveTextContent(/about an hour after the interview starts/);
    expect(steps.interviewResultDetails).not.toHaveBeenCalled();
  });
});
