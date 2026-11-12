import { bypassChargeAmounts } from './bypass-charge.money';

describe('no-bypass charge amounts (fee + 50% + GST, integer paise)', () => {
  it("matches the guide's example: salary ₹15,000 → ₹7,500 + ₹3,750 = ₹11,250 + GST", () => {
    expect(bypassChargeAmounts(1_500_000, 50, 50, 18)).toEqual({ feePaise: 750_000, penaltyPaise: 375_000, gstPaise: 202_500, totalPaise: 1_327_500 });
  });

  it('rounds to whole paise and never produces a fraction', () => {
    const a = bypassChargeAmounts(1_234_567, 50, 50, 18);
    for (const v of Object.values(a)) expect(Number.isInteger(v)).toBe(true);
    expect(a.totalPaise).toBe(a.feePaise + a.penaltyPaise + a.gstPaise);
  });

  it('uses the percents it is given (from PricingPolicy)', () => {
    expect(bypassChargeAmounts(2_000_000, 40, 25, 18)).toEqual({ feePaise: 800_000, penaltyPaise: 200_000, gstPaise: 180_000, totalPaise: 1_180_000 });
  });

  it('refuses money that is not whole paise', () => {
    expect(() => bypassChargeAmounts(1500.5, 50, 50, 18)).toThrow();
  });
});
