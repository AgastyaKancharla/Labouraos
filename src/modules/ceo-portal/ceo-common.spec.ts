import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import {
  changePercent,
  daysLeft,
  daysSince,
  istDayKey,
  istStartOfMonth,
  monthBuckets,
  parsePage,
  parseRange,
  percent,
  previousRange,
  refundBucket,
  sumPaise,
  weekBuckets,
  countBy,
  median,
} from './ceo-common';
import { gstDueDates, summariseReceived } from './ceo-money.service';
import { placementStage } from './ceo-placements.service';
import { CeoJobSeekersService, NearRefundRow } from './ceo-job-seekers.service';
import { CeoPortalController } from './ceo-portal.controller';
import { ROLES_METADATA_KEY } from '../../common/rbac/roles.decorator';

describe('CEO portal helpers', () => {
  const now = new Date('2026-11-11T06:30:00.000Z'); // 12:00 IST

  it('works in IST calendar days', () => {
    expect(istDayKey(new Date('2026-10-31T19:00:00.000Z'))).toBe('2026-11-01');
    expect(istStartOfMonth(now).toISOString()).toBe('2026-10-31T18:30:00.000Z');
  });

  it('defaults the period to this month so far and refuses a backwards range', () => {
    const range = parseRange(undefined, undefined, now);
    expect(range.from.toISOString()).toBe('2026-10-31T18:30:00.000Z');
    expect(range.to).toBe(now);
    expect(() => parseRange('2026-11-10T00:00:00Z', '2026-11-01T00:00:00Z', now)).toThrow(BadRequestException);
    expect(() => parseRange('nonsense', undefined, now)).toThrow(BadRequestException);
  });

  it('pages from 1 and caps a download at 5,000 rows', () => {
    expect(parsePage(undefined, undefined)).toEqual({ page: 1, pageSize: 25, skip: 0 });
    expect(parsePage('3', '10')).toEqual({ page: 3, pageSize: 10, skip: 20 });
    expect(parsePage('0', '999999').pageSize).toBe(5000);
  });

  it('counts guarantee days left and puts them in the 0–5, 6–10, 11–15 groups', () => {
    const paid = new Date(now.getTime() - 28 * 24 * 3600 * 1000);
    expect(daysLeft(paid, 30, now)).toBe(2);
    expect(daysSince(paid, now)).toBe(28);
    expect(refundBucket(0, 15)).toBe('0-5');
    expect(refundBucket(5, 15)).toBe('0-5');
    expect(refundBucket(6, 15)).toBe('6-10');
    expect(refundBucket(11, 15)).toBe('11-15');
    expect(refundBucket(15, 15)).toBe('11-15');
    expect(refundBucket(16, 15)).toBeNull();
    expect(refundBucket(-1, 15)).toBeNull();
  });

  it('compares with the period just before, without dividing by zero', () => {
    const range = { from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-11-10T23:59:59Z') };
    const before = previousRange(range);
    expect(before.to.getTime()).toBe(range.from.getTime() - 1);
    expect(before.to.getTime() - before.from.getTime()).toBe(range.to.getTime() - range.from.getTime());
    expect(changePercent(118, 100)).toBe(18);
    expect(changePercent(5, 0)).toBeNull();
    expect(percent(1, 3)).toBe(33);
    expect(percent(1, 0)).toBe(0);
  });

  it('builds six 7-day weeks and five calendar months ending on the period end', () => {
    const weeks = weekBuckets(now, 6);
    expect(weeks).toHaveLength(6);
    expect(weeks[5].start).toBe('2026-11-05');
    expect(weeks[0].start).toBe('2026-10-01');
    const months = monthBuckets(now, 5);
    expect(months.map((m) => m.month)).toEqual(['2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
    expect(monthBuckets(new Date('2026-01-15T00:00:00Z'), 2).map((m) => m.month)).toEqual(['2025-12', '2026-01']);
  });

  it('adds money only as integer paise', () => {
    expect(sumPaise([49900, 49900])).toBe(99800);
    expect(() => sumPaise([499.5])).toThrow(TypeError);
    expect(countBy(['a', 'b', 'a', null], (x) => x)).toEqual([
      { name: 'a', count: 2 },
      { name: 'b', count: 1 },
    ]);
    expect(median([3, 1, 2])).toBe(2);
  });

  it('counts placement fees without GST and ₹499s with none, minus refunds paid', () => {
    const totals = summariseReceived(
      [
        { type: 'activation', amount: 49900, placement: null },
        { type: 'activation', amount: 49900, placement: null },
        { type: 'placement_fee', amount: 1003000, placement: { placementFee: 850000, gstAmount: 153000 } },
      ],
      [{ amount: 49900 }],
    );
    expect(totals).toMatchObject({
      activationPaise: 99800,
      activationCount: 2,
      placementFeePaise: 850000,
      placementCount: 1,
      gstPaise: 153000,
      grossPaise: 949800,
      refundsPaidPaise: 49900,
      netPaise: 899900,
      receivedInclGstPaise: 1102800,
    });
  });

  it('dates GSTR-1 on the 11th and GSTR-3B on the 20th of the next month', () => {
    expect(gstDueDates(new Date('2026-10-20T10:00:00Z'))).toEqual({ gstr1: '2026-11-11', gstr3b: '2026-11-20' });
    expect(gstDueDates(new Date('2026-12-31T10:00:00Z'))).toEqual({ gstr1: '2027-01-11', gstr3b: '2027-01-20' });
  });

  it('names each placement stage', () => {
    const base = { paidAt: new Date(), joinedDate: new Date(), guaranteeEndedReason: null };
    expect(placementStage({ ...base, status: 'active' })).toBe('working');
    expect(placementStage({ ...base, status: 'confirmed', joinedDate: null })).toBe('paid_not_joined');
    expect(placementStage({ ...base, status: 'dropped_out' })).toBe('replacement');
    expect(placementStage({ ...base, status: 'completed' })).toBe('cleared');
    expect(placementStage({ ...base, status: 'dropped_out', guaranteeEndedReason: 'refunded' })).toBe('refunded');
    expect(placementStage({ ...base, status: 'awaiting_payment', paidAt: null, joinedDate: null })).toBe('awaiting_payment');
  });

  it('totals the close-to-a-refund rows per side and per group', () => {
    const row = (kind: NearRefundRow['kind'], bucket: NearRefundRow['bucket'], atStakePaise: number) =>
      ({ kind, bucket, atStakePaise }) as NearRefundRow;
    const summary = CeoJobSeekersService.summariseNearRefund([
      row('job_seeker', '0-5', 49900),
      row('job_seeker', '11-15', 49900),
      row('business', '6-10', 800000),
    ]);
    expect(summary.jobSeekers).toMatchObject({ count: 2, atStakePaise: 99800, buckets: { '0-5': 1, '6-10': 0, '11-15': 1 } });
    expect(summary.businesses).toMatchObject({ count: 1, atStakePaise: 800000, buckets: { '6-10': 1 } });
  });
});

describe('CEO portal routes are for the CEO only', () => {
  it('guards the controller and every route with the CEO role and nothing else', () => {
    expect(Reflect.getMetadata(ROLES_METADATA_KEY, CeoPortalController)).toEqual(['ceo']);
    const proto = CeoPortalController.prototype as unknown as Record<string, unknown>;
    const handlers = Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor');
    expect(handlers.length).toBeGreaterThan(20);
    for (const name of handlers) {
      expect(Reflect.getMetadata(ROLES_METADATA_KEY, proto[name] as object)).toEqual(['ceo']);
    }
  });
});
