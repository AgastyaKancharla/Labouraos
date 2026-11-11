import { BadRequestException } from '@nestjs/common';
import { PricingPolicy } from '@prisma/client';
import { auditType, changeSummary, flagSeverity, policyChanges } from './ceo-admin.service';
import { countsAs } from './ceo-ops.service';
import { CeoTeamService, paceFor, parseMonth, staffState, teamLabel } from './ceo-team.service';

const NOW = new Date('2026-11-15T06:30:00Z'); // 15 Nov, 12:00 IST

describe('CEO portal part 2 — pure rules', () => {
  it('shows a deactivated, locked, invited or active state in that order', () => {
    expect(staffState({ status: 'deactivated', lockedUntil: new Date('2026-12-01') }, NOW)).toBe('deactivated');
    expect(staffState({ status: 'active', lockedUntil: new Date('2026-11-15T07:00:00Z') }, NOW)).toBe('locked');
    expect(staffState({ status: 'active', lockedUntil: new Date('2026-11-15T06:00:00Z') }, NOW)).toBe('active');
    expect(staffState({ status: 'pending_invite', lockedUntil: null }, NOW)).toBe('invite_pending');
  });

  it('names a team after its Team Lead until the CEO names it', () => {
    expect(teamLabel({ name: 'Ravi Shankar', teamName: null })).toBe('Team Ravi');
    expect(teamLabel({ name: 'Ravi Shankar', teamName: '  Team South ' })).toBe('Team South');
    expect(teamLabel(null)).toBeNull();
  });

  it('flags only after the 10th, and only under 80% of pace', () => {
    expect(paceFor(1, 30, 10, 30)).toBe('early');
    expect(paceFor(0, null, 20, 30)).toBe('no_target');
    // Day 15 of 30, target 30 → 15 expected, 80% = 12.
    expect(paceFor(12, 30, 15, 30)).toBe('on_pace');
    expect(paceFor(11, 30, 15, 30)).toBe('behind');
  });

  it('reads the month from the query or this IST month, and refuses nonsense', () => {
    expect(parseMonth(undefined, undefined, NOW)).toEqual({ year: 2026, month: 11 });
    expect(parseMonth('2026', '12', NOW)).toEqual({ year: 2026, month: 12 });
    expect(() => parseMonth('2026', '13', NOW)).toThrow(BadRequestException);
    expect(() => parseMonth('26', '1', NOW)).toThrow(BadRequestException);
  });

  it('says what a day counts as, from the day rules', () => {
    const base = { leaveKind: null, leaveUnpaid: false, shortfallSeconds: 0, lateMinutes: 0, change: null };
    expect(countsAs({ ...base, dayType: 'full' })).toBe('Full day');
    expect(countsAs({ ...base, dayType: 'full', lateMinutes: 22, shortfallSeconds: 2400 })).toBe('Late · 40m short');
    expect(countsAs({ ...base, dayType: 'full', change: { byStaffId: 'tl', at: '', reason: 'system down' } })).toBe('Changed to full day');
    expect(countsAs({ ...base, dayType: 'absent' })).toBe('Absent · no leave');
    expect(countsAs({ ...base, dayType: 'leave', leaveKind: 'emergency' })).toBe('Emergency leave');
    expect(countsAs({ ...base, dayType: 'leave', leaveKind: 'casual', leaveUnpaid: true })).toBe('Casual leave (unpaid)');
    expect(countsAs({ ...base, dayType: 'half' })).toBe('Half day');
  });

  it('groups audit actions into Money, Corrections, Policy and Logins', () => {
    expect(auditType('refund_approved')).toBe('money');
    expect(auditType('payment.confirmed_manual')).toBe('money');
    expect(auditType('job_seeker.hit_reversed')).toBe('corrections');
    expect(auditType('attendance.day_changed')).toBe('corrections');
    expect(auditType('pricing_change')).toBe('policy');
    expect(auditType('area.merged')).toBe('policy');
    expect(auditType('login_code.revealed')).toBe('logins');
    expect(auditType('staff.locked')).toBe('logins');
    expect(auditType('business.created')).toBe('records');
  });

  it('summarises a change as "field: before → after", at most three fields', () => {
    expect(changeSummary({ offerReplyHours: 24 }, { offerReplyHours: 48 }, ['offerReplyHours'])).toBe('offerReplyHours: 24 → 48');
    expect(changeSummary(null, { status: 'working' }, [])).toBe('status: working');
    expect(changeSummary({}, { a: 1, b: 2, c: 3, d: 4 }, ['a', 'b', 'c', 'd'])!.split(' · ')).toHaveLength(3);
    expect(changeSummary(null, null, [])).toBeNull();
  });

  it('puts bypass and payout fraud first', () => {
    expect(flagSeverity('bypass_suspected')).toBe('high');
    expect(flagSeverity('gps_mismatch')).toBe('medium');
    expect(flagSeverity('odd_hour_login')).toBe('low');
  });

  it('lists only the policy fields that changed between two versions', () => {
    const a = { id: '1', offerReplyHours: 24, maxHits: 3, effectiveFrom: new Date('2026-10-01'), createdAt: new Date(), setByStaffId: 'x', weeklyOffDays: [0] } as unknown as PricingPolicy;
    const b = { ...a, id: '2', offerReplyHours: 48, effectiveFrom: new Date('2026-11-01'), weeklyOffDays: [0, 6] } as unknown as PricingPolicy;
    expect(policyChanges(a, b)).toEqual([
      { field: 'offerReplyHours', before: 24, after: 48 },
      { field: 'weeklyOffDays', before: [0], after: [0, 6] },
    ]);
    expect(policyChanges(null, b)).toEqual([]);
  });
});

describe('CeoTeamService', () => {
  const actor = { sub: 'ceo-1', role: 'ceo', email: null, code: 'CEO-1', teamLeadId: null } as never;

  function make(prisma: Record<string, unknown>, targets = { setTarget: jest.fn().mockResolvedValue({}) }) {
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    return { service: new CeoTeamService(prisma as never, audit as never, targets as never, {} as never, {} as never), audit, targets };
  }

  it('names a Team Lead\'s team and logs the change; refuses anyone who is not a Team Lead', async () => {
    const prisma = {
      staff: {
        findUnique: jest.fn().mockResolvedValue({ id: 'tl', role: 'team_lead', teamName: null, name: 'Ravi Shankar' }),
        update: jest.fn().mockResolvedValue({ id: 'tl', name: 'Ravi Shankar', teamName: 'Team South' }),
      },
    };
    const { service, audit } = make(prisma);
    expect(await service.setTeamName(actor, 'tl', { name: ' Team  South ' })).toEqual({ id: 'tl', teamName: 'Team South', team: 'Team South' });
    expect(prisma.staff.update).toHaveBeenCalledWith(expect.objectContaining({ data: { teamName: 'Team South' } }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'staff.team_named', before: { teamName: null }, after: { teamName: 'Team South' } }));
    prisma.staff.findUnique.mockResolvedValue({ id: 'ca', role: 'call_agent', teamName: null, name: 'Deepa' });
    await expect(service.setTeamName(actor, 'ca', { name: 'X' })).rejects.toThrow(/Only a Team Lead/);
  });

  it('copies last month\'s targets to agents without one, through the normal target rules', async () => {
    const prisma = {
      target: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            { staffId: 'a', candidatesActivated: 30, vacanciesCaptured: 12, refundRate: null, placementsClosed: null, replacementsInside15Days: null, repeatBusinesses: null },
            { staffId: 'b', candidatesActivated: null, vacanciesCaptured: null, refundRate: null, placementsClosed: 12, replacementsInside15Days: null, repeatBusinesses: 3 },
          ])
          .mockResolvedValueOnce([{ staffId: 'b' }]),
      },
    };
    const { service, targets } = make(prisma);
    const out = await service.copyTargets(actor, { fromYear: 2026, fromMonth: 11, toYear: 2026, toMonth: 12 }, NOW);
    expect(out.copied).toBe(1);
    expect(out.skipped).toEqual([{ staffId: 'b', reason: 'already has a target' }]);
    expect(targets.setTarget).toHaveBeenCalledWith(expect.objectContaining({ staffId: 'a', year: 2026, month: 12, candidatesActivated: 30, vacanciesCaptured: 12 }), 'ceo-1', NOW, actor);
    await expect(service.copyTargets(actor, { fromYear: 2026, fromMonth: 12, toYear: 2026, toMonth: 12 }, NOW)).rejects.toThrow(/two different months/);
  });
});
