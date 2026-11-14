import { ageOn, isEmail, isGstin, isMobile, isPincode, monthlyPaise } from './validate';

describe('form checks', () => {
  it('accepts only 10-digit Indian mobiles starting 6–9', () => {
    expect(isMobile('9876543210')).toBe(true);
    expect(isMobile('5876543210')).toBe(false);
    expect(isMobile('987654321')).toBe(false);
  });

  it('works out age to the day (18th birthday counts)', () => {
    expect(ageOn('2008-11-14', '2026-11-14')).toBe(18);
    expect(ageOn('2008-11-15', '2026-11-14')).toBe(17);
  });

  it('checks pincode, email and GSTIN shapes', () => {
    expect(isPincode('560076')).toBe(true);
    expect(isPincode('060076')).toBe(false);
    expect(isEmail('owner@example.com')).toBe(true);
    expect(isEmail('owner@')).toBe(false);
    expect(isGstin('29ABCDE1234F1Z5')).toBe(true);
    expect(isGstin('29ABCDE1234F1X5')).toBe(false);
  });

  it('turns a daily wage into a monthly one over 26 days', () => {
    expect(monthlyPaise(100_000, 'daily')).toBe(2_600_000);
    expect(monthlyPaise(100_000, 'monthly')).toBe(100_000);
  });
});
