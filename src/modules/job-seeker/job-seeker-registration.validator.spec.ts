import { BadRequestException } from '@nestjs/common';
import { CreateJobSeekerDto } from './dto/create-job-seeker.dto';
import { validateJobSeekerRegistration } from './job-seeker.validator';

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
      phone: '9876543210',
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
});
