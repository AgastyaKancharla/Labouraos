import { ReviewFlag } from '@prisma/client';
import { MONEY_KINDS, NOTIFICATION_KINDS, notificationLink } from './notification.constants';
import { NotificationSourcesService } from './notification-sources.service';
import { DirectoryRow, StaffDirectory } from './staff-directory';

function row(id: string, role: string, reportsToId: string | null = null, status = 'active'): DirectoryRow {
  const agent = role === 'call_agent' || role === 'field_agent';
  return { id, code: id.toUpperCase(), name: id, role, status, reportsToId, teamLeadId: agent ? reportsToId : null };
}

const dir = new StaffDirectory([
  row('ceo', 'ceo'),
  row('mga', 'manager', 'ceo'),
  row('mgb', 'manager', 'ceo'),
  row('tla', 'team_lead', 'mga'),
  row('tlb', 'team_lead', 'mgb'),
  row('fin', 'finance', 'ceo'),
  row('ca1', 'call_agent', 'tla'),
  row('fa1', 'field_agent', 'tla'),
  row('orphan', 'call_agent', null),
  row('gone', 'team_lead', 'mga', 'deactivated'),
]);

function flag(kind: string, raisedForStaffId: string | null, owner: Partial<ReviewFlag> = {}): ReviewFlag {
  return {
    id: `f-${kind}`,
    code: 'RF-1',
    kind,
    subjectType: 'staff',
    subjectId: 'x',
    raisedForStaffId,
    details: null,
    status: 'open',
    raisedAt: new Date(),
    resolvedAt: null,
    resolvedByStaffId: null,
    resolution: null,
    ownerRole: null,
    ownerStaffId: null,
    escalatedAt: null,
    escalatedByStaffId: null,
    escalationNote: null,
    ...owner,
  };
}

const sources = new NotificationSourcesService({} as never, {} as never);
const ids = (rows: DirectoryRow[]) => rows.map((r) => r.id).sort();

describe('notification links', () => {
  it('points each role at its own portal', () => {
    expect(notificationLink('team_lead', 'leave_request', { id: 'r1' })).toBe('/team-lead/requests?kind=leave&id=r1');
    expect(notificationLink('manager', 'leave_request', { id: 'r1' })).toBe('/manager/requests?kind=leave&id=r1');
    expect(notificationLink('finance', 'refund_ready_to_pay', { id: 'p1' })).toBe('/finance/refunds/p1');
    expect(notificationLink('ceo', 'refund_needs_ceo')).toBe('/ceo/refunds');
  });

  it('falls back to the list when the record id is missing, and to nothing for a role without a screen', () => {
    expect(notificationLink('finance', 'refund_ready_to_pay')).toBe('/finance/refunds');
    expect(notificationLink('team_lead', 'leave_request')).toBe('/team-lead/requests');
    expect(notificationLink('field_agent', 'review_flag')).toBeNull();
    expect(notificationLink('manager', 'refund_needs_ceo')).toBeNull();
  });

  it("sends a call agent to their home, not the non-existent /call-agent/people, when the person's id is missing", () => {
    expect(notificationLink('call_agent', 'refund_priority', {})).toBe('/call-agent');
    expect(notificationLink('call_agent', 'agent_reminder', { id: null })).toBe('/call-agent');
    expect(notificationLink('call_agent', 'refund_priority', { id: 'JS-00012' })).toBe('/call-agent/people/JS-00012');
    expect(notificationLink('call_agent', 'agent_reminder', { id: 'JS-00012' })).toBe('/call-agent/people/JS-00012');
    // other detail links still fall back to their list
    expect(notificationLink('finance', 'refund_ready_to_pay', {})).toBe('/finance/refunds');
  });

  it('never links a Manager to a money kind', () => {
    for (const kind of MONEY_KINDS) expect(notificationLink('manager', kind, { id: 'x' })).toBeNull();
    expect(NOTIFICATION_KINDS.length).toBeGreaterThan(MONEY_KINDS.length);
  });
});

describe('staff directory', () => {
  it('walks the line to the Team Lead, Manager and CEO', () => {
    const chain = dir.chainOf('ca1');
    expect([chain.teamLead?.id, chain.manager?.id, chain.ceo?.id]).toEqual(['tla', 'mga', 'ceo']);
  });

  it('knows who has no reporting line', () => {
    expect(dir.hasLine(dir.get('orphan')!)).toBe(false);
    expect(dir.hasLine(dir.get('ca1')!)).toBe(true);
    expect(dir.hasLine(dir.get('ceo')!)).toBe(true);
  });
});

describe('who hears about a review flag', () => {
  it("sends an agent's flag to their own Team Lead and Manager, never the other team's", () => {
    expect(ids(sources.flagRecipients(flag('odd_hour_login', 'ca1'), dir))).toEqual(['mga', 'tla']);
  });

  it("sends a Team Lead's flag to their Manager, and a Manager's to the CEO", () => {
    expect(ids(sources.flagRecipients(flag('odd_hour_login', 'tlb'), dir))).toEqual(['mgb']);
    expect(ids(sources.flagRecipients(flag('odd_hour_login', 'mga'), dir))).toEqual(['ceo']);
  });

  it('sends money flags to the CEO and Finance only', () => {
    expect(ids(sources.flagRecipients(flag('payment_mismatch', 'ca1'), dir))).toEqual(['ceo', 'fin']);
  });

  it('sends a third hit removal to the Manager, a reversed hit to the CEO and Manager, the onboarding review to the Team Lead', () => {
    expect(ids(sources.flagRecipients(flag('hit_reversal_needs_manager', 'tla'), dir))).toEqual(['mga']);
    expect(ids(sources.flagRecipients(flag('hit_reversed', 'tla'), dir))).toEqual(['ceo', 'mga']);
    expect(ids(sources.flagRecipients(flag('in_person_onboarding_review', 'fa1'), dir))).toEqual(['tla']);
  });

  it('tells the account agent about a vacancy added to his business, and gives break overruns no flag bell', () => {
    expect(ids(sources.flagRecipients(flag('vacancy_captured_for_account_business', 'fa1'), dir))).toEqual(['fa1']);
    expect(sources.flagRecipients(flag('break_overrun', 'tla'), dir)).toEqual([]);
  });

  it('falls back to the CEO when the person has no line', () => {
    expect(ids(sources.flagRecipients(flag('odd_hour_login', 'orphan'), dir))).toEqual(['ceo']);
  });

  it('sends a flag sent up by the Team Lead to that Manager only, and one sent to the CEO to the CEO only', () => {
    expect(ids(sources.flagRecipients(flag('visit_short', 'fa1', { ownerRole: 'manager', ownerStaffId: 'mga' }), dir))).toEqual(['mga']);
    expect(ids(sources.flagRecipients(flag('visit_short', 'fa1', { ownerRole: 'ceo' }), dir))).toEqual(['ceo']);
  });

  it("sends a suspected bypass to the CEO, who decides, and the person's Manager", () => {
    expect(ids(sources.flagRecipients(flag('bypass_suspected', 'fa1', { ownerRole: 'ceo' }), dir))).toEqual(['ceo', 'mga']);
  });
});
