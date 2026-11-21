import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, searchParams } from '@/test/expo-router-mock';
import { kiran, renderWithApp } from '@/test/render';
import FollowUpScreen from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

const task = {
  id: 't-9', code: 'FT-00009', kind: 'repeat_business_day_30', kindLabel: 'Repeat business — day 30', status: 'pending',
  dueAt: '2026-11-23T04:30:00.000Z', subjectType: 'business', subjectId: 'b-4', relatedType: 'placement', relatedId: 'pl-3',
  answer: null, completedAt: null, answers: ['needs_more_staff', 'no_staff_needed_now'], callPurpose: 'follow_up',
  business: { id: 'b-4', code: 'BZ-00004', name: 'Green Leaf Café', locality: 'Jayanagar', contactName: 'Suresh', phoneLast4: '1100', mine: true },
  jobSeeker: null,
};

describe('FA26 Follow-up task (21 Nov, M4)', () => {
  it('kind label, Call owner, what they said once answered, Done → POST /follow-up-tasks/:id/complete, then Add the vacancy', async () => {
    searchParams.current = { id: 't-9' };
    const sent: { url: string; body: unknown }[] = [];
    await renderWithApp(<FollowUpScreen />, {
      signedInAs: kiran,
      route: (url, init) => {
        if (url.endsWith('/field-work/follow-ups/t-9')) return { status: 200, body: task };
        if (url.endsWith('/calls') && init.method === 'POST') {
          sent.push({ url, body: JSON.parse(String(init.body)) });
          return { status: 201, body: { callRecordId: 'c-7' } };
        }
        if (url.endsWith('/calls/c-7')) return { status: 200, body: { id: 'c-7', answered: true, providerStatus: 'answered' } };
        if (url.endsWith('/follow-up-tasks/t-9/complete')) {
          sent.push({ url, body: JSON.parse(String(init.body)) });
          return { status: 201, body: {} };
        }
        return undefined;
      },
    });
    await waitFor(() => screen.getByTestId('fu-card'));
    expect(screen.getByTestId('fu-card')).toHaveTextContent(/Green Leaf Café.*Repeat business — day 30.*FT-00009/);
    await fireEvent.press(screen.getByTestId('fu-call'));
    await waitFor(() => screen.getByTestId('fu-answer-needs_more_staff'));
    expect(sent[0].body).toEqual({ subjectType: 'business', subjectId: 'b-4', purpose: 'follow_up' });
    expect(screen.getByTestId('fu-complete')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('fu-answer-needs_more_staff'));
    await fireEvent.press(screen.getByTestId('fu-complete'));
    await waitFor(() => screen.getByTestId('fu-done'));
    expect(sent[1]).toEqual({ url: 'https://api.test/follow-up-tasks/t-9/complete', body: { callRecordId: 'c-7', answer: 'needs_more_staff' } });
    await fireEvent.press(screen.getByTestId('fu-add-vacancy'));
    expect(router.replace).toHaveBeenLastCalledWith('/businesses/vacancy/new?businessId=b-4');
  });

  it('a done follow-up says so', async () => {
    searchParams.current = { id: 't-9' };
    await renderWithApp(<FollowUpScreen />, {
      signedInAs: kiran,
      route: (url) => (url.endsWith('/field-work/follow-ups/t-9') ? { status: 200, body: { ...task, status: 'done' } } : undefined),
    });
    await waitFor(() => expect(screen.getByTestId('fu-done')).toHaveTextContent('This follow-up is done.'));
    expect(screen.queryByTestId('fu-call')).toBeNull();
  });
});
