import { JOB_CATALOG, schedulerSetKey, SHARED_JOB_QUEUE } from './job-catalog';
import { RETIRED_SCHEDULES, retiredSchedulesPresent } from './legacy-queues';

/** A retired job (the outside ID company's KYC recovery probe) must leave no schedule behind in a Key Value that kept its data. */
describe('retired job schedules', () => {
  it('the KYC recovery probe is retired: not in the catalog, its schedule removed from its old queue and the shared one', () => {
    expect(JOB_CATALOG.some((e) => e.key === 'kycRecovery' || e.schedulerId === 'kyc-recovery-scheduler')).toBe(false);
    expect(RETIRED_SCHEDULES).toEqual([{ key: 'kycRecovery', jobName: 'probe-id-check-recovery', queues: ['kyc-recovery', SHARED_JOB_QUEUE], schedulerId: 'kyc-recovery-scheduler' }]);
    // The shared worker finishes a copy of it still waiting and drops its schedule (job-queue.spec.ts).
    expect(JOB_CATALOG.some((e) => e.jobName === 'probe-id-check-recovery')).toBe(false);
  });

  it('finds only the retired schedules that are still there', async () => {
    const present = new Set([`${schedulerSetKey(SHARED_JOB_QUEUE)}|kyc-recovery-scheduler`]);
    const reader = { zscore: jest.fn(async (key: string, member: string) => (present.has(`${key}|${member}`) ? '1' : null)) };
    expect(await retiredSchedulesPresent(reader as never)).toEqual([{ key: 'kycRecovery', queue: SHARED_JOB_QUEUE, schedulerId: 'kyc-recovery-scheduler' }]);
    present.clear();
    expect(await retiredSchedulesPresent(reader as never)).toEqual([]);
  });
});
