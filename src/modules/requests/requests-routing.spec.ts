import { effectiveOwner } from './flag-escalation.service';
import {
  Chain,
  canOverturnLevel,
  claimPlacement,
  deciderOf,
  deviceRoute,
  routeStaffRequest,
  startOfWeekIst,
} from './requests-routing';
import { dayLabel, ordinal, parseRef } from './requests.service';

const tl = { id: 'tl', code: 'TL-1', name: 'Ravi', role: 'team_lead' };
const mg = { id: 'mg', code: 'MGR-1', name: 'Priya', role: 'manager' };
const ceo = { id: 'ceo', code: 'CEO-1', name: 'CEO', role: 'ceo' };
const full: Chain = { teamLead: tl, manager: mg, ceo };
const HOUR = 3600 * 1000;

describe('routing a request with no table of its own', () => {
  it("sends an agent's hit removal to their Team Lead, and the 3rd removal on one job seeker to the Manager", () => {
    expect(routeStaffRequest({ kind: 'hit_removal', personRole: 'call_agent', chain: full, ceoId: 'ceo', earlier: 0 })).toEqual({
      routedToRole: 'team_lead',
      routedToStaffId: 'tl',
      routeReason: 'team_lead',
    });
    expect(routeStaffRequest({ kind: 'hit_removal', personRole: 'call_agent', chain: full, ceoId: 'ceo', earlier: 1 }).routedToRole).toBe('team_lead');
    expect(routeStaffRequest({ kind: 'hit_removal', personRole: 'call_agent', chain: full, ceoId: 'ceo', earlier: 2 })).toEqual({
      routedToRole: 'manager',
      routedToStaffId: 'mg',
      routeReason: 'third_hit',
    });
  });

  it("sends a 3rd day change in a month to the Manager, and a Team Lead's own day to the Manager", () => {
    expect(routeStaffRequest({ kind: 'day_change', personRole: 'field_agent', chain: full, ceoId: 'ceo', earlier: 1 }).routedToRole).toBe('team_lead');
    expect(routeStaffRequest({ kind: 'day_change', personRole: 'field_agent', chain: full, ceoId: 'ceo', earlier: 2 }).routeReason).toBe('third_day_change');
    expect(routeStaffRequest({ kind: 'day_change', personRole: 'team_lead', chain: { ...full, teamLead: null }, ceoId: 'ceo', earlier: 0 })).toEqual({
      routedToRole: 'manager',
      routedToStaffId: 'mg',
      routeReason: 'team_lead_own',
    });
  });

  it('sends target changes and written warnings straight to the Manager (only a Manager decides)', () => {
    expect(routeStaffRequest({ kind: 'target_change', personRole: 'call_agent', chain: full, ceoId: 'ceo', earlier: 0 }).routeReason).toBe('target_change');
    expect(routeStaffRequest({ kind: 'written_warning', personRole: 'call_agent', chain: full, ceoId: 'ceo', earlier: 0 }).routedToStaffId).toBe('mg');
  });

  it('sends anything with nobody above to the CEO as "no reporting line"', () => {
    expect(routeStaffRequest({ kind: 'hit_removal', personRole: 'call_agent', chain: { teamLead: null, manager: null, ceo: null }, ceoId: 'ceo', earlier: 0 })).toEqual({
      routedToRole: 'ceo',
      routedToStaffId: 'ceo',
      routeReason: 'no_line',
    });
  });
});

describe('devices and claims as requests', () => {
  it("routes an agent's device to the Team Lead, a Team Lead's to the Manager, a Manager's or Finance's to the CEO", () => {
    expect(deviceRoute('call_agent', full, 'ceo').routeReason).toBe('device_agent');
    expect(deviceRoute('team_lead', full, 'ceo')).toEqual({ routedToRole: 'manager', routedToStaffId: 'mg', routeReason: 'device_team_lead' });
    expect(deviceRoute('finance', full, 'ceo').routedToRole).toBe('ceo');
  });

  it('keeps a claim with the Team Lead for 24 hours, then with the Manager too, and with the CEO past the 48-hour limit', () => {
    const reportedAt = new Date('2026-11-10T04:00:00Z');
    const decisionDueAt = new Date(reportedAt.getTime() + 48 * HOUR);
    const early = claimPlacement({ reportedAt, decisionDueAt, hasTeamLead: true, now: new Date(reportedAt.getTime() + 2 * HOUR) });
    expect([early.withTeamLead, early.withManager, early.withCeo]).toEqual([true, false, false]);
    expect(deciderOf(early, 'pending')).toBe('team_lead');
    const day2 = claimPlacement({ reportedAt, decisionDueAt, hasTeamLead: true, now: new Date(reportedAt.getTime() + 26 * HOUR) });
    expect([day2.withTeamLead, day2.withManager, day2.withCeo, day2.managerReason]).toEqual([true, true, false, 'claim_24h']);
    const late = claimPlacement({ reportedAt, decisionDueAt, hasTeamLead: true, now: new Date(reportedAt.getTime() + 49 * HOUR) });
    expect(late.withCeo).toBe(true);
    const noTeam = claimPlacement({ reportedAt, decisionDueAt, hasTeamLead: false, now: reportedAt });
    expect([noTeam.withTeamLead, noTeam.withManager]).toEqual([false, true]);
  });
});

describe('overturning, one level up only', () => {
  it("lets a Manager overturn a Team Lead's decision and the CEO a Manager's — nothing else", () => {
    expect(canOverturnLevel('manager', 'team_lead')).toBe(true);
    expect(canOverturnLevel('manager', 'manager')).toBe(false);
    expect(canOverturnLevel('ceo', 'manager')).toBe(true);
    expect(canOverturnLevel('ceo', 'team_lead')).toBe(false);
    expect(canOverturnLevel('team_lead', 'team_lead')).toBe(false);
  });
});

describe('who owns a review flag', () => {
  it('gives money and bypass flags to the CEO, whatever the stored owner', () => {
    expect(effectiveOwner({ kind: 'bypass_suspected', ownerRole: null }, 'field_agent')).toBe('ceo');
    expect(effectiveOwner({ kind: 'payment_mismatch', ownerRole: 'team_lead' }, 'call_agent')).toBe('ceo');
  });

  it("gives an agent's flag to the Team Lead until it is sent up", () => {
    expect(effectiveOwner({ kind: 'visit_short', ownerRole: null }, 'field_agent')).toBe('team_lead');
    expect(effectiveOwner({ kind: 'visit_short', ownerRole: 'manager' }, 'field_agent')).toBe('manager');
    expect(effectiveOwner({ kind: 'odd_hour_login', ownerRole: null }, 'team_lead')).toBe('manager');
    expect(effectiveOwner({ kind: 'odd_hour_login', ownerRole: null }, 'manager')).toBe('ceo');
  });
});

describe('small helpers', () => {
  it('reads request references and writes plain dates', () => {
    expect(parseRef('leave.abc-123')).toEqual(['leave', 'abc-123']);
    expect(parseRef('hit_removal.9f1c-2')).toEqual(['hit_removal', '9f1c-2']);
    expect(() => parseRef('nope.1')).toThrow();
    expect(() => parseRef('leave')).toThrow();
    expect(dayLabel('2026-11-11')).toBe('Wed 11 Nov');
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
  });

  it('starts the week on Monday 00:00 IST', () => {
    // Wednesday 11 Nov 2026, 10:00 IST → Monday 9 Nov 00:00 IST = Sunday 8 Nov 18:30 UTC.
    expect(startOfWeekIst(new Date('2026-11-11T04:30:00Z')).toISOString()).toBe('2026-11-08T18:30:00.000Z');
    // Monday 00:10 IST is still that Monday.
    expect(startOfWeekIst(new Date('2026-11-08T18:40:00Z')).toISOString()).toBe('2026-11-08T18:30:00.000Z');
  });
});
