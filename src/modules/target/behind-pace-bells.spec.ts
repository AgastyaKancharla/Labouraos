import { BehindPaceBellsService, BEHIND_PACE_CHECK_EVERY_MS } from './behind-pace-bells.service';
import { evaluateMetricPace } from './target.constants';

/** Guide, Monthly targets: agents who fall behind pace are flagged to their Team Lead and Manager. */
describe('behind-pace bells for the Team Lead and Manager', () => {
  const now = new Date('2026-11-20T06:00:00Z');
  const agent = { id: 'ca-1', code: 'CA-0042', name: 'Deepa Nair', role: 'call_agent', city: 'Bengaluru', email: null, teamLeadId: 'tl-1', status: 'active' };
  const onPace = { ...agent, id: 'ca-2', code: 'CA-0043', name: 'Kiran' };
  function setup() {
    const prisma = { staff: { findMany: jest.fn().mockResolvedValue([agent, onPace]) } };
    const overview = {
      buildSingleAgentOverview: jest.fn().mockImplementation(async (staff: { id: string }) => ({
        isBehindPace: staff.id === 'ca-1',
        metrics: {
          candidatesActivated: { direction: 'higher_is_better', isBehindPace: staff.id === 'ca-1', label: 'Candidates activated', achieved: 2, effectiveTarget: 12, expectedPace: 7.4 },
          refundRate: { direction: 'lower_is_better', isBehindPace: false, label: 'Refund rate', achieved: 0, effectiveTarget: 10, expectedPace: null },
        },
      })),
    };
    const notifications = { reconcileKind: jest.fn().mockResolvedValue({ opened: 2, cleared: 0 }) };
    const tl = { id: 'tl-1', status: 'active', role: 'team_lead' };
    const mgr = { id: 'mg-1', status: 'active', role: 'manager' };
    const sources = {
      registerRequestSource: jest.fn(),
      directory: jest.fn().mockResolvedValue({ chainOf: () => ({ teamLead: tl, manager: mgr, ceo: null }) }),
      drafts: jest.fn().mockImplementation((people: Array<{ id: string }>, base: Record<string, unknown>) => people.map((p) => ({ ...base, recipientStaffId: p.id }))),
    };
    const service = new BehindPaceBellsService(prisma as never, overview as never, notifications as never, sources as never);
    return { service, overview, notifications, sources };
  }

  it('rings the Team Lead and the Manager for an agent behind pace, in counts, and clears the rest', async () => {
    const { service, notifications } = setup();
    expect(await service.sweep(now)).toMatchObject({ behind: 1 });
    const [kind, drafts] = notifications.reconcileKind.mock.calls[0];
    expect(kind).toBe('behind_pace');
    expect(drafts.map((d: { recipientStaffId: string }) => d.recipientStaffId)).toEqual(['tl-1', 'mg-1']);
    expect(drafts[0]).toMatchObject({ subjectType: 'staff_pace', subjectId: 'ca-1' });
    expect(drafts[0].title).toContain('Deepa Nair (CA-0042) is behind pace');
    expect(drafts[0].body).toBe('Candidates activated: 2 of 12, about 8 by now');
    expect(drafts[0].body).not.toMatch(/₹/);
  });

  it('runs with the bell sweep at most once an hour', async () => {
    const { service, overview, sources } = setup();
    service.onModuleInit();
    expect(sources.registerRequestSource).toHaveBeenCalledWith('behind pace', expect.any(Function));
    await service.sweepIfDue(now);
    await service.sweepIfDue(new Date(now.getTime() + 5 * 60 * 1000));
    expect(overview.buildSingleAgentOverview).toHaveBeenCalledTimes(2);
    await service.sweepIfDue(new Date(now.getTime() + BEHIND_PACE_CHECK_EVERY_MS));
    expect(overview.buildSingleAgentOverview).toHaveBeenCalledTimes(4);
  });

  it('pace uses the Settings start day and threshold when given', () => {
    const base = {
      metric: 'candidatesActivated' as const,
      targetEvaluation: { direction: 'higher_is_better', status: 'active', storedTarget: 10, effectiveTarget: 10 } as never,
      achieved: 3,
      currentDay: 6,
      daysElapsed: 6,
      daysInPeriod: 10,
    };
    // Defaults: nothing before day 8.
    expect(evaluateMetricPace(base).isBehindPace).toBe(false);
    // Settings: from day 5, behind below 60% of 6 = 3.6.
    expect(evaluateMetricPace({ ...base, startDay: 5, thresholdPercent: 60 }).isBehindPace).toBe(true);
    expect(evaluateMetricPace({ ...base, startDay: 5, thresholdPercent: 50 }).isBehindPace).toBe(false);
  });
});
