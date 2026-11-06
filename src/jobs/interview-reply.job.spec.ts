import { Queue, Worker } from 'bullmq';
import { InterviewReplyJob, INTERVIEW_REPLY_SWEEP } from './interview-reply.job';

describe('Interview reply deadline scheduler', () => {
  const originalRole = process.env.PROCESS_ROLE;
  afterEach(() => {
    if (originalRole === undefined) delete process.env.PROCESS_ROLE;
    else process.env.PROCESS_ROLE = originalRole;
    jest.restoreAllMocks();
  });

  it('registers a once-per-minute worker scheduler', async () => {
    process.env.PROCESS_ROLE = 'worker';
    const processDueReplies = jest.fn().mockResolvedValue({ processed: 0 });
    const job = new InterviewReplyJob({ processDueReplies } as never);
    const upsertJobScheduler = jest.fn().mockResolvedValue(undefined);
    const mockQueue = { upsertJobScheduler, close: jest.fn().mockResolvedValue(undefined), on: jest.fn() };
    const workerOn = jest.fn();
    const mockWorker = { close: jest.fn().mockResolvedValue(undefined), on: workerOn };
    jest.spyOn(job, 'getQueue').mockReturnValue(mockQueue as unknown as Queue);
    const getWorker = jest.spyOn(job, 'getWorker').mockReturnValue(mockWorker as unknown as Worker);

    await job.onModuleInit();
    expect(upsertJobScheduler).toHaveBeenCalledWith(
      'interview-reply-deadline-scheduler', { every: 60_000 }, { name: INTERVIEW_REPLY_SWEEP },
    );
    expect(getWorker).toHaveBeenCalledTimes(1);
    await expect(job.processDueReplies()).resolves.toEqual({ processed: 0 });
    expect(processDueReplies).toHaveBeenCalledTimes(1);
    await job.close();
  });

  it('does not register a worker scheduler in the web process', async () => {
    process.env.PROCESS_ROLE = 'web';
    const job = new InterviewReplyJob({ processDueReplies: jest.fn() } as never);
    const schedule = jest.spyOn(job, 'schedule');
    await job.onModuleInit();
    expect(schedule).not.toHaveBeenCalled();
  });
});
