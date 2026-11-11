import { describe, expect, it } from 'vitest';
import { cleanMobileInput, formatMobile, isValidMobile, isValidPincode, maskMobile } from './phone';

describe('mobile numbers', () => {
  it('keeps exactly 10 digits and drops a pasted +91 or 0', () => {
    expect(cleanMobileInput('+91 98765 43210')).toBe('9876543210');
    expect(cleanMobileInput('09876543210')).toBe('9876543210');
    expect(cleanMobileInput('98765-4321099')).toBe('9876543210');
    expect(cleanMobileInput('abc')).toBe('');
  });

  it('validates Indian mobiles', () => {
    expect(isValidMobile('9876543210')).toBe(true);
    expect(isValidMobile('1234567890')).toBe(false);
    expect(isValidMobile('987654321')).toBe(false);
  });

  it('formats and masks', () => {
    expect(formatMobile('9876543210')).toBe('+91 98765 43210');
    expect(maskMobile('9876543210')).toBe('******3210');
    expect(maskMobile('******3210')).toBe('******3210');
  });

  it('validates pincodes', () => {
    expect(isValidPincode('560078')).toBe(true);
    expect(isValidPincode('056007')).toBe(false);
    expect(isValidPincode('5600')).toBe(false);
  });
});
