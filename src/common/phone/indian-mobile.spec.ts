import { BadRequestException } from '@nestjs/common';
import {
  INDIAN_MOBILE_MESSAGE,
  isIndianMobile,
  mobileLookupValues,
  nationalMobileDigits,
  normaliseIndianMobile,
  optionalIndianMobile,
  parseIndianMobile,
  phoneLast4,
  vendorMobileNumber,
  phoneSearchDigits,
  phoneSearchTerm,
  requireIndianMobile,
  sameIndianMobile,
} from './indian-mobile';

describe('Indian mobile numbers: one stored format (+91 and 10 digits)', () => {
  describe('accepts every common spelling of one number', () => {
    it.each([
      '9876543210',
      '+919876543210',
      '919876543210',
      '09876543210',
      '+91 98765 43210',
      '+91-98765-43210',
      '98765-43210',
      '98765 43210',
      ' 9876543210 ',
      '+91 9876 543 210',
      '0 98765 43210',
      '91 98765 43210',
      '+91 98765 43210',
    ])('%j -> +919876543210', (input) => {
      expect(parseIndianMobile(input)).toBe('+919876543210');
      expect(requireIndianMobile(input)).toBe('+919876543210');
      expect(isIndianMobile(input)).toBe(true);
    });

    it.each(['6000000000', '7012345678', '8123456789', '9999999999'])('accepts a number starting 6-9: %s', (input) => {
      expect(parseIndianMobile(input)).toBe(`+91${input}`);
    });

    it('reads a 10-digit number that itself starts with 91 as the number, not a country code', () => {
      expect(parseIndianMobile('9198765432')).toBe('+919198765432');
      expect(parseIndianMobile('+919198765432')).toBe('+919198765432');
    });
  });

  describe('refuses anything else with a clear 400', () => {
    it.each([
      '',
      '   ',
      '987654321', // 9 digits
      '98765432101', // 11 digits
      '+9198765432101',
      '1234567890', // starts 1
      '5876543210', // starts 5
      '+910001234567', // anonymised placeholder
      '+1 415 555 0101', // foreign
      '0091 98765 43210', // international prefix is not one of the accepted spellings
      '9876x43210',
      '(+91) 98765 43210',
      '98765.43210',
      '+92 98765 43210',
      '++919876543210',
    ])('%j is refused', (input) => {
      expect(parseIndianMobile(input)).toBeNull();
      expect(() => requireIndianMobile(input)).toThrow(BadRequestException);
    });

    it.each([null, undefined, 9876543210.5, {}, [], true])('refuses a non-string value %p', (input) => {
      expect(parseIndianMobile(input)).toBeNull();
      expect(() => requireIndianMobile(input)).toThrow(BadRequestException);
    });

    it('says "Enter a 10-digit mobile number" and names the field', () => {
      try {
        requireIndianMobile('12345', 'whatsappPhone');
        throw new Error('expected a refusal');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        const response = (error as BadRequestException).getResponse() as Record<string, unknown>;
        expect((error as BadRequestException).getStatus()).toBe(400);
        expect(response.message).toBe(INDIAN_MOBILE_MESSAGE);
        expect(response.message).toBe('Enter a 10-digit mobile number');
        expect(response.field).toBe('whatsappPhone');
      }
    });

    it('accepts a number given as a JSON number', () => {
      expect(parseIndianMobile(9876543210)).toBe('+919876543210');
    });
  });

  describe('optional number fields', () => {
    it('keeps "not sent" as undefined and clears blank or null to null', () => {
      expect(optionalIndianMobile(undefined, 'whatsappPhone')).toBeUndefined();
      expect(optionalIndianMobile(null, 'whatsappPhone')).toBeNull();
      expect(optionalIndianMobile('  ', 'whatsappPhone')).toBeNull();
    });

    it('normalises a given number and refuses a bad one', () => {
      expect(optionalIndianMobile('98765 43210', 'whatsappPhone')).toBe('+919876543210');
      expect(() => optionalIndianMobile('12345', 'whatsappPhone')).toThrow(INDIAN_MOBILE_MESSAGE);
    });
  });

  describe('numbers that did not come from a form', () => {
    it('normalises what parses and leaves anything else untouched', () => {
      expect(normaliseIndianMobile('919876543210')).toBe('+919876543210');
      expect(normaliseIndianMobile(' 18001234567 ')).toBe('18001234567');
      expect(normaliseIndianMobile('+910001234567')).toBe('+910001234567');
      expect(normaliseIndianMobile(null)).toBeNull();
      expect(normaliseIndianMobile(undefined)).toBeNull();
    });

    it('gives the 10 national digits the SMS vendor and the OTP hash use', () => {
      expect(nationalMobileDigits('+91 98765 43210')).toBe('9876543210');
      expect(nationalMobileDigits('09876543210')).toBe('9876543210');
      expect(nationalMobileDigits('18001234567')).toBe('18001234567');
    });

    it('gives the SMS/OTP vendor the country code with no plus (MSG91: 919876543210)', () => {
      for (const spelling of ['+919876543210', '9876543210', '+91 98765 43210', '09876543210', '919876543210']) {
        expect(vendorMobileNumber(spelling)).toBe('919876543210');
      }
      expect(() => vendorMobileNumber('12345')).toThrow(BadRequestException);
    });

    it('treats two spellings of one number as the same number', () => {
      expect(sameIndianMobile('9876543210', '+91 98765 43210')).toBe(true);
      expect(sameIndianMobile('09876543210', '919876543210')).toBe(true);
      expect(sameIndianMobile('9876543210', '9876543211')).toBe(false);
      expect(sameIndianMobile('9876543210', null)).toBe(false);
      expect(sameIndianMobile('18001234567', '18001234567')).toBe(true);
    });
  });

  describe('lookups, search and masking', () => {
    it('looks up the canonical form first, plus the older spellings of the same number', () => {
      expect(mobileLookupValues('+91 98765 43210')).toEqual([
        '+919876543210', '9876543210', '919876543210', '09876543210',
      ]);
      expect(mobileLookupValues('9876543210')).toEqual(mobileLookupValues('09876543210'));
      expect(mobileLookupValues('18001234567')).toEqual(['18001234567']);
      expect(mobileLookupValues('')).toEqual([]);
    });

    it('masks to the same last 4 digits whatever the spelling', () => {
      expect(phoneLast4('+919876543210')).toBe('3210');
      expect(phoneLast4('98765 43210')).toBe('3210');
      expect(phoneLast4(null)).toBe('');
    });

    it('reads a full number in any spelling as an exact search and 4-9 digits as "ends with"', () => {
      expect(phoneSearchTerm('98765 43210')).toEqual({ kind: 'exact', values: mobileLookupValues('+919876543210') });
      expect(phoneSearchTerm('+919876543210')).toEqual({ kind: 'exact', values: mobileLookupValues('+919876543210') });
      expect(phoneSearchTerm('3210')).toEqual({ kind: 'suffix', digits: '3210' });
      expect(phoneSearchTerm('543 210')).toEqual({ kind: 'suffix', digits: '543210' });
      expect(phoneSearchTerm('321')).toBeNull();
      expect(phoneSearchTerm('Sri Sai')).toBeNull();
      expect(phoneSearchTerm('JS-00042')).toBeNull();
      expect(phoneSearchTerm('')).toBeNull();
    });

    it('gives a "phone contains" search the 10 national digits for a full number in any spelling', () => {
      expect(phoneSearchDigits('09876543210')).toBe('9876543210');
      expect(phoneSearchDigits('+91 98765 43210')).toBe('9876543210');
      expect(phoneSearchDigits('919876543210')).toBe('9876543210');
      expect(phoneSearchDigits('3210')).toBe('3210');
      expect(phoneSearchDigits('JS-00042')).toBe('00042');
    });
  });
});
