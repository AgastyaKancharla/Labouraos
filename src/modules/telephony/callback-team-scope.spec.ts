import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { TelephonyService } from './telephony.service';

/**
 * Missed calls (POST /telephony/callbacks/:id/assign and /complete), owner
 * decision of 14 Nov:
 * - a call agent assigns only an unassigned missed call (take it, or give it
 *   to a colleague) or one he holds (hand it over), never one someone else
 *   holds; he completes only his own or unassigned ones;
 * - a Team Lead works only on their own team's missed calls and gives them
 *   only to their own team;
 * - Managers and the CEO: any.
 */
describe('TelephonyService: who may assign and complete a missed call', () => {
  let callbacks: Record<string, { id: string; assignedToStaffId: string | null; status: string }>;
  const team: Record<string, string[]> = { 'tl-a': ['agent-a1', 'agent-a2'], 'tl-b': ['agent-b1'] };
  const staff: Record<string, { role: string; status: string }> = {
    'agent-a1': { role: 'call_agent', status: 'active' },
    'agent-a2': { role: 'field_agent', status: 'active' },
    'agent-b1': { role: 'call_agent', status: 'active' },
    'agent-gone': { role: 'call_agent', status: 'deactivated' },
    'fin-1': { role: 'finance', status: 'active' },
    'tl-a': { role: 'team_lead', status: 'active' },
  };
  let available: Set<string>;
  let movedMeanwhile: boolean;

  function build() {
    const prisma = {
      callbackTask: {
        findUnique: jest.fn(async ({ where }) => callbacks[where.id] ?? null),
        findUniqueOrThrow: jest.fn(async ({ where }) => callbacks[where.id]),
        update: jest.fn(async ({ where, data }) => (callbacks[where.id] = { ...callbacks[where.id], ...data })),
        updateMany: jest.fn(async ({ where, data }) => {
          const row = callbacks[where.id];
          if (movedMeanwhile || !row || row.assignedToStaffId !== where.assignedToStaffId || row.status !== where.status) {
            return { count: 0 };
          }
          callbacks[where.id] = { ...row, ...data };
          return { count: 1 };
        }),
      },
      staff: {
        findUnique: jest.fn(async ({ where }) => staff[where.id] ?? null),
        findMany: jest.fn(async ({ where }) => (team[where.teamLeadId] ?? []).map((id) => ({ id }))),
      },
    };
    const attendance = {
      isAvailable: jest.fn(async (id: string) => available.has(id)),
      nextAvailableAgent: jest.fn(async () => (available.has('agent-b1') ? 'agent-b1' : null)),
    };
    const scope = { peopleUnder: jest.fn(async (id: string) => team[id] ?? []) };
    const service = new TelephonyService({} as never, prisma as never, attendance as never, undefined, scope as never);
    return { service, attendance };
  }
  const as = (sub: string, role: string) => ({ sub, role, code: 'X', email: null });

  beforeEach(() => {
    callbacks = {
      'cb-free': { id: 'cb-free', assignedToStaffId: null, status: 'pending' },
      'cb-a': { id: 'cb-a', assignedToStaffId: 'agent-a1', status: 'assigned' },
      'cb-b': { id: 'cb-b', assignedToStaffId: 'agent-b1', status: 'assigned' },
    };
    available = new Set(['agent-a1', 'agent-a2', 'agent-b1']);
    movedMeanwhile = false;
  });

  describe('call agents', () => {
    it('take an unassigned missed call, or give it to a colleague', async () => {
      const { service } = build();
      await expect(service.assignCallback('cb-free', 'agent-a1', as('agent-a1', 'call_agent'))).resolves.toMatchObject({ assignedToStaffId: 'agent-a1' });
      callbacks['cb-free'] = { id: 'cb-free', assignedToStaffId: null, status: 'pending' };
      await expect(service.assignCallback('cb-free', 'agent-b1', as('agent-a1', 'call_agent'))).resolves.toMatchObject({ assignedToStaffId: 'agent-b1' });
    });

    it('hand over one they hold', async () => {
      const { service } = build();
      await expect(service.assignCallback('cb-a', 'agent-b1', as('agent-a1', 'call_agent'))).resolves.toMatchObject({ assignedToStaffId: 'agent-b1' });
    });

    it('cannot move one someone else holds', async () => {
      const { service } = build();
      await expect(service.assignCallback('cb-b', 'agent-a1', as('agent-a1', 'call_agent'))).rejects.toThrow(/held by someone else/);
    });

    it('complete only their own or unassigned missed calls', async () => {
      const { service } = build();
      await expect(service.completeCallback('cb-b', as('agent-a1', 'call_agent'))).rejects.toThrow(ForbiddenException);
      await expect(service.completeCallback('cb-a', as('agent-a1', 'call_agent'))).resolves.toMatchObject({ status: 'completed' });
      await expect(service.completeCallback('cb-free', as('agent-a1', 'call_agent'))).resolves.toMatchObject({ status: 'completed' });
    });
  });

  describe('Team Leads', () => {
    it('cannot assign another team\'s missed call, or to another team\'s agent', async () => {
      const { service } = build();
      await expect(service.assignCallback('cb-b', 'agent-a1', as('tl-a', 'team_lead'))).rejects.toThrow(ForbiddenException);
      await expect(service.assignCallback('cb-free', 'agent-b1', as('tl-a', 'team_lead'))).rejects.toThrow(/not part of your team/);
    });

    it('assign unassigned and own-team missed calls to their own agents', async () => {
      const { service } = build();
      await expect(service.assignCallback('cb-free', 'agent-a1', as('tl-a', 'team_lead'))).resolves.toMatchObject({ assignedToStaffId: 'agent-a1' });
      await expect(service.assignCallback('cb-a', 'agent-a2', as('tl-a', 'team_lead'))).resolves.toMatchObject({ assignedToStaffId: 'agent-a2' });
    });

    it('when their agent is not Available, the call goes to someone else on the team, never outside it', async () => {
      const { service, attendance } = build();
      available = new Set(['agent-a2', 'agent-b1']);
      await expect(service.assignCallback('cb-free', 'agent-a1', as('tl-a', 'team_lead'))).resolves.toMatchObject({ assignedToStaffId: 'agent-a2' });
      expect(attendance.nextAvailableAgent).not.toHaveBeenCalled();
    });

    it('complete only unassigned or own-team missed calls', async () => {
      const { service } = build();
      await expect(service.completeCallback('cb-b', as('tl-a', 'team_lead'))).rejects.toThrow(ForbiddenException);
      await expect(service.completeCallback('cb-a', as('tl-a', 'team_lead'))).resolves.toMatchObject({ status: 'completed' });
    });
  });

  it('Managers and the CEO assign and complete any missed call', async () => {
    const { service } = build();
    await expect(service.assignCallback('cb-b', 'agent-a1', as('ceo', 'ceo'))).resolves.toMatchObject({ assignedToStaffId: 'agent-a1' });
    await expect(service.assignCallback('cb-a', 'agent-b1', as('mgr', 'manager'))).resolves.toMatchObject({ assignedToStaffId: 'agent-b1' });
    await expect(service.completeCallback('cb-b', as('mgr', 'manager'))).resolves.toMatchObject({ status: 'completed' });
  });

  it('a missed call goes only to an active call or field agent (no 500 for an unknown id)', async () => {
    const { service } = build();
    for (const who of ['nobody', 'agent-gone', 'fin-1', 'tl-a']) {
      await expect(service.assignCallback('cb-free', who, as('ceo', 'ceo'))).rejects.toThrow(BadRequestException);
    }
  });

  it('says so when nobody is Available, and leaves the missed call where it was', async () => {
    const { service } = build();
    available = new Set();
    await expect(service.assignCallback('cb-free', 'agent-a1', as('ceo', 'ceo'))).rejects.toThrow(ConflictException);
    await expect(service.assignCallback('cb-free', 'agent-a1', as('tl-a', 'team_lead'))).rejects.toThrow(/Nobody on your team is Available/);
    expect(callbacks['cb-free'].assignedToStaffId).toBeNull();
  });

  it('does not overwrite a change made in between (the update checks who held it)', async () => {
    const { service } = build();
    movedMeanwhile = true;
    await expect(service.assignCallback('cb-free', 'agent-a1', as('agent-a1', 'call_agent'))).rejects.toThrow(/changed this missed call/);
  });
});
