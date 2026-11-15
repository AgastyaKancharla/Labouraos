import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { claimClockPaused, claimPausedMs, resumeEndedSuspensions } from './claim-clock';
import { CLOCK_PAUSED_REASON, evaluatePlacementRefundEligibility } from './placement-refund-eligibility';
import { chainRefundsByRoot } from './chain-refund';
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

  it('the daily job folds a suspension that ended on its date into the claim', async () => {
    const until = new Date(NOW.getTime() - DAY);
    const pausedAt = new Date(until.getTime() - 10 * DAY);
    const client = {
      business: { findMany: jest.fn().mockResolvedValue([{ id: 'bz-1', suspendedUntil: until }]) },
      replacementClaim: { findMany: jest.fn().mockResolvedValue([{ id: 'cl-1', searchPausedAt: pausedAt, searchPausedSeconds: 60 }]), update: jest.fn() },
    };
    expect(await resumeEndedSuspensions(client as never, NOW)).toBe(1);
    expect(client.replacementClaim.update).toHaveBeenCalledWith({ where: { id: 'cl-1' }, data: { searchPausedAt: null, searchPausedSeconds: 60 + 10 * 24 * 3600 } });
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

describe('M2 (rev 178): an unpaid salary difference cancels the replacement', () => {
  function build(placement: Record<string, unknown> = {}) {
    const row = {
      id: 'pl-up', code: 'PL-00050', city: 'Bengaluru', status: 'awaiting_payment', businessId: 'bz-1', jobSeekerId: 'js-up', vacancyId: 'vac-up', interviewId: 'int-up',
      countsAsReplacement: true, salaryUpgradeDifferencePaise: 200000, business: { id: 'bz-1', name: 'Sri Sai Hotel', phone: '+919811100000', city: 'Bengaluru' }, jobSeeker: { id: 'js-up', status: 'active' },
      ...placement,
    };
    const prisma = {
      staff: { findUnique: jest.fn(async ({ where }: { where: { id: string } }) => ({ mgr: { id: 'mgr', role: 'manager' }, tl: { id: 'tl', role: 'team_lead' } } as Record<string, unknown>)[where.id] ?? null), findFirst: jest.fn().mockResolvedValue({ id: 'ceo' }) },
      placement: { findMany: jest.fn().mockResolvedValue([{ id: 'pl-up' }]), findUnique: jest.fn().mockResolvedValue(row), findFirst: jest.fn().mockResolvedValue(row), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
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
    const service = new PlacementService(
      prisma as never, {} as never, audit as never, {} as never, {} as never, pricing as never, {} as never, {} as never, {} as never,
      messaging as never, notifications as never,
    );
    return { service, prisma, audit, messaging, notifications };
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

  it('an older record that placed him puts him back to available', async () => {
    const { service, prisma } = build({ jobSeeker: { id: 'js-up', status: 'placed' } });
    await service.cancelUnpaidUpgrades(NOW);
    expect(prisma.jobSeeker.update).toHaveBeenCalledWith({ where: { id: 'js-up' }, data: { status: 'active' } });
  });

  it('"Cancel now": Manager or CEO only, with a reason, audited; nothing else is cancelled', async () => {
    const { service, audit } = build();
    await expect(service.cancelUpgradeNow('PL-00050', 'tl', { reason: 'Owner refuses to pay' }, NOW)).rejects.toThrow(ForbiddenException);
    await expect(service.cancelUpgradeNow('PL-00050', 'mgr', { reason: '' }, NOW)).rejects.toThrow(BadRequestException);
    expect(await service.cancelUpgradeNow('PL-00050', 'mgr', { reason: 'Owner refuses to pay' }, NOW)).toEqual({ cancelled: true, placementId: 'pl-up' });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'mgr', reason: 'Owner refuses to pay', after: expect.objectContaining({ automatic: false }) }));
    const paid = build({ status: 'confirmed' });
    await expect(paid.service.cancelUpgradeNow('PL-00050', 'mgr', { reason: 'Owner refuses to pay' }, NOW)).rejects.toThrow(BadRequestException);
  });
});
