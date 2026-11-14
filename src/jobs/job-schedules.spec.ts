import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
// cron-parser is the parser BullMQ itself uses for `pattern` + `tz`.
import { CronExpressionParser } from 'cron-parser';
import {
  DAILY_JOB_PATTERNS,
  DailyJobName,
  INTERVAL_JOB_MS,
  JOB_TIME_ZONE,
  WEEKLY_JOB_PATTERNS,
} from './job-schedules';
import { WeeklyReportJob } from './weekly-report.job';
import { ClaimOverdueJob } from './claim-overdue.job';
import { FollowUpJob } from './follow-up.job';
import { ForgottenLogoutJob } from './forgotten-logout.job';
import { JoiningRewardJob } from './joining-reward.job';
import { NoPickupEvaluationJob } from './no-pickup-evaluation.job';
import { PatternFlagsJob } from './pattern-flags.job';
import { PlacementCompletionJob } from './placement-completion.job';
import { RetentionCleanupJob } from './retention-cleanup.job';
import { ShortageTasksJob } from './shortage-tasks.job';
import { WinBackJob } from './win-back.job';
import { NotificationSweepJob } from './notification-sweep.job';

type MockQueue = {
  upsertJobScheduler: jest.Mock;
  close: jest.Mock;
  on: jest.Mock;
};

function mockQueue(): MockQueue {
  return {
    upsertJobScheduler: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
  };
}

function mockWorker() {
  return { close: jest.fn().mockResolvedValue(undefined), on: jest.fn() };
}

interface SchedulableJob {
  getQueue(): Queue;
  getWorker(): Worker;
  onModuleInit(): Promise<void>;
  onModuleDestroy(): Promise<void>;
}

const dailyJobs: Array<{
  name: DailyJobName;
  build: () => SchedulableJob;
  register: (job: SchedulableJob) => Promise<void>;
}> = [
  {
    name: 'noPickupEvaluation',
    build: () => new NoPickupEvaluationJob({} as never, {} as never),
    register: (job) => (job as NoPickupEvaluationJob).scheduleDailyJob(),
  },
  {
    name: 'forgottenLogout',
    build: () => new ForgottenLogoutJob({} as never, {} as never, {} as never),
    register: (job) => (job as ForgottenLogoutJob).schedule(),
  },
  {
    name: 'placementCompletion',
    build: () => new PlacementCompletionJob({} as never),
    register: (job) => (job as PlacementCompletionJob).schedule(),
  },
  {
    name: 'claimOverdue',
    build: () => new ClaimOverdueJob({} as never),
    register: (job) => (job as ClaimOverdueJob).schedule(),
  },
  {
    name: 'joiningReward',
    build: () => new JoiningRewardJob({} as never),
    register: (job) => (job as JoiningRewardJob).schedule(),
  },
  {
    name: 'patternFlags',
    build: () => new PatternFlagsJob({} as never),
    register: (job) => (job as PatternFlagsJob).schedule(),
  },
  {
    name: 'retentionCleanup',
    build: () => new RetentionCleanupJob({} as never),
    register: (job) => (job as RetentionCleanupJob).schedule(),
  },
  {
    name: 'followUp',
    build: () => new FollowUpJob({} as never),
    register: (job) => (job as FollowUpJob).schedule(),
  },
  {
    name: 'shortageTasks',
    build: () => new ShortageTasksJob({} as never),
    register: (job) => (job as ShortageTasksJob).schedule(),
  },
  {
    name: 'winBack',
    build: () => new WinBackJob({} as never),
    register: (job) => (job as WinBackJob).schedule(),
  },
];

describe('Background job schedules run on India time', () => {
  const originalRole = process.env.PROCESS_ROLE;

  afterEach(() => {
    if (originalRole === undefined) delete process.env.PROCESS_ROLE;
    else process.env.PROCESS_ROLE = originalRole;
    jest.restoreAllMocks();
  });

  it('covers every once-a-day job exactly once', () => {
    expect(dailyJobs.map((j) => j.name).sort()).toEqual(
      (Object.keys(DAILY_JOB_PATTERNS) as DailyJobName[]).sort(),
    );
  });

  it.each(dailyJobs)(
    '$name registers a cron pattern read in Asia/Kolkata, not a drifting 24-hour interval',
    async ({ name, build, register }) => {
      const job = build();
      const queue = mockQueue();
      jest.spyOn(job, 'getQueue').mockReturnValue(queue as unknown as Queue);

      await register(job);

      expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(1);
      const repeat = queue.upsertJobScheduler.mock.calls[0][1];
      expect(repeat).toEqual({ pattern: DAILY_JOB_PATTERNS[name], tz: 'Asia/Kolkata' });
      expect(repeat).not.toHaveProperty('every');
    },
  );

  it('fires the midnight jobs at 00:00 IST (18:30 UTC the day before), not 05:30 IST', () => {
    const next = CronExpressionParser.parse(DAILY_JOB_PATTERNS.noPickupEvaluation, {
      tz: JOB_TIME_ZONE,
      currentDate: new Date('2026-11-15T10:00:00.000Z'), // 15:30 IST
    })
      .next()
      .toDate();
    expect(next.toISOString()).toBe('2026-11-15T18:30:00.000Z');
  });

  it('runs follow-up before the working day starts in India', () => {
    const next = CronExpressionParser.parse(DAILY_JOB_PATTERNS.followUp, {
      tz: JOB_TIME_ZONE,
      currentDate: new Date('2026-11-15T10:00:00.000Z'),
    })
      .next()
      .toDate();
    // 06:00 IST on 16 Nov is 00:30 UTC on 16 Nov.
    expect(next.toISOString()).toBe('2026-11-16T00:30:00.000Z');
  });

  it('keeps the short-interval jobs on fixed intervals', () => {
    expect(INTERVAL_JOB_MS).toEqual({ interviewReply: 60_000, notificationSweep: 300_000 });
  });

  it('no job file schedules with a raw 24-hour interval or an inline pattern', () => {
    const dir = __dirname;
    const offenders: string[] = [];
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.job.ts')) continue;
      const source = fs.readFileSync(path.join(dir, file), 'utf8');
      if (/every:\s*86_?400_?000/.test(source)) offenders.push(`${file}: every 24h`);
      if (/\{\s*pattern:\s*'/.test(source)) offenders.push(`${file}: inline UTC pattern`);
    }
    expect(offenders).toEqual([]);
  });
});

describe('The Monday weekly report runs at 9 AM India time', () => {
  afterEach(() => jest.restoreAllMocks());

  it('registers a weekly cron read in Asia/Kolkata', async () => {
    const job = new WeeklyReportJob({} as never);
    const queue = mockQueue();
    jest.spyOn(job, 'getQueue').mockReturnValue(queue as unknown as Queue);
    await job.schedule();
    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(1);
    expect(queue.upsertJobScheduler.mock.calls[0][1]).toEqual({ pattern: '0 9 * * 1', tz: 'Asia/Kolkata' });
    expect(queue.upsertJobScheduler.mock.calls[0][2]).toMatchObject({ name: 'monday-weekly-report' });
  });

  it('fires on Monday at 09:00 IST (03:30 UTC), once a week', () => {
    const it2 = CronExpressionParser.parse(WEEKLY_JOB_PATTERNS.weeklyReport, {
      tz: JOB_TIME_ZONE,
      currentDate: new Date('2026-11-12T10:00:00.000Z'), // Thursday
    });
    expect(it2.next().toDate().toISOString()).toBe('2026-11-16T03:30:00.000Z');
    expect(it2.next().toDate().toISOString()).toBe('2026-11-23T03:30:00.000Z');
  });
});

describe('Daily jobs start only in the worker process', () => {
  const originalRole = process.env.PROCESS_ROLE;

  afterEach(() => {
    if (originalRole === undefined) delete process.env.PROCESS_ROLE;
    else process.env.PROCESS_ROLE = originalRole;
    jest.restoreAllMocks();
  });

  const previouslyUngated: Array<{ label: string; build: () => SchedulableJob }> = [
    { label: 'ClaimOverdueJob', build: () => new ClaimOverdueJob({} as never) },
    { label: 'FollowUpJob', build: () => new FollowUpJob({} as never) },
    { label: 'PatternFlagsJob', build: () => new PatternFlagsJob({} as never) },
    { label: 'JoiningRewardJob', build: () => new JoiningRewardJob({} as never) },
    { label: 'ShortageTasksJob', build: () => new ShortageTasksJob({} as never) },
    { label: 'WinBackJob', build: () => new WinBackJob({} as never) },
    { label: 'WeeklyReportJob', build: () => new WeeklyReportJob({} as never) },
    {
      label: 'NotificationSweepJob',
      build: () => new NotificationSweepJob({} as never, {} as never, {} as never, {} as never, {} as never),
    },
  ];

  describe.each(previouslyUngated)('$label', ({ build }) => {
    it.each([['web'], [undefined]])(
      'builds no queue, worker or scheduler when PROCESS_ROLE is %s',
      async (role) => {
        if (role === undefined) delete process.env.PROCESS_ROLE;
        else process.env.PROCESS_ROLE = role;
        const job = build();
        const getQueue = jest.spyOn(job, 'getQueue');
        const getWorker = jest.spyOn(job, 'getWorker');

        await job.onModuleInit();

        expect(getQueue).not.toHaveBeenCalled();
        expect(getWorker).not.toHaveBeenCalled();
        await job.onModuleDestroy();
      },
    );

    it('registers its scheduler and one worker when PROCESS_ROLE is worker', async () => {
      process.env.PROCESS_ROLE = 'worker';
      const job = build();
      const queue = mockQueue();
      jest.spyOn(job, 'getQueue').mockReturnValue(queue as unknown as Queue);
      const getWorker = jest
        .spyOn(job, 'getWorker')
        .mockReturnValue(mockWorker() as unknown as Worker);

      await job.onModuleInit();

      expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(1);
      expect(getWorker).toHaveBeenCalledTimes(1);
    });

    it('logs and carries on (no crash) when Redis refuses the scheduler', async () => {
      process.env.PROCESS_ROLE = 'worker';
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const job = build();
      const queue = mockQueue();
      queue.upsertJobScheduler.mockRejectedValue(new Error('ECONNREFUSED'));
      jest.spyOn(job, 'getQueue').mockReturnValue(queue as unknown as Queue);
      const getWorker = jest.spyOn(job, 'getWorker');

      await expect(job.onModuleInit()).resolves.toBeUndefined();
      expect(getWorker).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'));
    });
  });
});
