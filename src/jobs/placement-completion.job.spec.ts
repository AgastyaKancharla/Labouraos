import { Queue, Worker } from 'bullmq';
import { PlacementCompletionJob, PLACEMENT_COMPLETION_SWEEP } from './placement-completion.job';

describe('Placement completion deadline scheduler', () => {
  const originalRole = process.env.PROCESS_ROLE;
  afterEach(() => {
    if (originalRole === undefined) delete process.env.PROCESS_ROLE;
    else process.env.PROCESS_ROLE = originalRole;
    jest.restoreAllMocks();
  });

  it('registers a worker scheduler in worker process role', async () => {
    process.env.PROCESS_ROLE = 'worker';
    const completeDay60Placements = jest.fn().mockResolvedValue(1);
    const job = new PlacementCompletionJob(
      { completeDay60Placements } as never,
    );
    const upsertJobScheduler = jest.fn().mockResolvedValue(undefined);
    const mockQueue = { upsertJobScheduler, close: jest.fn().mockResolvedValue(undefined), on: jest.fn() };
    const workerOn = jest.fn();
    const mockWorker = { close: jest.fn().mockResolvedValue(undefined), on: workerOn };
    jest.spyOn(job, 'getQueue').mockReturnValue(mockQueue as unknown as Queue);
    const getWorker = jest.spyOn(job, 'getWorker').mockReturnValue(mockWorker as unknown as Worker);

    await job.onModuleInit();
    expect(upsertJobScheduler).toHaveBeenCalledWith(
      'daily-placement-completion-scheduler',
      { pattern: '15 0 * * *', tz: 'Asia/Kolkata' },
      { name: PLACEMENT_COMPLETION_SWEEP },
    );
    expect(getWorker).toHaveBeenCalledTimes(1);
    await expect(job.process()).resolves.toEqual({ completed: 1 });
    expect(completeDay60Placements).toHaveBeenCalledTimes(1);
    await job.close();
  });

  it('does not register a worker scheduler in the web process', async () => {
    process.env.PROCESS_ROLE = 'web';
    const job = new PlacementCompletionJob(
      { completeDay60Placements: jest.fn() } as never,
    );
    const schedule = jest.spyOn(job, 'schedule');
    await job.onModuleInit();
    expect(schedule).not.toHaveBeenCalled();
  });
});
