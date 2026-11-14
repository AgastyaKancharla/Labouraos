import { ForbiddenException } from '@nestjs/common';
import { TelephonyService } from './telephony.service';

/**
 * Missed calls (POST /telephony/callbacks/:id/assign and /complete): a Team
 * Lead works only on their own team's missed calls and gives them only to
 * their own team; an agent completes only their own or unassigned ones.
 */
describe('TelephonyService: callbacks scoped to the team', () => {
  const callbacks: Record<string, { id: string; assignedToStaffId: string | null; status: string }> = {};
  const team: Record<string, string[]> = { 'tl-a': ['agent-a1', 'agent-a2'], 'tl-b': ['agent-b1'] };
  let available: Set<string>;

  function build() {
    callbacks['cb-free'] = { id: 'cb-free', assignedToStaffId: null, status: 'pending' };
    callbacks['cb-a'] = { id: 'cb-a', assignedToStaffId: 'agent-a1', status: 'assigned' };
    callbacks['cb-b'] = { id: 'cb-b', assignedToStaffId: 'agent-b1', status: 'assigned' };
    const prisma = {
      callbackTask: {
        findUnique: jest.fn(async ({ where }) => callbacks[where.id] ?? null),
        update: jest.fn(async ({ where, data }) => ({ ...callbacks[where.id], ...data })),
      },
      staff: {
        findMany: jest.fn(async ({ where }) => (team[where.teamLeadId] ?? []).map((id) => ({ id }))),
      },
    };
    const attendance = {
      isAvailable: jest.fn(async (id: string) => available.has(id)),
      nextAvailableAgent: jest.fn(async () => 'agent-b1'),
    };
    const scope = { peopleUnder: jest.fn(async (id: string) => team[id] ?? []) };
    const service = new TelephonyService({} as never, prisma as never, attendance as never, undefined, scope as never);
    return { service, attendance };
  }
  const tl = (sub: string) => ({ sub, role: 'team_lead', code: 'TL', email: null });
  const agent = (sub: string) => ({ sub, role: 'call_agent', code: 'CA', email: null });

  beforeEach(() => {
    available = new Set(['agent-a1', 'agent-a2', 'agent-b1']);
  });

  it('a Team Lead cannot assign another team\'s missed call, or to another team\'s agent', async () => {
    const { service } = build();
    await expect(service.assignCallback('cb-b', 'agent-a1', tl('tl-a'))).rejects.toThrow(ForbiddenException);
    await expect(service.assignCallback('cb-free', 'agent-b1', tl('tl-a'))).rejects.toThrow(/not part of your team/);
  });

  it('a Team Lead assigns unassigned and own-team missed calls to their own agents', async () => {
    const { service } = build();
    await expect(service.assignCallback('cb-free', 'agent-a1', tl('tl-a'))).resolves.toMatchObject({ assignedToStaffId: 'agent-a1' });
    await expect(service.assignCallback('cb-a', 'agent-a2', tl('tl-a'))).resolves.toMatchObject({ assignedToStaffId: 'agent-a2' });
  });

  it('when their agent is not Available, a Team Lead\'s missed call goes to someone else on their team, never outside it', async () => {
    const { service, attendance } = build();
    available = new Set(['agent-a2', 'agent-b1']);
    await expect(service.assignCallback('cb-free', 'agent-a1', tl('tl-a'))).resolves.toMatchObject({ assignedToStaffId: 'agent-a2' });
    available = new Set(['agent-b1']);
    await expect(service.assignCallback('cb-free', 'agent-a1', tl('tl-a'))).resolves.toMatchObject({ assignedToStaffId: null });
    expect(attendance.nextAvailableAgent).not.toHaveBeenCalled();
  });

  it('a Team Lead completes only unassigned or own-team missed calls', async () => {
    const { service } = build();
    await expect(service.completeCallback('cb-b', tl('tl-a'))).rejects.toThrow(ForbiddenException);
    await expect(service.completeCallback('cb-a', tl('tl-a'))).resolves.toMatchObject({ status: 'completed' });
    await expect(service.completeCallback('cb-free', tl('tl-a'))).resolves.toMatchObject({ status: 'completed' });
  });

  it('an agent completes only their own or unassigned missed calls', async () => {
    const { service } = build();
    await expect(service.completeCallback('cb-b', agent('agent-a1'))).rejects.toThrow(ForbiddenException);
    await expect(service.completeCallback('cb-a', agent('agent-a1'))).resolves.toMatchObject({ status: 'completed' });
    await expect(service.completeCallback('cb-free', agent('agent-a1'))).resolves.toMatchObject({ status: 'completed' });
  });

  it('Managers and the CEO are unchanged', async () => {
    const { service } = build();
    await expect(service.completeCallback('cb-b', { sub: 'mgr', role: 'manager', code: 'M', email: null })).resolves.toMatchObject({ status: 'completed' });
    await expect(service.assignCallback('cb-b', 'agent-a1', { sub: 'ceo', role: 'ceo', code: 'C', email: null })).resolves.toMatchObject({ assignedToStaffId: 'agent-a1' });
  });
});
