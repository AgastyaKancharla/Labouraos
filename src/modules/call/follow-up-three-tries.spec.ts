import { CallRecord } from '@prisma/client';
import { CallFollowThroughService, FOLLOW_UP_UNANSWERED_LIMIT } from './call-follow-through.service';

/**
 * Guide: "Follow-up calls that go unanswered are retried the next day; after
 * 3 tries the Team Lead is told." The calling system reports each unanswered
 * follow-up call; the task moves to the next day each time, and the third
 * unanswered try raises a follow_up_unanswered flag, which the agent's Team
 * Lead owns (their bell), once.
 */
describe('follow-up calls: retried next day, Team Lead told after 3 tries', () => {
  function setup(unansweredSoFar: number) {
    const prisma = {
      followUpTask: {
        findUnique: jest.fn().mockResolvedValue({ id: 'task-1', code: 'FUT-00001', status: 'pending', kind: 'not_selected_day_7', subjectType: 'job_seeker', subjectId: 'js-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      callRecord: { count: jest.fn().mockResolvedValue(unansweredSoFar) },
      messageLog: { findFirst: jest.fn().mockResolvedValue({ id: 'sent-today' }) },
      jobSeeker: { findUnique: jest.fn().mockResolvedValue({ preferredCallWindowStart: '10:00', preferredCallWindowEnd: '18:00' }) },
      callTask: { create: jest.fn(), updateMany: jest.fn() },
    };
    const pricing = { current: jest.fn().mockResolvedValue({ callingHoursStart: '09:00', callingHoursEnd: '21:00' }) };
    const messaging = { send: jest.fn() };
    const reviewFlags = { raise: jest.fn().mockResolvedValue({}) };
    const live = { publish: jest.fn() };
    const service = new CallFollowThroughService(prisma as never, pricing as never, messaging as never, reviewFlags as never, live as never);
    return { service, prisma, reviewFlags };
  }
  const missed = (): CallRecord =>
    ({
      id: 'call-1',
      staffId: 'agent-1',
      subjectType: 'job_seeker',
      subjectId: 'js-1',
      purpose: 'follow_up',
      relatedType: 'follow_up_task',
      relatedId: 'task-1',
      direction: 'outbound',
      answered: false,
      providerStatus: 'no_answer',
      endedAt: new Date('2026-11-12T06:00:00Z'),
      startedAt: new Date('2026-11-12T05:59:00Z'),
      createdAt: new Date('2026-11-12T05:59:00Z'),
    }) as unknown as CallRecord;

  it('moves the follow-up to the next day inside the person\'s window, without a Team Lead flag on tries 1 and 2', async () => {
    for (const tries of [1, 2]) {
      const { service, prisma, reviewFlags } = setup(tries);
      await service.onStatusChanged({ answered: false }, missed());
      const dueAt: Date = prisma.followUpTask.update.mock.calls[0][0].data.dueAt;
      // 12 Nov 11:30 IST missed → 13 Nov 10:00 IST (her window starts at 10:00).
      expect(dueAt.toISOString()).toBe('2026-11-13T04:30:00.000Z');
      expect(reviewFlags.raise).not.toHaveBeenCalled();
      expect(prisma.callTask.create).not.toHaveBeenCalled();
    }
  });

  it(`tells the Team Lead on the ${FOLLOW_UP_UNANSWERED_LIMIT}rd unanswered try, once`, async () => {
    const { service, reviewFlags } = setup(FOLLOW_UP_UNANSWERED_LIMIT);
    await service.onStatusChanged({ answered: false }, missed());
    expect(reviewFlags.raise).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'follow_up_unanswered', subjectId: 'js-1', raisedForStaffId: 'agent-1', details: expect.objectContaining({ followUpTaskId: 'task-1', unansweredCalls: 3 }) }),
    );
    const fourth = setup(FOLLOW_UP_UNANSWERED_LIMIT + 1);
    await fourth.service.onStatusChanged({ answered: false }, missed());
    expect(fourth.reviewFlags.raise).not.toHaveBeenCalled();
  });
});
