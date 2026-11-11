import { BadRequestException, ConflictException } from '@nestjs/common';
import { JobSeekerService } from './job-seeker.service';
import { ReferralService } from '../referral/referral.service';
import { CreateJobSeekerDto } from './dto/create-job-seeker.dto';

/**
 * Guide (Forms): "a number already registered shows 'Already registered —
 * open it' instead of creating a second record". The 409 must name the
 * existing record so the screen can open it.
 */
const NOW = new Date('2026-11-11T05:30:00.000Z');

const registration: CreateJobSeekerDto = {
  name: 'Kavya Reddy',
  phone: '9845012345',
  otpRequestId: 'otp-1',
  messageLanguage: 'kn',
  bestTimeToCall: '15-18',
  dateOfBirth: '1998-03-14',
  gender: 'female',
  heardFrom: 'toll_free_missed_call',
  locality: 'BTM Layout 2nd Stage',
  pincode: '560076',
  latitude: 12.9166,
  longitude: 77.6101,
  travelDistanceKm: 8,
  trades: [{ trade: 'Housekeeping', yearsExperience: 3 }],
  availableFrom: '2026-11-12',
  lookingSince: '2026-10-01',
  minSalary: 1300000,
  maxSalary: 1600000,
  salaryPeriod: 'monthly',
  shiftPreference: 'day',
  jobType: 'full_time',
  spokenLanguages: ['Kannada'],
};

function jobSeekerService(prisma: Record<string, unknown>, extra: { publicLinks?: unknown; messaging?: unknown; audit?: unknown } = {}) {
  const otp = { isVerified: jest.fn().mockResolvedValue(true), consumeVerified: jest.fn() };
  const pricing = { current: jest.fn().mockResolvedValue({ adultMinimumAge: 18, salaryDaysPerMonth: 26 }) };
  const audit = extra.audit ?? { log: jest.fn() };
  const service = new JobSeekerService(
    prisma as never, {} as never, audit as never, otp as never, {} as never, pricing as never, {} as never, {} as never,
    {} as never, {} as never, undefined, undefined, { now: () => NOW } as never, undefined, undefined,
    extra.publicLinks as never, extra.messaging as never,
  );
  return { service, otp };
}

describe('Duplicate registrations name the existing record', () => {
  it('answers a second job seeker with the same number with existingJobSeekerCode', async () => {
    const { service, otp } = jobSeekerService({
      jobSeeker: { findUnique: jest.fn().mockResolvedValue({ id: 's1', code: 'JS-01042', phone: '9845012345' }) },
    });
    const error = await service.create(registration, 'staff-1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      statusCode: 409,
      existingJobSeekerCode: 'JS-01042',
      message: expect.stringContaining('Already registered — open it'),
    });
    expect(otp.consumeVerified).not.toHaveBeenCalled();
  });

  it('answers a second referral partner with the same number with existingReferralCode', async () => {
    const prisma = { referral: { findUnique: jest.fn().mockResolvedValue({ id: 'r1', code: 'RF-00042' }) } };
    const otp = { isVerified: jest.fn().mockResolvedValue(true), consumeVerified: jest.fn() };
    const service = new ReferralService(prisma as never, {} as never, { log: jest.fn() } as never, otp as never, {} as never);
    const error = await service
      .create({
        name: 'Raju Kumar', phone: '9945670011', type: 'individual', individualRole: 'auto_driver', whatsappPhone: '9945670011',
        language: 'kn', locality: 'Madiwala', pincode: '560068', heardFrom: 'walk_in', otpRequestId: 'otp-2',
      }, 'staff-1')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({ existingReferralCode: 'RF-00042' });
    expect(otp.consumeVerified).not.toHaveBeenCalled();
  });
});

describe('Payment link to another number records who it is (CA08e)', () => {
  const previousUrl = process.env.PUBLIC_APP_URL;
  beforeAll(() => {
    process.env.PUBLIC_APP_URL = previousUrl || 'https://app.laboura.in';
  });
  afterAll(() => {
    if (previousUrl === undefined) delete process.env.PUBLIC_APP_URL;
    else process.env.PUBLIC_APP_URL = previousUrl;
  });
  const seeker = { id: 's1', code: 'JS-01042', name: 'Kavya Reddy', phone: '9845012345', messageLanguage: 'kn', city: 'Bengaluru' };
  const prisma = () => ({
    jobSeeker: { findUnique: jest.fn().mockResolvedValue(seeker) },
    payment: { findFirst: jest.fn().mockResolvedValue({ id: 'p1', expectedAmountPaise: 49900 }) },
  });

  it('stores the relation with the link and in the audit row', async () => {
    const publicLinks = { revokeActive: jest.fn(), create: jest.fn().mockResolvedValue({ token: 'tok' }) };
    const messaging = { send: jest.fn() };
    const audit = { log: jest.fn() };
    const { service } = jobSeekerService(prisma(), { publicLinks, messaging, audit });
    const result = await service.createPaymentOnlyLink('s1', '9886041207', 'staff-1', 'brother');
    expect(result.expiresAt).toEqual(new Date(NOW.getTime() + 15 * 60_000));
    expect(publicLinks.create).toHaveBeenCalledWith(expect.objectContaining({ metadata: { paymentId: 'p1', relation: 'brother' } }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ after: expect.objectContaining({ relation: 'brother' }) }));
  });

  it('still works without a relation', async () => {
    const publicLinks = { revokeActive: jest.fn(), create: jest.fn().mockResolvedValue({ token: 'tok' }) };
    const { service } = jobSeekerService(prisma(), { publicLinks, messaging: { send: jest.fn() } });
    await service.createPaymentOnlyLink('s1', '9886041207', 'staff-1');
    expect(publicLinks.create).toHaveBeenCalledWith(expect.objectContaining({ metadata: { paymentId: 'p1' } }));
  });

  it('refuses a relation outside the fixed list', async () => {
    const { service } = jobSeekerService(prisma(), { publicLinks: {}, messaging: {} });
    await expect(service.createPaymentOnlyLink('s1', '9886041207', 'staff-1', 'neighbour of uncle')).rejects.toBeInstanceOf(BadRequestException);
  });
});
