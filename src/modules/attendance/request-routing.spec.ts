import { placementOf, whereLabel } from './request-routing';

const created = new Date('2027-05-12T04:30:00.000Z');
const hours = (n: number) => new Date(created.getTime() + n * 3600 * 1000);

function request(overrides: Partial<Parameters<typeof placementOf>[0]> = {}) {
  return {
    status: 'pending',
    routedToRole: 'team_lead',
    routeReason: 'team_lead',
    forwardedAt: null,
    createdAt: created,
    ...overrides,
  };
}

describe('Phase 21 Task 4: where a request sits', () => {
  it('stays with the Team Lead and also reaches the Manager at 24 hours', () => {
    expect(placementOf(request(), hours(23.99))).toMatchObject({
      withTeamLead: true,
      withManager: false,
      withCeo: false,
    });
    expect(placementOf(request(), hours(24))).toMatchObject({
      withTeamLead: true,
      withManager: true,
      managerReason: 'team_lead_24h',
      withCeo: false,
    });
  });

  it('reaches the CEO 48 hours after it reached the Manager, staying with both', () => {
    expect(placementOf(request(), hours(71.99)).withCeo).toBe(false);
    expect(placementOf(request(), hours(72))).toMatchObject({
      withTeamLead: true,
      withManager: true,
      withCeo: true,
      ceoReason: 'manager_48h',
    });
    const overLimit = request({ routedToRole: 'manager', routeReason: 'over_limit' });
    expect(placementOf(overLimit, hours(47))).toMatchObject({
      withTeamLead: false,
      withManager: true,
      managerReason: 'over_limit',
      withCeo: false,
    });
    expect(placementOf(overLimit, hours(48)).withCeo).toBe(true);
  });

  it('a forwarded request leaves the Team Lead and starts the Manager clock', () => {
    const forwarded = request({ forwardedAt: hours(2) });
    expect(placementOf(forwarded, hours(3))).toMatchObject({
      withTeamLead: false,
      withManager: true,
      managerReason: 'forwarded',
    });
    expect(placementOf(forwarded, hours(50)).withCeo).toBe(true);
  });

  it('a request sent to the CEO is with the CEO only, and a decided one is with nobody', () => {
    expect(placementOf(request({ routedToRole: 'ceo', routeReason: 'manager_own' }), hours(0))).toMatchObject({
      withTeamLead: false,
      withManager: false,
      withCeo: true,
      ceoReason: 'manager_own',
    });
    const decided = placementOf(request({ status: 'approved' }), hours(100));
    expect(decided).toMatchObject({ withTeamLead: false, withManager: false, withCeo: false });
    expect(whereLabel(decided, 'approved')).toBe('decided');
  });

  it('sent back by the Manager: with the Team Lead only, and the 24 hours start again from the send-back', () => {
    // Over the limit, it went to the Manager; the Manager sent it back on day 3.
    const sentBack = request({ routedToRole: 'team_lead', routeReason: 'sent_back', sentBackAt: hours(50) });
    expect(placementOf(sentBack, hours(73.99))).toMatchObject({ withTeamLead: true, withManager: false, withCeo: false });
    expect(placementOf(sentBack, hours(74))).toMatchObject({ withTeamLead: true, withManager: true, managerReason: 'team_lead_24h', withCeo: false });
    expect(placementOf(sentBack, hours(122)).withCeo).toBe(true);
    expect(whereLabel(placementOf(sentBack, hours(51)), 'pending')).toBe('with_team_lead');
  });
});
