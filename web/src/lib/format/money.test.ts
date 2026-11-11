import { describe, expect, it } from 'vitest';
import { formatINR, formatINRCompact, groupIndian, paiseToRupeesInput, parseRupeesToPaise, sumPaise } from './money';

describe('money helpers (integer paise only)', () => {
  it('groups digits the Indian way', () => {
    expect(groupIndian('499')).toBe('499');
    expect(groupIndian('1000')).toBe('1,000');
    expect(groupIndian('412600')).toBe('4,12,600');
    expect(groupIndian('46774500')).toBe('4,67,74,500');
  });

  it('formats paise as ₹ with Indian grouping, paise only when present', () => {
    expect(formatINR(49900)).toBe('₹499');
    expect(formatINR(41260000)).toBe('₹4,12,600');
    expect(formatINR(49950)).toBe('₹499.50');
    expect(formatINR(5)).toBe('₹0.05');
    expect(formatINR(0)).toBe('₹0');
    expect(formatINR(49900, { alwaysShowPaise: true })).toBe('₹499.00');
    expect(formatINR(-1193500)).toBe('− ₹11,935');
    expect(formatINR(20000, { signed: true })).toBe('+ ₹200');
  });

  it('refuses non-integer amounts instead of rounding money', () => {
    expect(() => formatINR(499.5)).toThrow(TypeError);
    expect(() => formatINR(Number.NaN)).toThrow(TypeError);
    expect(() => sumPaise([100, 0.1])).toThrow(TypeError);
  });

  it('shortens to lakh and crore without rounding up', () => {
    expect(formatINRCompact(6013300)).toBe('₹60,133');
    expect(formatINRCompact(53700000)).toBe('₹5.37L');
    expect(formatINRCompact(53799900)).toBe('₹5.37L');
    expect(formatINRCompact(10000000)).toBe('₹1L');
    expect(formatINRCompact(1200000000)).toBe('₹1.2Cr');
  });

  it('parses typed rupees into paise without floats', () => {
    expect(parseRupeesToPaise('4,12,600')).toBe(41260000);
    expect(parseRupeesToPaise('499.5')).toBe(49950);
    expect(parseRupeesToPaise('499.05')).toBe(49905);
    expect(parseRupeesToPaise('₹ 15,000')).toBe(1500000);
    expect(parseRupeesToPaise('0.1')).toBe(10);
    expect(parseRupeesToPaise('')).toBeNull();
    expect(parseRupeesToPaise('12.345')).toBeNull();
    expect(parseRupeesToPaise('-5')).toBeNull();
    expect(parseRupeesToPaise('abc')).toBeNull();
  });

  it('round-trips paise to the editable text', () => {
    expect(paiseToRupeesInput(41260050)).toBe('4,12,600.50');
    expect(paiseToRupeesInput(1500000)).toBe('15,000');
    expect(parseRupeesToPaise(paiseToRupeesInput(1234567))).toBe(1234567);
  });

  it('sums paise', () => {
    expect(sumPaise([49900, 49900, 200])).toBe(100000);
    expect(sumPaise([])).toBe(0);
  });
});
