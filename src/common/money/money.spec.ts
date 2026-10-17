import {
  toPaise,
  toRupees,
  formatINR,
  calculateGst,
  calculatePlacementFee,
  calculateRefund,
  refundGuaranteeDeadline,
  isWithinRefundGuarantee,
} from './money';

describe('Money Module', () => {
  describe('toPaise and toRupees', () => {
    it('converts integer rupees to paise', () => {
      expect(toPaise(0)).toBe(0);
      expect(toPaise(1)).toBe(100);
      expect(toPaise(499)).toBe(49900);
      expect(toPaise(15000)).toBe(1500000);
    });

    it('converts integer paise to rupees', () => {
      expect(toRupees(0)).toBe(0);
      expect(toRupees(100)).toBe(1);
      expect(toRupees(49900)).toBe(499);
      expect(toRupees(49949)).toBe(499);
      expect(toRupees(49950)).toBe(500);
    });
  });

  describe('formatINR', () => {
    it('formats whole rupees correctly', () => {
      const formatted = formatINR(49900);
      expect(formatted).toContain('499');
      expect(formatted).toContain('₹');
    });

    it('formats fractional paise amounts correctly', () => {
      const formatted = formatINR(49950);
      expect(formatted).toContain('499.5');
      expect(formatted).toContain('₹');
    });

    it('formats large amounts with Indian grouping format', () => {
      const formatted = formatINR(15000000); // ₹1,50,000
      expect(formatted).toContain('1,50,000');
    });
  });

  describe('calculateGst', () => {
    it('calculates exact 18% GST on even amounts', () => {
      expect(calculateGst(10000)).toBe(1800); // ₹100 -> ₹18
      expect(calculateGst(49900)).toBe(8982); // ₹499 -> ₹89.82
    });

    it('asserts GST on an amount that does not divide evenly (verifies rounding)', () => {
      // 105 * 0.18 = 18.9 -> 19
      expect(calculateGst(105)).toBe(19);

      // 101 * 0.18 = 18.18 -> 18
      expect(calculateGst(101)).toBe(18);

      // 103 * 0.18 = 18.54 -> 19
      expect(calculateGst(103)).toBe(19);

      // 1 * 0.18 = 0.18 -> 0
      expect(calculateGst(1)).toBe(0);

      // 3 * 0.18 = 0.54 -> 1
      expect(calculateGst(3)).toBe(1);
    });
  });

  describe('calculatePlacementFee', () => {
    it('calculates 50% of first month salary in paise', () => {
      expect(calculatePlacementFee(2000000)).toBe(1000000); // ₹20,000 -> ₹10,000
      expect(calculatePlacementFee(2500000)).toBe(1250000); // ₹25,000 -> ₹12,500
      expect(calculatePlacementFee(101)).toBe(51); // 101 / 2 = 50.5 -> rounds to 51
    });
  });

  describe('calculateRefund ladder (§6)', () => {
    const fee = 100000; // ₹1,000 = 100,000 paise

    it('asserts the refund ladder at days 0, 15, 16, 30, 31, 45, 46, 61', () => {
      // 0–15 days: 100%
      expect(calculateRefund(fee, 0)).toBe(100000);
      expect(calculateRefund(fee, 15)).toBe(100000);

      // 16–30 days: 50%
      expect(calculateRefund(fee, 16)).toBe(50000);
      expect(calculateRefund(fee, 30)).toBe(50000);

      // 31–45 days: 25%
      expect(calculateRefund(fee, 31)).toBe(25000);
      expect(calculateRefund(fee, 45)).toBe(25000);

      // 46–60 days and beyond: 0%
      expect(calculateRefund(fee, 46)).toBe(0);
      expect(calculateRefund(fee, 60)).toBe(0);
      expect(calculateRefund(fee, 61)).toBe(0);
    });

    it('rejects negative days elapsed', () => {
      expect(() => calculateRefund(fee, -1)).toThrow(RangeError);
    });
  });

  describe('Type safety & integer enforcement', () => {
    it('asserts no function returns or accepts a non-integer', () => {
      // Non-integers as input must throw TypeError
      expect(() => toPaise(10.5)).toThrow(TypeError);
      expect(() => toRupees(100.5)).toThrow(TypeError);
      expect(() => formatINR(100.5)).toThrow(TypeError);
      expect(() => calculateGst(100.25)).toThrow(TypeError);
      expect(() => calculatePlacementFee(50000.5)).toThrow(TypeError);
      expect(() => calculateRefund(10000.5, 10)).toThrow(TypeError);
      expect(() => calculateRefund(10000, 10.5)).toThrow(TypeError);

      // Negative values where invalid must throw RangeError
      expect(() => toPaise(-1)).toThrow(RangeError);
      expect(() => toRupees(-1)).toThrow(RangeError);
      expect(() => formatINR(-1)).toThrow(RangeError);
      expect(() => calculateGst(-1)).toThrow(RangeError);
      expect(() => calculatePlacementFee(-1)).toThrow(RangeError);
      expect(() => calculateRefund(-100, 10)).toThrow(RangeError);

      // Verify all returned values are strictly integers
      expect(Number.isInteger(toPaise(123))).toBe(true);
      expect(Number.isInteger(toRupees(12345))).toBe(true);
      expect(Number.isInteger(calculateGst(105))).toBe(true);
      expect(Number.isInteger(calculatePlacementFee(101))).toBe(true);
      expect(Number.isInteger(calculateRefund(100000, 15))).toBe(true);
      expect(Number.isInteger(calculateRefund(100000, 20))).toBe(true);
      expect(Number.isInteger(calculateRefund(100000, 35))).toBe(true);
      expect(Number.isInteger(calculateRefund(100000, 50))).toBe(true);
    });
  });

  describe('30-day Refund Guarantee Clock (Phase 2 Task 6)', () => {
    const baseDate = new Date('2026-05-01T12:00:00.000Z');

    it('computes refundGuaranteeDeadline as paymentReceivedAt + 30 days', () => {
      const deadline = refundGuaranteeDeadline(baseDate);
      expect(deadline).toBeInstanceOf(Date);
      const expectedTime = baseDate.getTime() + 30 * 24 * 60 * 60 * 1000;
      expect(deadline.getTime()).toBe(expectedTime);
      expect(deadline.toISOString()).toBe('2026-05-31T12:00:00.000Z');
    });

    it('asserts boundaries at day 29, day 30, and day 31 using injectable time', () => {
      // Day 29: within guarantee
      const day29 = new Date(baseDate.getTime() + 29 * 24 * 60 * 60 * 1000);
      expect(isWithinRefundGuarantee(baseDate, day29)).toBe(true);

      // Day 30 (exact deadline): within guarantee
      const day30 = new Date(baseDate.getTime() + 30 * 24 * 60 * 60 * 1000);
      expect(isWithinRefundGuarantee(baseDate, day30)).toBe(true);

      // Day 30 + 1 second: past guarantee
      const day30Plus1Sec = new Date(baseDate.getTime() + 30 * 24 * 60 * 60 * 1000 + 1000);
      expect(isWithinRefundGuarantee(baseDate, day30Plus1Sec)).toBe(false);

      // Day 31: past guarantee
      const day31 = new Date(baseDate.getTime() + 31 * 24 * 60 * 60 * 1000);
      expect(isWithinRefundGuarantee(baseDate, day31)).toBe(false);
    });

    it('rejects non-Date parameters with TypeError', () => {
      expect(() => refundGuaranteeDeadline('not-a-date' as unknown as Date)).toThrow(TypeError);
      expect(() => isWithinRefundGuarantee('invalid' as unknown as Date, baseDate)).toThrow(TypeError);
      expect(() => isWithinRefundGuarantee(baseDate, 'invalid' as unknown as Date)).toThrow(TypeError);
    });
  });
});
