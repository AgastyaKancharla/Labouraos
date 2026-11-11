import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { kiran, renderWithApp } from '@/test/render';
import { candidate, routeTable } from '@/test/selling-fixtures';
import CallingScreen from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));
beforeEach(() => {
  jest.clearAllMocks();
  (useLocalSearchParams as jest.Mock).mockReturnValue({ vacancyId: 'vac-1', jobSeekerId: 'js-1' });
});

const api = () =>
  routeTable({
    '/screens/field-selling/candidates/js-1?vacancyId=vac-1': candidate,
    'POST /field-selling/calls': { callRecordId: 'call-1' },
    '/calls/call-1': { id: 'call-1', answered: true, providerStatus: 'in-progress' },
    'POST /field-selling/calls/call-1/answer': (init: RequestInit) => ({
      status: 201,
      body: { interviewId: 'iv-1', status: JSON.parse(String(init.body)).answer === 'yes' ? 'confirmed' : 'declined', hit: false },
    }),
    'POST /field-selling/interviews/iv-1/hand-over': { interviewId: 'iv-1' },
  });

describe('FA15e Calling the job seeker', () => {
  it('asks the owner first, places the masked call, and on yes hands the phone to the owner (same call)', async () => {
    const { route, calls } = api();
    await renderWithApp(<CallingScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('ask-owner'));
    expect(screen.getByTestId('script')).toHaveTextContent(/Namaskara Manjunath, this is Kiran from Laboura\. We found a cook job for you near BTM Layout: Day shift, ₹16,000–20,000 a month/);
    await fireEvent.press(screen.getByTestId('place-call'));
    await waitFor(() => screen.getByTestId('on-call'));
    expect(calls).toContainEqual({ method: 'POST', path: '/field-selling/calls', body: { vacancyId: 'vac-1', jobSeekerId: 'js-1' } });
    await waitFor(() => expect(screen.getByTestId('on-call')).toHaveTextContent(/recorded · numbers hidden/));
    await fireEvent.press(screen.getByTestId('answer-yes'));
    await fireEvent.press(screen.getByTestId('hand-over'));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/job-seekers/interview/iv-1/owner'));
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(expect.arrayContaining([
      'POST /field-selling/calls/call-1/answer',
      'POST /field-selling/interviews/iv-1/hand-over',
    ]));
  });

  it('a no needs a reason (it is a hit) and goes back to the next candidate', async () => {
    const { route, calls } = api();
    await renderWithApp(<CallingScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('place-call'));
    await fireEvent.press(screen.getByTestId('place-call'));
    await waitFor(() => screen.getByTestId('answer-no'));
    await fireEvent.press(screen.getByTestId('answer-no'));
    expect(screen.getByTestId('save-no')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('reason'));
    await fireEvent.press(screen.getByTestId('reason-option-too_far'));
    await fireEvent.press(screen.getByTestId('save-no'));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(calls).toContainEqual({ method: 'POST', path: '/field-selling/calls/call-1/answer', body: { answer: 'no', reason: 'too_far' } });
  });

  it('owner busy or no answer → book an interview for later', async () => {
    const { route } = api();
    await renderWithApp(<CallingScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('owner-busy'));
    await fireEvent.press(screen.getByTestId('owner-busy'));
    expect(router.push).toHaveBeenCalledWith('/job-seekers/book?vacancyId=vac-1&jobSeekerId=js-1');
  });
});
