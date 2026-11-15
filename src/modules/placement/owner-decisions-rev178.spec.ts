import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { claimClockPaused, claimPausedMs, claimRefundPause, resumeEndedSuspensions } from './claim-clock';
import { CLOCK_PAUSED_REASON, evaluatePlacementRefundEligibility } from './placement-refund-eligibility';
import { chainRefundsByRoot, refundBasis } from './chain-refund';
import { PlacementService } from './placement.service';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-12-01T06:00:00Z');

describe('M10 (rev 178): the 15-day replacement clock pauses while the business is suspended', () => {
  const reported = new Date(NOW.getTime() - 20 * DAY);
  const base = { code: 'PL-00001', status: 'dropped_out', dropoutReportedAt: reported, placementFee: 1000000, hasExistingRefund: false, searchDays: 15 };

  it('counts earlier pauses and the running one; a permanent suspension keeps it paused', () => {
    const claim = { searchPausedAt: new Date(NOW.getTime() - 2 * DAY), searchPausedSeconds: 3 * 24 * 3600 };
    expect(claimPausedMs(claim, { suspendedAt: claim.searchPausedAt, suspendedUntil: null }, NOW)).toBe(5 * DAY);
    expect(claimClockPaused(claim, { suspendedAt: claim.searchPausedAt, suspendedUntil: null }, NOW)).toBe(true);
    // A 30-day suspension that ended yesterday: the pause stops at its end date even before the daily job runs.
    const ended = { suspendedAt: new Date(NOW.getTime() - 31 * DAY), suspendedUntil: new Date(NOW.getTime() - DAY) };
    expect(claimPausedMs({ searchPausedAt: ended.suspendedAt, searchPausedSeconds: 0 }, ended, NOW)).toBe(30 * DAY);
    expect(claimClockPaused({ searchPausedAt: ended.suspendedAt, searchPausedSeconds: 0 }, ended, NOW)).toBe(false);
    expect(claimPausedMs(null, null, NOW)).toBe(0);
  });

  it('a refund is not due while paused, and afterwards the clock continues from where it stopped', () => {
    expect(evaluatePlacementRefundEligibility({ ...base, searchPaused: true }, NOW)).toMatchObject({ eligible: false, ineligibleReason: CLOCK_PAUSED_REASON });
    // 20 days since the report, 8 of them paused: 12 days counted — not due yet.
    expect(evaluatePlacementRefundEligibility({ ...base, pausedMs: 8 * DAY }, NOW)).toMatchObject({ eligible: false, daysElapsed: 12 });
    expect(evaluatePlacementRefundEligibility({ ...base, pausedMs: 4 * DAY }, NOW)).toMatchObject({ eligible: true, daysElapsed: 16, daysOwed: 1 });
  });

  it('M3 (rev 181): a refund already due before the suspension began stays owed during and after it', () => {
    // Reported 20 days ago; suspended 3 days ago — the 15 days were complete 2 days before the pause began.
    const pausedAt = new Date(NOW.getTime() - 3 * DAY);
    const pause = claimRefundPause({ searchPausedAt: pausedAt, searchPausedSeconds: 0 }, { suspendedAt: pausedAt, suspendedUntil: null }, NOW);
    expect(pause.searchPaused).toBe(true);
    expect(evaluatePlacementRefundEligibility({ ...base, ...pause }, NOW)).toMatchObject({ eligible: true, daysElapsed: 20, daysOwed: 5 });
    // Suspended 10 days ago: only 10 days had run — that window pauses.
    const early = new Date(NOW.getTime() - 10 * DAY);
    const running = claimRefundPause({ searchPausedAt: early, searchPausedSeconds: 0 }, { suspendedAt: early, suspendedUntil: null }, NOW);
    expect(evaluatePlacementRefundEligibility({ ...base, ...running }, NOW)).toMatchObject({ eligible: false, ineligibleReason: CLOCK_PAUSED_REASON });
  });

  it('the daily job folds a suspension that ended on its date into the claim', async () => {
    const until = new Date(NOW.getTime() - DAY);
    const pausedAt = new Date(until.getTime() - 10 * DAY);
    const client = {
      business: { findMany: jest.fn().mockResolvedValue([{ id: 'bz-1', suspendedUntil: until }]) },
      replacementClaim: { findMany: jest.fn().mockResolvedValue([{ id: 'cl-1', searchPausedAt: pausedAt, searchPausedSeconds: 60 }]), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    expect(await resumeEndedSuspensions(client as never, NOW)).toBe(1);
    expect(client.replacementClaim.updateMany).toHaveBeenCalledWith({ where: { id: 'cl-1', searchPausedAt: pausedAt, searchPausedSeconds: 60 }, data: { searchPausedAt: null, searchPausedSeconds: 60 + 10 * 24 * 3600 } });
  });
});

describe('M4 (rev 178): the refund is the first fee plus every paid salary difference', () => {
  it('sums each chain, each part with its own GST; cancelled or unpaid differences are left out by the query', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { id: 'up-1', rootPlacementId: 'root-1', placementFee: 100000, gstAmount: 18000 },
      { id: 'root-1', rootPlacementId: null, placementFee: 1000000, gstAmount: 180000 },
      { id: 'root-2', rootPlacementId: null, placementFee: 750000, gstAmount: 135000 },
    ]);
    const out = await chainRefundsByRoot({ placement: { findMany } } as never, ['root-1', 'root-2', 'root-1']);
    expect(out.get('root-1')).toEqual({
      feePaise: 1100000, gstPaise: 198000,
      parts: [
        { placementId: 'root-1', kind: 'placement_fee', feePaise: 1000000, gstPaise: 180000 },
        { placementId: 'up-1', kind: 'salary_difference', feePaise: 100000, gstPaise: 18000 },
      ],
    });
    expect(out.get('root-2')?.feePaise).toBe(750000);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [{ id: { in: ['root-1', 'root-2'] } }, { rootPlacementId: { in: ['root-1', 'root-2'] }, salaryUpgradeDifferencePaise: { not: null }, paidAt: { not: null }, status: { not: 'cancelled' } }] },
    }));
  });
});

describe('Review M1: credit notes and FN-Refund measure a refund against its saved parts', () => {
  it('sums the parts saved at approval; an older refund without them falls back to its placement', () => {
    expect(refundBasis([{ placementId: 'r', kind: 'placement_fee', feePaise: 1000000, gstPaise: 180000 }, { placementId: 'u', kind: 'salary_difference', feePaise: 100000, gstPaise: 18000 }], { placementFee: 0, gstAmount: 0 }))
      .toEqual({ feePaise: 1100000, gstPaise: 198000 });
    expect(refundBasis(null, { placementFee: 800000, gstAmount: 144000 })).toEqual({ feePaise: 800000, gstPaise: 144000 });
  });
});

describe('M2 (rev 178): an unpaid salary difference cancels the replacement', () => {
  function build(placement: Record<string, unknown> = {}) {
    const row = {
      id: 'pl-up', code: 'PL-00050', city: 'Bengaluru', status: 'awaiting_payment', businessId: 'bz-1', jobSeekerId: 'js-up', vacancyId: 'vac-up', interviewId: 'int-up',
      countsAsReplacement: true, salaryUpgradeDifferencePaise: 200000, business: { id: 'bz-1', name: 'Sri Sai Hotel', phone: '+919811100000', city: 'Bengaluru' }, jobSeeker: { id: 'js-up', status: 'active' },
      ...placement,
    };
    const prisma = {
      staff: { findUnique: jest.fn(async ({ where }: { where: { id: string } }) => ({ mgr: { id: 'mgr', role: 'manager' }, tl: { id: 'tl', role: 'team_lead' } } as Record<string, unknown>)[where.id] ?? null), findFirst: jest.fn().mockResolvedValue({ id: 'ceo' }) },
      placement: { findMany: jest.fn().mockResolvedValue([{ id: 'pl-up' }]), findUnique: jest.fn().mockResolvedValue(row), findFirst: jest.fn().mockResolvedValue(row), updateMany: jest.fn().mockResolvedValue({ count: 1 }), count: jest.fn().mockResolvedValue(0) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      payment: { findMany: jest.fn().mockResolvedValue([{ id: 'pay-up' }]), updateMany: jest.fn() },
      vacancy: { updateMany: jest.fn() },
      replacementCandidate: { updateMany: jest.fn() },
      jobSeeker: { update: jest.fn() },
      statusHistory: { create: jest.fn() },
      business: { findMany: jest.fn().mockResolvedValue([]) },
    };
    Object.assign(prisma, { $transaction: jest.fn(async (cb: (tx: unknown) => unknown): Promise<unknown> => cb(prisma)) });
    const audit = { log: jest.fn() };
    const pricing = { current: jest.fn().mockResolvedValue({ upgradePaymentCancelDays: 7 }) };
    const messaging = { send: jest.fn().mockResolvedValue({}) };
    const notifications = { notify: jest.fn().mockResolvedValue({}) };
    const scope = { peopleUnder: jest.fn().mockResolvedValue(['tl-9', 'fa-9']) };
    const service = new PlacementService(
      prisma as never, {} as never, audit as never, {} as never, {} as never, pricing as never, {} as never, {} as never, {} as never,
      messaging as never, notifications as never, scope as never,
    );
    return { service, prisma, audit, messaging, notifications, scope };
  }

  it('the daily job cancels requests older than Settings\' days: payment closed, vacancy reopened, candidate freed, not counted', async () => {
    const { service, prisma, audit, messaging, notifications } = build();
    expect(await service.cancelUnpaidUpgrades(NOW)).toBe(1);
    expect(prisma.placement.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'awaiting_payment', salaryUpgradeDifferencePaise: { not: null }, rootPlacementId: { not: null }, selectedAt: { lte: new Date(NOW.getTime() - 7 * DAY) } },
    }));
    expect(prisma.placement.updateMany).toHaveBeenCalledWith({ where: { id: 'pl-up', status: 'awaiting_payment' }, data: { status: 'cancelled', countsAsReplacement: false, paymentDueAt: null } });
    expect(prisma.payment.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['pay-up'] }, status: 'pending' }, data: { status: 'failed' } });
    expect(prisma.vacancy.updateMany).toHaveBeenCalledWith({ where: { id: 'vac-up', status: 'filled' }, data: { status: 'open' } });
    expect(prisma.replacementCandidate.updateMany).toHaveBeenCalledWith({ where: { interviewId: 'int-up', status: 'accepted' }, data: { status: 'cancelled' } });
    expect(prisma.jobSeeker.update).not.toHaveBeenCalled(); // never placed by an unpaid difference
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'placement.replacement_upgrade_cancelled', actorId: 'ceo', after: expect.objectContaining({ automatic: true }) }));
    expect(notifications.notify).toHaveBeenCalledWith({ businessId: 'bz-1' }, 'replacement_cancelled', {}, expect.anything());
    expect(messaging.send).toHaveBeenCalledWith(expect.objectContaining({ channel: 'sms', template: 'replacement_upgrade_cancelled', subjectId: 'bz-1' }));
  });

  it('an older record that placed him puts him back to available — unless another placement of his is confirmed or running (H3)', async () => {
    const { service, prisma } = build({ jobSeeker: { id: 'js-up', status: 'placed' } });
    await service.cancelUnpaidUpgrades(NOW);
    expect(prisma.$queryRaw).toHaveBeenCalled(); // the placement row is locked first (same order as a payment)
    expect(prisma.jobSeeker.update).toHaveBeenCalledWith({ where: { id: 'js-up' }, data: { status: 'active' } });
    const working = build({ jobSeeker: { id: 'js-up', status: 'placed' } });
    working.prisma.placement.count.mockResolvedValue(1);
    await working.service.cancelUnpaidUpgrades(NOW);
    expect(working.prisma.placement.count).toHaveBeenCalledWith({ where: { jobSeekerId: 'js-up', id: { not: 'pl-up' }, status: { in: ['confirmed', 'active'] } } });
    expect(working.prisma.jobSeeker.update).not.toHaveBeenCalled();
  });

  it('M5: one row failing never stops the others, and ended suspensions are always folded in', async () => {
    const { service, prisma } = build();
    prisma.placement.findMany.mockResolvedValueOnce([{ id: 'pl-bad' }, { id: 'pl-up' }]);
    prisma.placement.findUnique.mockRejectedValueOnce(new Error('row locked too long'));
    expect(await service.cancelUnpaidUpgrades(NOW)).toBe(1);
    expect(prisma.business.findMany).toHaveBeenCalled();
  });

  it('tells the selected job seeker too, in the app and by SMS', async () => {
    const { service, messaging, notifications } = build();
    await service.cancelUnpaidUpgrades(NOW);
    expect(notifications.notify).toHaveBeenCalledWith({ jobSeekerId: 'js-up' }, 'selection_cancelled', {}, expect.anything());
    expect(messaging.send).toHaveBeenCalledWith(expect.objectContaining({ template: 'selection_cancelled', subjectType: 'job_seeker', subjectId: 'js-up' }));
  });

  it('"Cancel now": Manager or CEO only, with a reason, audited; nothing else is cancelled', async () => {
    const { service, audit } = build();
    await expect(service.cancelUpgradeNow('PL-00050', 'tl', { reason: 'Owner refuses to pay' }, NOW)).rejects.toThrow(ForbiddenException);
    await expect(service.cancelUpgradeNow('PL-00050', 'mgr', { reason: '' }, NOW)).rejects.toThrow(BadRequestException);
    expect(await service.cancelUpgradeNow('PL-00050', 'mgr', { reason: 'Owner refuses to pay' }, NOW)).toEqual({ cancelled: true, placementId: 'pl-up' });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'mgr', reason: 'Owner refuses to pay', after: expect.objectContaining({ automatic: false }) }));
    // A Manager only within their own tree (the CEO sees all).
    const m = build();
    await m.service.cancelUpgradeNow('PL-00050', 'mgr', { reason: 'Owner refuses to pay' }, NOW);
    expect(m.scope.peopleUnder).toHaveBeenCalledWith('mgr');
    expect(m.prisma.placement.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [expect.objectContaining({ OR: expect.arrayContaining([{ createdByStaffId: { in: ['mgr', 'tl-9', 'fa-9'] } }]) }), { OR: [{ id: 'PL-00050' }, { code: 'PL-00050' }] }] } }));
    m.prisma.placement.findFirst.mockResolvedValueOnce(null);
    await expect(m.service.cancelUpgradeNow('PL-00050', 'mgr', { reason: 'Owner refuses to pay' }, NOW)).rejects.toThrow('not found');
    const paid = build({ status: 'confirmed' });
    await expect(paid.service.cancelUpgradeNow('PL-00050', 'mgr', { reason: 'Owner refuses to pay' }, NOW)).rejects.toThrow(BadRequestException);
  });
});
