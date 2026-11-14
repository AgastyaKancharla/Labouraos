import { PrismaService } from '../../common/prisma/prisma.service';
import { ConsentClock } from '../consent/consent-clock';
import { PricingService } from '../pricing/pricing.service';
import { CandidateIntroductionService } from './candidate-introduction.service';
import { MatchingService } from './matching.service';

const now = new Date('2026-11-06T12:00:00.000Z');
const day = 24 * 60 * 60 * 1000;
const businessId = 'business-phase14-proof';
const vacancyId = 'vacancy-phase14-proof';
const businessPoint = { latitude: 12.9716, longitude: 77.5946 };

function seeker(id: string, daysSincePayment: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    status: 'active',
    city: 'Bengaluru',
    name: `${id} Candidate`,
    minSalary: 1500000,
    maxSalary: 1800000,
    salaryPeriod: 'monthly',
    paymentReceivedAt: new Date(now.getTime() - daysSincePayment * day),
    dateOfBirth: new Date('1990-01-01T00:00:00.000Z'),
    gender: null,
    latitude: businessPoint.latitude,
    longitude: businessPoint.longitude,
    travelDistanceKm: 20,
    availableFrom: null,
    shiftPreference: 'day',
    drivingLicenceType: null,
    certificates: [],
    preferredLocalities: [],
    willingToRelocate: null,
    needsAccommodation: null,
    whatsappPhone: null,
    locality: null,
    pincode: null,
    lookingSince: null,
    jobType: null,
    currentlyWorking: null,
    lastEmployer: null,
    lastRole: null,
    lastSalaryPaise: null,
    educationLevel: null,
    ownVehicle: null,
    policeVerified: null,
    hasSmartphone: null,
    cvStoragePath: null,
    keySkills: [],
    qualification: null,
    currentSalaryPaise: null,
    photoStoragePath: null,
    photoTakenAt: null,
    trades: [{ trade: 'Electrician', yearsExperience: 4, isPrimary: true }],
    languages: [{ language: 'Kannada', speaks: true }],
    hits: [],
    placements: [],
    interviews: [],
    replacementCandidateOffers: [],
    payments: [{ type: 'activation', status: 'succeeded' }],
    ...overrides,
  };
}

describe('Phase 14 gate end-to-end proof', () => {
  it('ranks suitable candidates, and records the owner share (the /map/points page was retired on 14 Nov)', async () => {
    process.env.PUBLIC_APP_URL = 'https://app.laboura.in';
    const candidates = [
      seeker('day-26', 26),
      seeker('day-4', 4),
      seeker('too-far', 12, { latitude: 13.2, longitude: 77.5946, travelDistanceKm: 2 }),
      seeker('paused-consent', 12),
      seeker('night-shift', 12, { shiftPreference: 'night' }),
    ];
    const consents = candidates.flatMap((candidate) => candidate.id === 'paused-consent' ? [] : [
      { subjectId: candidate.id, purpose: 'job_matching', granted: true, grantedAt: now, withdrawnAt: null },
      { subjectId: candidate.id, purpose: 'profile_sharing', granted: true, grantedAt: now, withdrawnAt: null },
    ]);
    const vacancy = {
      id: vacancyId,
      code: 'VC-P14-PROOF',
      city: 'Bengaluru',
      businessId,
      tradeSkill: 'Electrician',
      roleTitle: 'Electrician',
      interviewType: 'walk_in',
      salaryMinPaise: 1500000,
      salaryMaxPaise: 1800000,
      salaryPeriod: 'monthly',
      ...businessPoint,
      experienceRequiredYears: 4,
      languagesRequired: ['Kannada'],
      licencesRequired: [],
      startDate: null,
      ageMin: null,
      ageMax: null,
      genderRequirement: null,
      shift: 'day',
      status: 'open',
      business: { verificationStatus: 'verified' },
    };
    const business = {
      id: businessId,
      code: 'BZ-P14-PROOF',
      name: 'Verified Walk-in Electrical Shop',
      ...businessPoint,
      verificationStatus: 'verified',
      accountAgentId: 'agent-1',
    };
    const introductionRows: unknown[] = [];
    const prismaState = {
      vacancy: {
      findFirst: jest.fn().mockResolvedValue(vacancy),
      findMany: jest.fn().mockResolvedValue([vacancy]),
      },
      trade: { findFirst: jest.fn().mockResolvedValue({ id: 'trade-electrician' }) },
      business: {
      findFirst: jest.fn().mockResolvedValue({ id: businessId, code: business.code }),
      findMany: jest.fn().mockResolvedValue([business]),
      },
      staff: { findMany: jest.fn().mockResolvedValue([{ id: 'agent-1', name: 'Field Agent One' }]) },
      jobSeeker: {
      findMany: jest.fn().mockImplementation(async (query: { where?: { id?: { in?: string[] } } }) => {
        const ids = query.where?.id?.in;
        return ids ? candidates.filter((candidate) => ids.includes(candidate.id)) : candidates;
      }),
      },
      consent: {
      findMany: jest.fn().mockImplementation(async (query: { where?: { purpose?: string | { in?: string[] } } }) => {
        if (query.where?.purpose === 'job_matching') return consents.filter((row) => row.purpose === 'job_matching');
        return consents;
      }),
      },
      candidateIntroduction: {
        createMany: jest.fn().mockImplementation(async ({ data }: { data: unknown[] }) => {
          introductionRows.push(...data);
          return { count: data.length };
        }),
      },
      candidateIntroductionLink: {
        create: jest.fn().mockResolvedValue({ id: 'link-1' }),
        delete: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    prismaState.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(prismaState));
    const prisma = prismaState as unknown as PrismaService;
    const clock = { now: () => now } as ConsentClock;
    const pricing = {
      current: jest.fn().mockResolvedValue({
        matchPageSize: 3,
        salaryDaysPerMonth: 26,
        matchingWeights: { clock: 30, distance: 20, experience: 15, salary: 15, reliability: 10, completeness: 5, pastResults: 5 },
        jobSeekerGuaranteeDays: 30,
        maxHits: 3,
        adultMinimumAge: 18,
      }),
    } as unknown as PricingService;
    const matching = new MatchingService(prisma, pricing, clock);
    const messaging = { send: jest.fn().mockResolvedValue({ id: 'message-proof-1', status: 'sent' }) };
    const introductions = new CandidateIntroductionService(prisma, matching, messaging as never, clock);

    const shortlist = await matching.match(vacancyId, { page: 1 });
    expect(shortlist.matches.map((match) => match.jobSeekerId)).toEqual(['day-26', 'day-4']);
    expect(shortlist.leftOut).toEqual({ no_location: 0, no_travel_distance: 0, consent_missing: 1 });
    expect(shortlist.total).toBe(2);

    await introductions.shareByLink(vacancyId, shortlist.matches.map((match) => match.jobSeekerId), 'agent-1', 'whatsapp');
    expect(messaging.send).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'whatsapp', template: 'candidates_shared', subjectId: businessId,
    }));
    expect(introductionRows).toHaveLength(2);
    expect(introductionRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ jobSeekerId: 'day-26', messageLogId: 'message-proof-1', channel: 'share_link' }),
      expect.objectContaining({ jobSeekerId: 'day-4', messageLogId: 'message-proof-1', channel: 'share_link' }),
    ]));

    console.log('PHASE 14 GATE PROOF:', JSON.stringify({
      verifiedBusiness: business.code,
      vacancy: { code: vacancy.code, interviewType: vacancy.interviewType, trade: vacancy.tradeSkill, salaryMinPaise: vacancy.salaryMinPaise, salaryMaxPaise: vacancy.salaryMaxPaise, salaryRangeRupees: '15000–18000/month' },
      rankedCandidates: shortlist.matches.map((match) => ({ id: match.jobSeekerId, reasons: match.matchReasons })),
      excludedCandidates: ['too-far', 'paused-consent', 'night-shift'],
      leftOut: shortlist.leftOut,
      loggedIntroductions: introductionRows,
    }));
  });
});
