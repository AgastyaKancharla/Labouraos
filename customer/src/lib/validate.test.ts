import { ageOn, isEmail, isGstin, isMobile, isPincode, monthlyPaise, startsWithSymbol } from './validate';
import { emptyBusiness, validateBusiness } from '@/screens/RegisterBusiness/form';
import { emptyJobSeeker, validateJobSeeker } from '@/screens/RegisterJobSeeker/form';
import { emptyReferral, validateReferral } from '@/screens/RegisterReferral/form';
import { ApiError } from '@/api/errors';
import { errorText } from '@/api/errorText';

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

describe('names may not start like a spreadsheet formula (INF-6)', () => {
  it('flags a leading "=", also after spaces, zero-width characters or written full-width', () => {
    for (const bad of ['=HYPERLINK("x")', '  =1', '\u200b=1', '\ufeff=1', '\uff1d1+1']) expect(startsWithSymbol(bad)).toBe(true);
    for (const ok of ['Ravi Kumar', 'Sri Lakshmi Hotel', 'Ravi-Kumar', 'A+ Tailors', '-', '@Home Tiffins', '+91 Stores']) expect(startsWithSymbol(ok)).toBe(false);
  });

  it('the registration forms refuse such a name, with their own message', () => {
    const business = validateBusiness({ ...emptyBusiness(), contactName: 'Ravi', boardName: '=HYPERLINK("x")', legalName: '' });
    expect(business.boardName).toBe('form.noLeadingSymbol');
    expect(business.contactName).toBeUndefined();
    expect(validateJobSeeker({ ...emptyJobSeeker('en'), fullName: '\uff1dcmd' }).fullName).toBe('form.noLeadingSymbol');
    expect(validateReferral({ ...emptyReferral('en'), name: ' =Ravi' }).name).toBe('form.noLeadingSymbol');
  });

  it('the server refusal shows in the person\'s language', () => {
    const err = new ApiError({ status: 400, messages: ["Name can't start with =, +, - or @."], body: { code: 'TEXT_STARTS_WITH_SYMBOL' } });
    expect(errorText((key) => key, err)).toBe('error.textStartsWithSymbol');
  });
});
