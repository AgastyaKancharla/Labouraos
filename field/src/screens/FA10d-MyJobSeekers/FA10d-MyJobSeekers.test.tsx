import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from '@/test/expo-router-mock';
import { kiran, renderWithApp } from '@/test/render';
import MyJobSeekersScreen from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

const seeker = (id: string, name: string, stage: string, steps: object) => ({
  id, code: `JS-${id}`, name, phoneLast4: '9876', status: 'active', registeredAt: '2026-11-14T06:00:00Z', stage,
  steps: { linkSentAt: null, consentGivenAt: null, paidAt: null, idCheckedAt: null, idCheckPending: false, interviews: 0, placed: false, ...steps },
});

describe('FA10d My job seekers', () => {
  it('lists the job seekers I registered with where each one is; + Job seeker and + Referral partner', async () => {
    await renderWithApp(<MyJobSeekersScreen />, {
      signedInAs: kiran,
      route: (url) =>
        url.includes('/field-work/job-seekers')
          ? {
              status: 200,
              body: {
                query: '',
                results: [
                  seeker('1', 'Lakshmi R', 'paid', { linkSentAt: '2026-11-14T06:02:00Z', consentGivenAt: '2026-11-14T06:10:00Z', paidAt: '2026-11-14T06:20:00Z', idCheckPending: true }),
                  seeker('2', 'Kavya', 'interviewing', { linkSentAt: 'x', consentGivenAt: 'x', paidAt: 'x', idCheckedAt: 'x', interviews: 2 }),
                ],
              },
            }
          : undefined,
    });
    await waitFor(() => screen.getByTestId('fa10d-seeker-1'));
    expect(screen.getByTestId('fa10d-seeker-1')).toHaveTextContent(/Lakshmi R.*JS-1 · \*\*\*\*\*\*9876.*Link sent ✓ · Consent ✓ · Paid ✓ · ID being checked.*Paid/);
    expect(screen.getByTestId('fa10d-seeker-2')).toHaveTextContent(/ID checked ✓ · 2 interviews.*Interviews/);
    await fireEvent.press(screen.getByTestId('fa10d-seeker-2'));
    expect(router.push).toHaveBeenCalledWith('/job-seekers/2');
    await fireEvent.press(screen.getByTestId('fa10d-add'));
    expect(router.push).toHaveBeenCalledWith('/job-seekers/new');
    await fireEvent.press(screen.getByTestId('fa10d-referral'));
    expect(router.push).toHaveBeenCalledWith('/job-seekers/referral-partner/new');
  });
});
