import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { PlacedWorker, WorkersAnswer } from '@/api/types';
import { todayKeyIst } from '@/components/form';
import { account, bizProfile } from '@/test/fixtures';
import { fakeApi, renderWithApp } from '@/test/render';
import WorkerLeft from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

const today = todayKeyIst();

function worker(over: Partial<PlacedWorker> = {}): PlacedWorker {
  return {
    placementId: 'pl-1',
    placementCode: 'PL-00012',
    workerFirstName: 'Ravi',
    trade: 'Cook',
    joinedOn: today,
    neverJoined: false,
    guaranteeLastDay: '2099-12-31',
    leftOnEarliest: today,
    leftOnLatest: today,
    state: 'can_report',
    ...over,
  };
}

function answer(over: Partial<WorkersAnswer> = {}): WorkersAnswer {
  return {
    reasons: { covered: ['resigned', 'absconded_3_days'], notCovered: ['salary_unpaid'], neverJoined: ['never_joined'] },
    reportWithinDays: 7,
    windowDays: 60,
    workers: [worker()],
    reports: [],
    ...over,
  };
}

const opts = (api: ReturnType<typeof fakeApi>) => ({ api, account: account({ profiles: [bizProfile] }), activeProfileId: 'p-biz' });

describe('A worker left (contract 8.2)', () => {
  it('the owner picks the worker, the day and why; the team will call', async () => {
    const api = fakeApi({
      workers: jest.fn(async () => answer()),
      reportWorkerLeft: jest.fn(async () => ({ reportId: 'rep-1', status: 'open' })),
    });
    await renderWithApp(<WorkerLeft />, opts(api));
    await waitFor(() => screen.getByTestId('workers-row-PL-00012'));
    expect(screen.getByTestId('workers-row-PL-00012')).toHaveTextContent(/Ravi · Cook.*PL-00012/);
    await fireEvent.press(screen.getByTestId('workers-row-PL-00012'));
    // Nothing picked yet: it says what to fix and sends nothing.
    await fireEvent.press(screen.getByTestId('workers-submit'));
    expect(screen.getByTestId('workers-problem')).toBeTruthy();
    expect(api.reportWorkerLeft).not.toHaveBeenCalled();
    // Covered and not-covered reasons are both offered, in plain words.
    expect(screen.getByTestId('workers-form')).toHaveTextContent(/The worker resigned or left the job/);
    expect(screen.getByTestId('workers-form')).toHaveTextContent(/Salary was not paid, or paid late.*No free replacement/);
    await fireEvent.press(screen.getByTestId('workers-left-on'));
    await fireEvent.press(screen.getByTestId(`workers-left-on-day-${today}`));
    await fireEvent.press(screen.getByTestId('workers-reason-resigned'));
    await fireEvent.changeText(screen.getByTestId('workers-note'), 'Went back to his village');
    await fireEvent.press(screen.getByTestId('workers-submit'));
    await waitFor(() => screen.getByTestId('workers-done'));
    expect(api.reportWorkerLeft).toHaveBeenCalledWith('p-biz', 'pl-1', { workerLeftOn: today, reason: 'resigned', note: 'Went back to his village' });
  });

  it('a worker already reported, or past the 60 days, cannot be picked; earlier reports show their state', async () => {
    const api = fakeApi({
      workers: jest.fn(async () =>
        answer({
          workers: [worker({ state: 'reported' }), worker({ placementId: 'pl-2', placementCode: 'PL-00013', workerFirstName: 'Manju', state: 'guarantee_over' })],
          reports: [{ id: 'rep-1', placementCode: 'PL-00012', workerFirstName: 'Ravi', workerLeftOn: today, reason: 'resigned', status: 'claim_filed', claimDecision: 'accepted', reportedAt: new Date().toISOString() }],
        }),
      ),
    });
    await renderWithApp(<WorkerLeft />, opts(api));
    await waitFor(() => screen.getByTestId('workers-row-PL-00012'));
    expect(screen.getByTestId('workers-row-PL-00012')).toHaveTextContent(/We will call you/);
    expect(screen.getByTestId('workers-row-PL-00013')).toHaveTextContent(/Time over/);
    await fireEvent.press(screen.getByTestId('workers-row-PL-00013'));
    expect(screen.queryByTestId('workers-form')).toBeNull();
    expect(screen.getByTestId('workers-report-rep-1')).toHaveTextContent(/Free replacement approved/);
  });

  it('a paid worker who never came: only "never joined" is offered', async () => {
    const api = fakeApi({ workers: jest.fn(async () => answer({ workers: [worker({ neverJoined: true, joinedOn: null })] })) });
    await renderWithApp(<WorkerLeft />, opts(api));
    await waitFor(() => screen.getByTestId('workers-row-PL-00012'));
    await fireEvent.press(screen.getByTestId('workers-row-PL-00012'));
    expect(screen.getByTestId('workers-reason-never_joined')).toBeTruthy();
    expect(screen.queryByTestId('workers-reason-resigned')).toBeNull();
  });
});
