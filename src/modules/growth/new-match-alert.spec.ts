import { NewMatchAlertService } from './new-match-alert.service';

/** Guide: the field agent is alerted when a new job seeker registers who matches one of their businesses' open vacancies. */
describe('new match alert to the field agent', () => {
  const now = new Date('2026-11-12T08:00:00Z');
  function setup(opts: { fresh?: number; suitable?: Map<string, string[] | null> } = {}) {
    const prisma = {
      jobSeeker: {
        count: jest.fn().mockResolvedValue(opts.fresh ?? 1),
        findMany: jest.fn().mockResolvedValue([{ id: 'js-1', code: 'JS-00205', name: 'Manjula Devi' }]),
      },
      staff: { findMany: jest.fn().mockResolvedValue([{ id: 'fa-1' }]) },
      vacancy: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'v-1', code: 'VC-00012', tradeSkill: 'cook', business: { id: 'b-1', name: 'Metro Mart', accountAgentId: 'fa-1' } },
          { id: 'v-2', code: 'VC-00013', tradeSkill: 'helper', business: { id: 'b-1', name: 'Metro Mart', accountAgentId: 'fa-1' } },
        ]),
      },
    };
    const matching = { suitableSeekerIds: jest.fn().mockResolvedValue(opts.suitable ?? new Map([['v-1', ['js-1']], ['v-2', []]])) };
    const notifications = { open: jest.fn().mockResolvedValue({ id: 'n-1' }) };
    const sources = { registerRequestSource: jest.fn() };
    const service = new NewMatchAlertService(prisma as never, matching as never, notifications as never, sources as never);
    return { service, prisma, matching, notifications, sources };
  }

  it('is swept with the bells', () => {
    const { service, sources } = setup();
    service.onModuleInit();
    expect(sources.registerRequestSource).toHaveBeenCalledWith('new match alerts', expect.any(Function));
  });

  it('rings the account agent once per vacancy and new job seeker, with code and first name only', async () => {
    const { service, matching, notifications } = setup();
    expect(await service.sweep(now)).toEqual({ alerted: 1 });
    // Only job seekers who became active in the last day are matched, with the engine's own rules.
    expect(matching.suitableSeekerIds).toHaveBeenCalledWith(['v-1', 'v-2'], { status: 'active', paymentReceivedAt: { gte: new Date('2026-11-11T08:00:00Z'), lte: now } });
    expect(notifications.open).toHaveBeenCalledTimes(1);
    const draft = notifications.open.mock.calls[0][0];
    expect(draft).toMatchObject({ recipientStaffId: 'fa-1', kind: 'new_match_registered', subjectType: 'vacancy_new_match', subjectId: 'v-1:js-1', once: true });
    expect(draft.title).toContain('VC-00012');
    expect(draft.body).toContain('JS-00205 Manjula');
    expect(`${draft.title} ${draft.body}`).not.toMatch(/Devi|\+91|₹/);
  });

  it('does nothing when nobody new registered, or a vacancy cannot be shown candidates', async () => {
    const quiet = setup({ fresh: 0 });
    expect(await quiet.service.sweep(now)).toEqual({ alerted: 0 });
    expect(quiet.matching.suitableSeekerIds).not.toHaveBeenCalled();
    const blocked = setup({ suitable: new Map([['v-1', null], ['v-2', null]]) });
    expect(await blocked.service.sweep(now)).toEqual({ alerted: 0 });
    expect(blocked.notifications.open).not.toHaveBeenCalled();
  });

  it('counts a pair already alerted (once) as no new alert', async () => {
    const { service, notifications } = setup();
    notifications.open.mockResolvedValue(null);
    expect(await service.sweep(now)).toEqual({ alerted: 0 });
  });
});
