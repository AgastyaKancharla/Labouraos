import { describe, expect, it } from 'vitest';
import { customPeriod } from '../../../lib/period';
import { summariseMoney, summarisePayouts, type PaymentRow } from './money';

const NOV = customPeriod('2026-11-01', '2026-11-30');
let n = 0;
function p(over: Partial<PaymentRow>): PaymentRow {
  n += 1;
  return { id: `p${n}`, type: 'activation', status: 'succeeded', amount: 49900, createdAt: '2026-11-05T05:00:00Z', ...over };
}

describe('Command Center money maths (integer paise)', () => {
  it('counts received fees in the period, without GST, minus refunds paid', () => {
    const rows = [
      p({}),
      p({ confirmedAt: '2026-11-02T04:00:00Z' }),
      p({ type: 'placement_fee', amount: 1003000, placement: { placementFee: 850000, gstAmount: 153000 } }),
      p({ type: 'refund', amount: 49900, paidAt: '2026-11-07T10:00:00Z' }),
      // not counted: pending, failed, outside the period (IST boundary), payouts
      p({ status: 'pending' }),
      p({ status: 'failed' }),
      p({ confirmedAt: '2026-10-31T18:29:00Z' }), // 23:59 IST on 31 Oct
      p({ type: 'referral_payout', amount: 20000 }),
    ];
    const s = summariseMoney(rows, NOV);
    expect(s.activationPaise).toBe(99800);
    expect(s.activationCount).toBe(2);
    expect(s.placementFeePaise).toBe(850000);
    expect(s.gstPaise).toBe(153000);
    expect(s.grossPaise).toBe(949800);
    expect(s.refundsPaidPaise).toBe(49900);
    expect(s.netPaise).toBe(899900);
  });

  it('counts a payment confirmed at 00:10 IST on the 1st in the new month', () => {
    const s = summariseMoney([p({ createdAt: '2026-10-30T10:00:00Z', confirmedAt: '2026-10-31T18:40:00Z' })], NOV);
    expect(s.activationCount).toBe(1);
  });

  it('is zero for no payments', () => {
    expect(summariseMoney([], NOV)).toMatchObject({ grossPaise: 0, netPaise: 0, gstPaise: 0 });
  });

  it('sums payouts waiting to be released and counts failures', () => {
    const s = summarisePayouts([
      p({ type: 'referral_payout', status: 'pending', amount: 20000 }),
      p({ type: 'joining_reward', status: 'approved', amount: 20000 }),
      p({ type: 'referral_payout', status: 'failed', amount: 20000 }),
      p({ type: 'referral_payout', status: 'succeeded', amount: 20000 }),
      p({ type: 'refund', status: 'pending', amount: 49900 }),
    ]);
    expect(s).toEqual({ duePaise: 40000, dueCount: 2, failedCount: 1 });
  });
});
