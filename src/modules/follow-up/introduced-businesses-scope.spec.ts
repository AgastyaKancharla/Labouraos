import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { FollowUpService } from './follow-up.service';

/**
 * GET /follow-up-tasks/:id/introduced-businesses only answers for the asking
 * agent's own introductions or task, or for a Team Lead's / Manager's
 * reporting scope. The CEO sees all.
 */
type Intro = { businessId: string; shownByStaffId: string; business: { id: string; code: string; name: string } };

const biz = (n: number) => ({ id: `bz-${n}`, code: `BZ-0000${n}`, name: `Biz ${n}` });
const INTROS: Intro[] = [
  { businessId: 'bz-1', shownByStaffId: 'agent-a', business: biz(1) },
  { businessId: 'bz-2', shownByStaffId: 'agent-b', business: biz(2) },
  { businessId: 'bz-3', shownByStaffId: 'agent-c', business: biz(3) },
];
// Reporting tree: manager-1 → tl-1 → agent-a, agent-b; manager-2 → tl-2 → agent-c.
const UNDER: Record<string, string[]> = {
  'manager-1': ['tl-1', 'agent-a', 'agent-b'],
  'tl-1': ['agent-a', 'agent-b'],
  'manager-2': ['tl-2', 'agent-c'],
  'tl-2': ['agent-c'],
};

function makeService(task: Record<string, unknown> | null) {
  const prisma = {
    followUpTask: { findUnique: jest.fn().mockResolvedValue(task) },
    candidateIntroduction: {
      findMany: jest.fn(async ({ where }: { where: { jobSeekerId: string; shownByStaffId?: { in: string[] } } }) =>
        INTROS.filter((i) => !where.shownByStaffId || where.shownByStaffId.in.includes(i.shownByStaffId)).map((i) => ({ business: i.business })),
      ),
    },
  };
  const scope = { peopleUnder: jest.fn(async (id: string) => UNDER[id] ?? []) };
  const service = new FollowUpService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never, undefined, scope as never);
  return { service, prisma };
}

const task = { id: 'task-1', subjectType: 'job_seeker', subjectId: 'js-1', assignedStaffId: 'agent-c' };
const ids = (list: Array<{ id: string }>) => list.map((b) => b.id);

describe('FollowUpService.getIntroducedBusinesses: ownership and reporting scope', () => {
  it('CEO and the agent the task is assigned to see every introduction', async () => {
    const { service } = makeService(task);
    expect(ids(await service.getIntroducedBusinesses('task-1', { id: 'ceo-1', role: 'ceo' }))).toEqual(['bz-1', 'bz-2', 'bz-3']);
    expect(ids(await service.getIntroducedBusinesses('task-1', { id: 'agent-c', role: 'call_agent' }))).toEqual(['bz-1', 'bz-2', 'bz-3']);
  });

  it('another agent sees only the businesses they introduced', async () => {
    const { service, prisma } = makeService(task);
    expect(ids(await service.getIntroducedBusinesses('task-1', { id: 'agent-a', role: 'field_agent' }))).toEqual(['bz-1']);
    expect(prisma.candidateIntroduction.findMany.mock.calls[0][0].where).toEqual({ jobSeekerId: 'js-1', shownByStaffId: { in: ['agent-a'] } });
  });

  it('an agent who introduced nothing to this job seeker and does not own the task: 403', async () => {
    const { service } = makeService(task);
    await expect(service.getIntroducedBusinesses('task-1', { id: 'agent-z', role: 'call_agent' })).rejects.toThrow(ForbiddenException);
  });

  it('Team Lead and Manager: only introductions by their own reporting scope', async () => {
    const { service } = makeService(task);
    expect(ids(await service.getIntroducedBusinesses('task-1', { id: 'tl-1', role: 'team_lead' }))).toEqual(['bz-1', 'bz-2']);
    expect(ids(await service.getIntroducedBusinesses('task-1', { id: 'manager-1', role: 'manager' }))).toEqual(['bz-1', 'bz-2']);
  });

  it('Team Lead and Manager whose scope holds the task’s agent see every introduction', async () => {
    const { service } = makeService(task);
    expect(ids(await service.getIntroducedBusinesses('task-1', { id: 'tl-2', role: 'team_lead' }))).toEqual(['bz-1', 'bz-2', 'bz-3']);
    expect(ids(await service.getIntroducedBusinesses('task-1', { id: 'manager-2', role: 'manager' }))).toEqual(['bz-1', 'bz-2', 'bz-3']);
  });

  it('out of scope: a Team Lead with nothing in scope gets 403', async () => {
    const { service } = makeService({ ...task, assignedStaffId: 'agent-x' });
    await expect(service.getIntroducedBusinesses('task-1', { id: 'tl-9', role: 'team_lead' })).rejects.toThrow(ForbiddenException);
  });

  it('Finance and unknown tasks are refused', async () => {
    await expect(makeService(task).service.getIntroducedBusinesses('task-1', { id: 'fin-1', role: 'finance' })).rejects.toThrow(ForbiddenException);
    await expect(makeService(null).service.getIntroducedBusinesses('nope', { id: 'ceo-1', role: 'ceo' })).rejects.toThrow(NotFoundException);
  });
});

/** Owner rule (Master Guide, 14 Nov): a Team Lead completes only their own team's follow-ups. */
describe('FollowUpService.assertTeamLeadMayComplete', () => {
  it('a Team Lead is refused a follow-up assigned outside their team, or to no one', async () => {
    await expect(makeService(task).service.assertTeamLeadMayComplete('task-1', { id: 'tl-1', role: 'team_lead' })).rejects.toThrow(ForbiddenException);
    await expect(makeService({ ...task, assignedStaffId: null }).service.assertTeamLeadMayComplete('task-1', { id: 'tl-1', role: 'team_lead' })).rejects.toThrow(ForbiddenException);
  });

  it('a Team Lead may complete their own and their team’s follow-ups', async () => {
    await expect(makeService(task).service.assertTeamLeadMayComplete('task-1', { id: 'tl-2', role: 'team_lead' })).resolves.toBeUndefined();
    await expect(makeService({ ...task, assignedStaffId: 'tl-2' }).service.assertTeamLeadMayComplete('task-1', { id: 'tl-2', role: 'team_lead' })).resolves.toBeUndefined();
  });

  it('other roles and missing tasks are left to completeTask', async () => {
    await expect(makeService(task).service.assertTeamLeadMayComplete('task-1', { id: 'agent-a', role: 'call_agent' })).resolves.toBeUndefined();
    await expect(makeService(task).service.assertTeamLeadMayComplete('task-1', { id: 'manager-1', role: 'manager' })).resolves.toBeUndefined();
    await expect(makeService(null).service.assertTeamLeadMayComplete('nope', { id: 'tl-1', role: 'team_lead' })).resolves.toBeUndefined();
  });
});
