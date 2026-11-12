import { DAY_MS, SEEKER_ENDED_STATUSES, compareMatches, daysLeftOn, priorityBucket, refundPriorityOf } from './refund-priority.rules';
import { LIVE_REFUND_STATUSES } from '../../common/money/current-guarantee-refund';
import { LIVE_REFUND_STATUSES as GROWTH_LIVE_REFUND_STATUSES } from '../growth/growth.constants';

describe('close-to-refund buckets', () => {
  it.each([
    [0, '0-5'],
    [1, '0-5'],
    [5, '0-5'],
    [6, '6-10'],
    [10, '6-10'],
    [11, '11-15'],
    [15, '11-15'],
  ])('%i days left is in %s', (days, bucket) => {
    expect(priorityBucket(days, 15)).toBe(bucket);
  });

  it('leaves 16 days out of a 15-day window, and a passed deadline too', () => {
    expect(priorityBucket(16, 15)).toBeNull();
    expect(priorityBucket(-1, 15)).toBeNull();
  });

  it('takes the window from the policy', () => {
    expect(priorityBucket(9, 7)).toBeNull();
    expect(priorityBucket(7, 7)).toBe('6-10');
    expect(priorityBucket(20, 20)).toBe('11-15');
    expect(priorityBucket(3, Number.NaN)).toBeNull();
  });

  it('rounds days left up: 4 days and an hour is 5', () => {
    const now = new Date('2026-11-20T06:00:00.000Z');
    expect(daysLeftOn(new Date(now.getTime() + 4 * DAY_MS + 3600_000), now)).toBe(5);
    expect(daysLeftOn(new Date(now.getTime() + 5 * DAY_MS), now)).toBe(5);
  });
});

describe('refundPriorityOf', () => {
  const now = new Date('2026-11-20T06:00:00.000Z');
  const paidAt = new Date(now.getTime() - 18 * DAY_MS); // 12 days left of 30
  const base = { status: 'active', paymentReceivedAt: paidAt, hits: [], payments: [], interviews: [] };

  it('marks a paid job seeker 12 days from a refund with no offer as a priority', () => {
    expect(refundPriorityOf(base, now, 30, 15)).toEqual({ priority: true, daysLeft: 12 });
  });

  it('drops him once an offer is made after he paid, or the refund ended or was paid', () => {
    expect(refundPriorityOf({ ...base, interviews: [{ status: 'offered', offerSentAt: now }] }, now, 30, 15).priority).toBe(false);
    expect(
      refundPriorityOf({ ...base, interviews: [{ status: 'cancelled', offerSentAt: now }] }, now, 30, 15).priority,
    ).toBe(true);
    expect(
      refundPriorityOf({ ...base, hits: [{ reason: 'offer_declined', reversedAt: null }] }, now, 30, 15).priority,
    ).toBe(false);
    expect(
      refundPriorityOf({ ...base, payments: [{ type: 'refund', status: 'pending', createdAt: now }] }, now, 30, 15).priority,
    ).toBe(false);
    expect(refundPriorityOf({ ...base, status: 'placed' }, now, 30, 15).priority).toBe(false);
  });

  it('drops a refunded job seeker: his refund is already approved (guide check 12 Nov)', () => {
    expect(refundPriorityOf({ ...base, status: 'refunded' }, now, 30, 15)).toEqual({ priority: false, daysLeft: null });
    expect(SEEKER_ENDED_STATUSES).toContain('refunded');
  });

  it('is not a priority outside the window or before paying', () => {
    expect(refundPriorityOf(base, now, 30, 10).priority).toBe(false);
    expect(refundPriorityOf({ ...base, paymentReceivedAt: null }, now, 30, 15)).toEqual({ priority: false, daysLeft: null });
  });
});

describe('matching order', () => {
  it('puts a priority candidate first among equal matches, fewest days left first', () => {
    const rows = [
      { jobSeekerId: 'a', score: 80, priority: false },
      { jobSeekerId: 'b', score: 80, priority: true, daysLeft: 9 },
      { jobSeekerId: 'c', score: 80, priority: true, daysLeft: 3 },
    ];
    expect([...rows].sort(compareMatches).map((r) => r.jobSeekerId)).toEqual(['c', 'b', 'a']);
  });

  it('never pushes a priority candidate past a better match', () => {
    const rows = [
      { jobSeekerId: 'p', score: 70, priority: true, daysLeft: 1 },
      { jobSeekerId: 'q', score: 71, priority: false },
    ];
    expect([...rows].sort(compareMatches).map((r) => r.jobSeekerId)).toEqual(['q', 'p']);
  });
});

describe('one shared list of refund statuses that still count', () => {
  it('includes approved and failed (retried, never made again) and is the same list everywhere', () => {
    expect(LIVE_REFUND_STATUSES).toEqual(expect.arrayContaining(['pending', 'approved', 'processing', 'succeeded', 'completed', 'failed']));
    expect(LIVE_REFUND_STATUSES).not.toContain('rejected');
    expect(GROWTH_LIVE_REFUND_STATUSES).toBe(LIVE_REFUND_STATUSES);
  });
});
