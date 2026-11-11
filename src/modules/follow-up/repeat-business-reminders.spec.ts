import { BadRequestException } from '@nestjs/common';
import { FollowUpService } from './follow-up.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { AuditService } from '../../common/audit/audit.service';
import { PricingService } from '../pricing/pricing.service';
import { ReviewFlagService } from '../review-flag/review-flag.service';
import { CandidateIntroductionService } from '../vacancy/candidate-introduction.service';

const DAY = 24 * 60 * 60 * 1000;
const JOINED = new Date('2026-09-01T04:30:00.000Z');
const day = (n: number, hours = 1) => new Date(JOINED.getTime() + n * DAY + hours * 60 * 60 * 1000);

type Placement = {
  id: string;
  businessId: string;
  jobSeekerId: string;
  joinedDate: Date;
  status: string;
  rootPlacementId: string | null;
  guaranteeEndedReason: string | null;
  createdByStaffId: string | null;
  business: { accountAgentId: string | null };
};

describe('N4 repeat-business reminders (follow-up system)', () => {
  let service: FollowUpService;
  let tasks: Array<Record<string, unknown>>;
  let placements: Placement[];
  let unresolvedInChain: boolean;
  let prisma: Record<string, Record<string, jest.Mock>>;

  const policy = { followUpGraceDays: 2, replacementWindowDays: 60, jobSeekerGuaranteeDays: 30, noBypassMonths: 12 };

  function placement(overrides: Partial<Placement> = {}): Placement {
    return {
      id: 'pl-1',
      businessId: 'bz-1',
      jobSeekerId: 'js-1',
      joinedDate: JOINED,
      status: 'active',
      rootPlacementId: null,
      guaranteeEndedReason: null,
      createdByStaffId: 'creator-1',
      business: { accountAgentId: 'fa-account' },
      ...overrides,
    };
  }

  const repeatTasks = () => tasks.filter((t) => String(t.kind).startsWith('repeat_business'));

  beforeEach(() => {
    tasks = [];
    placements = [placement()];
    unresolvedInChain = false;
    prisma = {
      followUpTask: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findFirst: jest.fn().mockImplementation(({ where }) =>
          Promise.resolve(
            tasks.find((t) => t.kind === where.kind && t.relatedId === where.relatedId && t.relatedType === where.relatedType) ?? null,
          ),
        ),
        create: jest.fn().mockImplementation(({ data }) => {
          tasks.push(data);
          return Promise.resolve({ id: `task-${tasks.length}`, ...data });
        }),
        findUnique: jest.fn(),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'task-1', code: 'FUT-1', ...data })),
      },
      interview: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
      jobSeeker: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
      placement: {
        // Only the repeat-business query asks for 'replaced' placements; the day-7/30
        // worker check-ins get nothing here, so only N4 tasks are counted.
        findMany: jest.fn().mockImplementation(({ where }) =>
          Promise.resolve(where?.status?.in?.includes('replaced') ? placements : []),
        ),
        findFirst: jest.fn().mockImplementation(() => Promise.resolve(unresolvedInChain ? { id: 'pl-dropped' } : null)),
      },
      callRecord: { findUnique: jest.fn() },
      candidateIntroduction: { findFirst: jest.fn() },
      staff: { findFirst: jest.fn() },
    };
    service = new FollowUpService(
      prisma as unknown as PrismaService,
      { generateCode: jest.fn().mockResolvedValue('FUT-00001') } as unknown as IdService,
      { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService,
      { current: jest.fn().mockResolvedValue(policy) } as unknown as PricingService,
      { raise: jest.fn() } as unknown as ReviewFlagService,
      { firstIntroduction: jest.fn() } as unknown as CandidateIntroductionService,
    );
  });

  it('creates the day-30 reminder for the account agent on day 30, not on day 29, and only once', async () => {
    expect((await service.createScheduledTasks(day(29))).created).toBe(0);
    expect(repeatTasks()).toHaveLength(0);

    expect((await service.createScheduledTasks(day(30))).created).toBe(1);
    expect(repeatTasks()).toEqual([
      expect.objectContaining({
        kind: 'repeat_business_day_30',
        subjectType: 'business',
        subjectId: 'bz-1',
        relatedType: 'placement',
        relatedId: 'pl-1',
        assignedStaffId: 'fa-account',
        dueAt: new Date(JOINED.getTime() + 30 * DAY),
        status: 'pending',
      }),
    ]);

    expect((await service.createScheduledTasks(day(31))).created).toBe(0);
    expect(repeatTasks()).toHaveLength(1);
  });

  it('falls back to whoever created the placement when the business has no account agent', async () => {
    placements = [placement({ business: { accountAgentId: null } })];
    await service.createScheduledTasks(day(30));
    expect(repeatTasks()[0]).toMatchObject({ assignedStaffId: 'creator-1' });
  });

  it('creates the guarantee-complete reminder on day 61 (window 60 + 1), not on day 60, once', async () => {
    placements = [placement({ status: 'completed', joinedDate: JOINED })];
    await service.createScheduledTasks(day(60));
    expect(repeatTasks().filter((t) => t.kind === 'repeat_business_day_61')).toHaveLength(0);

    await service.createScheduledTasks(day(61));
    await service.createScheduledTasks(day(62));
    const day61 = repeatTasks().filter((t) => t.kind === 'repeat_business_day_61');
    expect(day61).toEqual([
      expect.objectContaining({
        subjectType: 'business',
        subjectId: 'bz-1',
        relatedId: 'pl-1',
        assignedStaffId: 'fa-account',
        dueAt: new Date(JOINED.getTime() + 61 * DAY),
      }),
    ]);
  });

  it('does not send "guarantee complete" for a replacement placement, an ended guarantee or a worker who left unresolved', async () => {
    placements = [placement({ id: 'pl-repl', rootPlacementId: 'pl-root' })];
    await service.createScheduledTasks(day(61));
    expect(repeatTasks().filter((t) => t.kind === 'repeat_business_day_61')).toHaveLength(0);

    placements = [placement({ id: 'pl-ended', guaranteeEndedReason: 'refunded' })];
    await service.createScheduledTasks(day(61));
    expect(repeatTasks().filter((t) => t.kind === 'repeat_business_day_61')).toHaveLength(0);

    placements = [placement({ id: 'pl-chain', status: 'replaced' })];
    unresolvedInChain = true;
    await service.createScheduledTasks(day(61));
    expect(repeatTasks().filter((t) => t.kind === 'repeat_business_day_61')).toHaveLength(0);

    unresolvedInChain = false;
    await service.createScheduledTasks(day(61));
    expect(repeatTasks().filter((t) => t.kind === 'repeat_business_day_61')).toEqual([
      expect.objectContaining({ relatedId: 'pl-chain' }),
    ]);
  });

  it('does not create a reminder whose grace period has already passed (old joinings)', async () => {
    placements = [placement({ status: 'completed' })];
    const result = await service.createScheduledTasks(day(200));
    expect(result.created).toBe(0);
    expect(repeatTasks()).toHaveLength(0);
  });

  it('a replaced (left) employee gets no day-30 "doing well?" reminder', async () => {
    placements = [placement({ status: 'replaced' })];
    await service.createScheduledTasks(day(30));
    expect(repeatTasks()).toHaveLength(0);
  });

  describe('completing a repeat-business task', () => {
    const task = {
      id: 'task-r', code: 'FUT-00009', kind: 'repeat_business_day_61', status: 'pending',
      subjectType: 'business', subjectId: 'bz-1', relatedType: 'placement', relatedId: 'pl-1',
    };
    const call = { id: 'call-1', answered: true, subjectType: 'business', subjectId: 'bz-1', purpose: 'follow_up' };

    beforeEach(() => {
      prisma.followUpTask.findUnique.mockResolvedValue(task);
      prisma.callRecord.findUnique.mockResolvedValue(call);
    });

    it('takes the owner\'s answer from the repeat-business list', async () => {
      const done = await service.completeTask(task.id, { callRecordId: call.id, answer: 'needs_more_staff', notes: 'Wants a second cook' }, 'fa-account');
      expect(done).toMatchObject({ status: 'done', answer: 'needs_more_staff', callRecordId: call.id });
    });

    it('refuses a job seeker answer on a repeat-business task', async () => {
      await expect(
        service.completeTask(task.id, { callRecordId: call.id, answer: 'working_elsewhere' }, 'fa-account'),
      ).rejects.toThrow(BadRequestException);
    });

    it('still needs an answered call with the business', async () => {
      prisma.callRecord.findUnique.mockResolvedValue({ ...call, answered: false });
      await expect(
        service.completeTask(task.id, { callRecordId: call.id, answer: 'no_staff_needed_now' }, 'fa-account'),
      ).rejects.toThrow('answered call');
    });
  });
});
