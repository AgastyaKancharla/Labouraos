import { BadRequestException } from '@nestjs/common';
import { CreateJobSeekerDto } from './dto/create-job-seeker.dto';
import { assertNoRawAadhaar, validateJobSeekerRegistration } from './job-seeker.validator';

const validRegistration: CreateJobSeekerDto = {
  name: 'Asha Rao',
  phone: '9876543210',
  otpRequestId: 'otp-1',
  messageLanguage: 'kn',
  bestTimeToCall: '09-12',
  dateOfBirth: '1990-01-02',
  gender: 'female',
  heardFrom: 'walk_in',
  locality: 'Indiranagar',
  pincode: '560038',
  latitude: 12.9784,
  longitude: 77.6408,
  travelDistanceKm: 10,
  trades: [{ trade: 'Housekeeping', yearsExperience: 2 }],
  availableFrom: '2026-11-10',
  lookingSince: '2026-11-01',
  minSalary: 1600000,
  maxSalary: 2300000,
  salaryPeriod: 'monthly',
  shiftPreference: 'day',
  jobType: 'full_time',
  spokenLanguages: ['Kannada'],
};

describe('validateJobSeekerRegistration', () => {
  const now = new Date('2026-11-09T00:00:00.000Z');

  it('normalizes the fixed call window and accepts a complete adult profile', () => {
    expect(validateJobSeekerRegistration(validRegistration, 18, now)).toMatchObject({
      name: 'Asha Rao',
      phone: '+919876543210',
      preferredCallWindowStart: '09:00',
      preferredCallWindowEnd: '12:00',
      trades: [{ trade: 'Housekeeping', yearsExperience: 2 }],
      spokenLanguages: ['Kannada'],
    });
  });

  it.each([
    ['identity and contact', { phone: '' }],
    ['communication and call window', { messageLanguage: 'ta' }],
    ['location and travel', { latitude: 91 }],
    ['availability and salary', { salaryPeriod: 'weekly' }],
    ['trade list', { trades: [] }],
    ['spoken languages', { spokenLanguages: [] }],
  ])('rejects an invalid %s field group', (_group, fields) => {
    expect(() => validateJobSeekerRegistration(
      { ...validRegistration, ...fields } as CreateJobSeekerDto,
      18,
      now,
    )).toThrow(BadRequestException);
  });

  it('rejects a job seeker younger than the policy adult age', () => {
    expect(() => validateJobSeekerRegistration(
      { ...validRegistration, dateOfBirth: '2010-01-02' },
      18,
      now,
    )).toThrow('at least 18 years old');
  });

  it('rejects a fourth trade', () => {
    expect(() => validateJobSeekerRegistration(
      {
        ...validRegistration,
        trades: [
          { trade: 'Housekeeping', yearsExperience: 1 },
          { trade: 'Cook', yearsExperience: 2 },
          { trade: 'Waiter', yearsExperience: 3 },
          { trade: 'Driver', yearsExperience: 4 },
        ],
      },
      18,
      now,
    )).toThrow('One to three trades are required');
  });

  it.each(['9876543210', '+91 98765 43210', '919876543210', '09876543210', '98765-43210'])(
    'saves the mobile typed as %j as +919876543210',
    (phone) => {
      expect(validateJobSeekerRegistration({ ...validRegistration, phone }, 18, now).phone).toBe('+919876543210');
    },
  );

  it.each(['987654321', '98765432101', '1234567890', '+1 415 555 0101'])('refuses %j with "Enter a 10-digit mobile number"', (phone) => {
    expect(() => validateJobSeekerRegistration({ ...validRegistration, phone }, 18, now)).toThrow('Enter a 10-digit mobile number');
  });
});

describe('assertNoRawAadhaar and 12-digit mobile numbers', () => {
  it('lets 91 and a 10-digit mobile through in a phone field only', () => {
    expect(() => assertNoRawAadhaar({ phone: '919876543210' })).not.toThrow();
    expect(() => assertNoRawAadhaar({ whatsappPhone: '919876543210', mobileNumber: '919876543211' })).not.toThrow();
    expect(() => assertNoRawAadhaar({ branches: [{ contactPersonPhone: '919876543212' }] })).not.toThrow();
  });

  it('still refuses 12 digits that are not an Indian mobile, and 12 digits in any other field', () => {
    expect(() => assertNoRawAadhaar({ phone: '123456789012' })).toThrow('Raw Aadhaar');
    expect(() => assertNoRawAadhaar({ phone: '915876543210' })).toThrow('Raw Aadhaar');
    expect(() => assertNoRawAadhaar({ documentId: '919876543210' })).toThrow('Raw Aadhaar');
    expect(() => assertNoRawAadhaar({ notes: '9198 7654 3210' })).toThrow('Raw Aadhaar');
  });
});
