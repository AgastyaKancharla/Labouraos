import { currentGuaranteeRefundWhere, isCurrentGuaranteeRefund } from './current-guarantee-refund';

describe('A refund belongs to the current guarantee by link, not by time', () => {
  const paidAgainAt = new Date('2026-11-12T05:00:00.000Z');
  const cycle = { latestPaidActivationId: 'pay-new', paymentReceivedAt: paidAgainAt };

  it('counts a refund of his latest ₹499, whatever its time', () => {
    expect(isCurrentGuaranteeRefund({ refundsPaymentId: 'pay-new', createdAt: new Date('2026-11-01T00:00:00Z') }, cycle)).toBe(true);
  });

  it('never counts a refund of an earlier ₹499, even one made after the new payment time (same-day re-pay)', () => {
    expect(isCurrentGuaranteeRefund({ refundsPaymentId: 'pay-old', createdAt: new Date('2026-11-12T06:00:00Z') }, cycle)).toBe(false);
  });

  it('falls back to the dates only for a refund made before the link existed', () => {
    expect(isCurrentGuaranteeRefund({ refundsPaymentId: null, createdAt: new Date('2026-11-12T06:00:00Z') }, cycle)).toBe(true);
    expect(isCurrentGuaranteeRefund({ refundsPaymentId: null, createdAt: new Date('2026-11-12T04:00:00Z') }, cycle)).toBe(false);
  });

  it('builds the same rule as a database filter', () => {
    expect(currentGuaranteeRefundWhere('js-1', cycle)).toEqual({
      jobSeekerId: 'js-1',
      type: 'refund',
      status: { in: ['pending', 'approved', 'processing', 'completed', 'succeeded', 'failed'] },
      OR: [{ refundsPaymentId: 'pay-new' }, { refundsPaymentId: null, createdAt: { gte: paidAgainAt } }],
    });
  });
});
