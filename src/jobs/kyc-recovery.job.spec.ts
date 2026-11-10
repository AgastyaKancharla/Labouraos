import { Queue } from 'bullmq';
import { KycRecoveryService } from '../common/kyc/kyc-recovery.service';
import { KycRecoveryJob, KYC_RECOVERY_SWEEP } from './kyc-recovery.job';

describe('KycRecoveryJob', () => {
  it('schedules the ID provider probe every 15 minutes on the worker', async () => {
    const recovery = { checkAndRecover: jest.fn().mockResolvedValue({ checked: true, healthy: false, notified: 0 }) };
    const job = new KycRecoveryJob(recovery as unknown as KycRecoveryService);
    const queue = {
      upsertJobScheduler: jest.fn().mockResolvedValue(undefined),
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    } as unknown as Queue;
    jest.spyOn(job, 'getQueue').mockReturnValue(queue);

    await job.schedule();
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'kyc-recovery-scheduler',
      { every: 15 * 60 * 1000 },
      { name: KYC_RECOVERY_SWEEP },
    );
    await expect(job.process()).resolves.toEqual({ checked: true, healthy: false, notified: 0 });
    expect(recovery.checkAndRecover).toHaveBeenCalledTimes(1);
  });

  it('supports a manual trigger through the shared queue', async () => {
    const job = new KycRecoveryJob({ checkAndRecover: jest.fn() } as unknown as KycRecoveryService);
    const queue = { add: jest.fn().mockResolvedValue({ id: 'manual-1' }) } as unknown as Queue;
    jest.spyOn(job, 'getQueue').mockReturnValue(queue);
    await expect(job.triggerJob()).resolves.toBe('manual-1');
    expect(queue.add).toHaveBeenCalledWith(KYC_RECOVERY_SWEEP, expect.objectContaining({ requestedAt: expect.any(String) }));
  });
});
