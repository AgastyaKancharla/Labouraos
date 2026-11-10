import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ConsentClock } from '../consent/consent-clock';
import { PricingService } from '../pricing/pricing.service';
import { MatchingService } from './matching.service';

const now = new Date('2026-11-05T12:00:00.000Z');

describe('MatchingService', () => {
  let candidates: Array<Record<string, unknown>>;
  let consentRows: Array<Record<string, unknown>>;
  let policy: Record<string, unknown>;
  let businessVerified: boolean;

  const baseCandidate = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    status: 'active',
    city: 'Bengaluru',
    name: `Candidate ${id}`,
    minSalary: 1500000,
    maxSalary: 2000000,
    salaryPeriod: 'monthly',
    paymentReceivedAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
    dateOfBirth: new Date('1990-01-01T00:00:00.000Z'),
    gender: 'female',
    latitude: 12.9716,
    longitude: 77.5946,
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
    trades: [{ trade: 'Electrician', yearsExperience: 4, isPrimary: true }],
    languages: [{ language: 'Kannada', speaks: true }],
    hits: [],
    placements: [],
    replacementCandidateOffers: [],
    interviews: [],
    payments: [{ type: 'activation', status: 'succeeded' }],
    ...overrides,
  });

  const baseVacancy = (overrides: Record<string, unknown> = {}) => ({
    id: 'vacancy-id',
    code: 'VC-00001',
    city: 'Bengaluru',
    businessId: 'business-id',
    tradeSkill: 'Electrician',
    salaryMinPaise: 1500000,
    salaryMaxPaise: 2000000,
    salaryPeriod: 'monthly',
    latitude: 12.9716,
    longitude: 77.5946,
    experienceRequiredYears: 4,
    languagesRequired: ['Kannada'],
    licencesRequired: [],
    startDate: null,
    ageMin: null,
    ageMax: null,
    genderRequirement: null,
    shift: 'day',
    business: { verificationStatus: businessVerified ? 'verified' : 'pending_tl_check' },
    ...overrides,
  });

  const run = async (list = candidates, vacancyOverrides: Record<string, unknown> = {}) => {
    const prisma = {
      vacancy: { findFirst: jest.fn().mockResolvedValue(baseVacancy(vacancyOverrides)) },
      trade: { findFirst: jest.fn().mockResolvedValue({ id: 'trade-electrician' }) },
      jobSeeker: { findMany: jest.fn().mockResolvedValue(list) },
      consent: { findMany: jest.fn().mockResolvedValue(consentRows) },
    } as unknown as PrismaService;
    const pricing = { current: jest.fn().mockResolvedValue(policy) } as unknown as PricingService;
    const clock = { now: () => now } as ConsentClock;
    return new MatchingService(prisma, pricing, clock).match('vacancy-id', { page: 1 });
  };

  beforeEach(() => {
    candidates = [baseCandidate('candidate-1')];
    consentRows = [
      { subjectId: 'candidate-1', purpose: 'job_matching', granted: true, grantedAt: now, withdrawnAt: null },
      { subjectId: 'candidate-1', purpose: 'profile_sharing', granted: true, grantedAt: now, withdrawnAt: null },
    ];
    businessVerified = true;
    policy = {
      matchPageSize: 3,
      salaryDaysPerMonth: 26,
      matchingWeights: { clock: 30, distance: 20, experience: 15, salary: 15, reliability: 10, completeness: 5, pastResults: 5 },
      jobSeekerGuaranteeDays: 30,
      maxHits: 3,
      adultMinimumAge: 18,
    };
  });

  it('enforces active status, current job_matching and profile_sharing consent, and no live offer', async () => {
    candidates = [
      baseCandidate('paused', { status: 'paused' }),
      baseCandidate('offer', { placements: [{ status: 'offered', businessId: 'other', replacementCandidates: [] }] }),
      baseCandidate('interview-offer', { interviews: [{ status: 'offered' }] }),
      baseCandidate('replacement-offer', { replacementCandidateOffers: [{ status: 'offered', placement: { businessId: 'other' } }] }),
      baseCandidate('eligible'),
    ];
    consentRows = ['offer', 'interview-offer', 'replacement-offer', 'eligible'].flatMap((subjectId) => [
      { subjectId, purpose: 'job_matching', granted: true, grantedAt: now, withdrawnAt: null },
      { subjectId, purpose: 'profile_sharing', granted: true, grantedAt: now, withdrawnAt: null },
    ]);
    const result = await run();
    expect(result.matches.map(({ jobSeekerId }) => jobSeekerId)).toEqual(['eligible']);
  });

  it('requires both active matching and profile sharing consent', async () => {
    consentRows = [{ subjectId: 'candidate-1', purpose: 'job_matching', granted: true, grantedAt: now, withdrawnAt: null }];
    let result = await run();
    expect(result.matches).toHaveLength(0);
    expect(result.leftOut.consent_missing).toBe(1);
    consentRows = [{ subjectId: 'candidate-1', purpose: 'profile_sharing', granted: true, grantedAt: now, withdrawnAt: null }];
    result = await run();
    expect(result.matches).toHaveLength(0);
  });

  it('matches any current or legacy trade case-insensitively', async () => {
    candidates = [baseCandidate('wrong-trade', { trades: [{ trade: 'Painter', yearsExperience: 2, isPrimary: true }], tradeSkill: null })];
    const result = await run();
    expect(result.matches).toHaveLength(0);
  });

  it('does not match a vacancy whose trade is not in the active managed list', async () => {
    const prisma = {
      vacancy: { findFirst: jest.fn().mockResolvedValue(baseVacancy({ tradeSkill: 'Barista' })) },
      trade: { findFirst: jest.fn().mockResolvedValue(null) },
      jobSeeker: { findMany: jest.fn() },
      consent: { findMany: jest.fn() },
    } as unknown as PrismaService;
    const pricing = { current: jest.fn().mockResolvedValue(policy) } as unknown as PricingService;
    const result = await new MatchingService(prisma, pricing, { now: () => now } as ConsentClock)
      .match('vacancy-id', { page: 1 });
    expect(result.matches).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it('omits an unlisted-only job seeker until the typed trade is mapped to an active trade', async () => {
    candidates = [baseCandidate('other-only', {
      trades: [{ trade: 'Unlisted helper', yearsExperience: 2, isPrimary: true }],
    })];
    consentRows = [
      { subjectId: 'other-only', purpose: 'job_matching', granted: true, grantedAt: now, withdrawnAt: null },
      { subjectId: 'other-only', purpose: 'profile_sharing', granted: true, grantedAt: now, withdrawnAt: null },
    ];
    expect((await run()).matches).toHaveLength(0);

    candidates = [baseCandidate('other-only', {
      trades: [{ trade: 'Electrician', yearsExperience: 2, isPrimary: true }],
    })];
    expect((await run()).matches.map(({ jobSeekerId }) => jobSeekerId)).toEqual(['other-only']);
  });

  it('requires overlapping salary ranges after daily to monthly conversion', async () => {
    candidates = [baseCandidate('above', { minSalary: 2100000 }), baseCandidate('below', { maxSalary: 1400000 })];
    const result = await run();
    expect(result.matches).toHaveLength(0);
  });

  it('excludes seekers beyond their travel distance', async () => {
    candidates = [baseCandidate('far', { latitude: 13.1, travelDistanceKm: 1 })];
    const result = await run();
    expect(result.matches).toHaveLength(0);
  });

  it('requires all spoken languages and all listed licences or certificates', async () => {
    candidates = [baseCandidate('missing-language', { languages: [] })];
    expect((await run(candidates, { languagesRequired: ['Kannada'] })).matches).toHaveLength(0);
    candidates = [baseCandidate('missing-licence')];
    expect((await run(candidates, { licencesRequired: ['Forklift'] })).matches).toHaveLength(0);
  });

  it('uses the guarantee floor for suitable offers and labels offers within 10% below it as near-misses', async () => {
    const candidate = baseCandidate('salary-floor', {
      minSalary: 2500000,
      maxSalary: 3000000,
      guaranteeFloorPaise: 2000000,
    });
    candidates = [candidate];
    consentRows = ['job_matching', 'profile_sharing'].map((purpose) => ({
      subjectId: 'salary-floor', purpose, granted: true, grantedAt: now, withdrawnAt: null,
    }));

    const atFloor = await run(candidates, { salaryMinPaise: 2000000, salaryMaxPaise: 2000000 });
    expect(atFloor.matches.map(({ jobSeekerId }) => jobSeekerId)).toEqual(['salary-floor']);
    expect(atFloor.nearMisses).toHaveLength(0);

    const ninePercentBelow = await run(candidates, { salaryMinPaise: 1820000, salaryMaxPaise: 1820000 });
    expect(ninePercentBelow.matches).toHaveLength(0);
    expect(ninePercentBelow.nearMisses).toMatchObject([
      { jobSeekerId: 'salary-floor', salaryWarning: 'below_minimum_ask_him' },
    ]);

    const belowNearMissWindow = await run(candidates, { salaryMinPaise: 1799999, salaryMaxPaise: 1799999 });
    expect(belowNearMissWindow.nearMisses).toHaveLength(0);
  });

  it('requires availability on or before the vacancy start date', async () => {
    candidates = [baseCandidate('late', { availableFrom: new Date('2026-12-01T00:00:00.000Z') })];
    const result = await run(candidates, { startDate: new Date('2026-11-20T00:00:00.000Z') });
    expect(result.matches).toHaveLength(0);
  });

  it('requires an adult with a date of birth inside the vacancy age limits', async () => {
    candidates = [baseCandidate('underage', { dateOfBirth: new Date('2010-01-01T00:00:00.000Z') })];
    expect((await run()).matches).toHaveLength(0);
    candidates = [baseCandidate('too-old')];
    expect((await run(candidates, { ageMax: 30 })).matches).toHaveLength(0);
  });

  it('reads the adult age threshold from PricingPolicy', async () => {
    candidates = [baseCandidate('young-adult', { dateOfBirth: new Date('2006-01-01T00:00:00.000Z') })];
    policy.adultMinimumAge = 21;
    const result = await run();
    expect(result.matches).toHaveLength(0);
  });

  it('matches a specified gender requirement', async () => {
    candidates = [baseCandidate('gender-mismatch', { gender: 'male' })];
    const result = await run(candidates, { genderRequirement: 'female' });
    expect(result.matches).toHaveLength(0);
  });

  it('requires a matching shift unless the seeker is available for any shift', async () => {
    candidates = [baseCandidate('night', { shiftPreference: 'night' })];
    const result = await run(candidates, { shift: 'day' });
    expect(result.matches).toHaveLength(0);
  });

  it('excludes a business that rejected the seeker through a placement, replacement or interview result', async () => {
    candidates = [
      baseCandidate('placement-rejected', { placements: [{ status: 'rejected', businessId: 'business-id', replacementCandidates: [] }] }),
      baseCandidate('replacement-rejected', { placements: [{ status: 'active', businessId: 'business-id', replacementCandidates: [{ status: 'rejected' }] }] }),
      baseCandidate('interview-not-selected', { interviews: [{ status: 'completed', businessId: 'business-id', result: 'not_selected' }] }),
      baseCandidate('no-result-again-matches', { interviews: [{ status: 'no_result', businessId: 'business-id', result: null }] }),
    ];
    consentRows = candidates.flatMap(({ id }) => [
      { subjectId: id, purpose: 'job_matching', granted: true, grantedAt: now, withdrawnAt: null },
      { subjectId: id, purpose: 'profile_sharing', granted: true, grantedAt: now, withdrawnAt: null },
    ]);
    const result = await run();
    expect(result.matches.map(({ jobSeekerId }) => jobSeekerId)).toEqual(['no-result-again-matches']);
  });

  it('does not show seekers to an unverified business', async () => {
    businessVerified = false;
    await expect(run()).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('converts daily salary using the configured 26 days and counts missing locations', async () => {
    candidates = [
      baseCandidate('daily', { minSalary: 60000, maxSalary: 70000, salaryPeriod: 'daily' }),
      baseCandidate('no-home-location', { latitude: null, longitude: null }),
      baseCandidate('no-radius', { travelDistanceKm: null }),
    ];
    consentRows = candidates.flatMap(({ id }) => [
      { subjectId: id, purpose: 'job_matching', granted: true, grantedAt: now, withdrawnAt: null },
      { subjectId: id, purpose: 'profile_sharing', granted: true, grantedAt: now, withdrawnAt: null },
    ]);
    const result = await run();
    expect(result.matches.map(({ jobSeekerId }) => jobSeekerId)).toEqual(['daily']);
    expect(result.leftOut).toEqual({ no_location: 1, no_travel_distance: 1, consent_missing: 0 });
  });

  it('ranks day 27 above day 5 for otherwise identical seekers', async () => {
    candidates = [
      baseCandidate('day-5', { paymentReceivedAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000) }),
      baseCandidate('day-27', { paymentReceivedAt: new Date(now.getTime() - 27 * 24 * 60 * 60 * 1000) }),
    ];
    consentRows = candidates.flatMap(({ id }) => [
      { subjectId: id, purpose: 'job_matching', granted: true, grantedAt: now, withdrawnAt: null },
      { subjectId: id, purpose: 'profile_sharing', granted: true, grantedAt: now, withdrawnAt: null },
    ]);
    const result = await run();
    expect(result.matches[0].jobSeekerId).toBe('day-27');
  });

  it('reads weights from PricingPolicy and their changes alter ranking', async () => {
    candidates = [
      baseCandidate('clock-priority', { paymentReceivedAt: new Date(now.getTime() - 27 * 24 * 60 * 60 * 1000), latitude: 12.98 }),
      baseCandidate('distance-priority', { paymentReceivedAt: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000), latitude: 12.9717 }),
    ];
    consentRows = candidates.flatMap(({ id }) => [
      { subjectId: id, purpose: 'job_matching', granted: true, grantedAt: now, withdrawnAt: null },
      { subjectId: id, purpose: 'profile_sharing', granted: true, grantedAt: now, withdrawnAt: null },
    ]);
    const defaultOrder = (await run()).matches.map(({ jobSeekerId }) => jobSeekerId);
    policy.matchingWeights = { clock: 0, distance: 100, experience: 0, salary: 0, reliability: 0, completeness: 0, pastResults: 0 };
    const distanceOrder = (await run()).matches.map(({ jobSeekerId }) => jobSeekerId);
    expect(defaultOrder[0]).toBe('clock-priority');
    expect(distanceOrder[0]).toBe('distance-priority');
  });

  it('returns three ranked matches per page without repeats', async () => {
    candidates = Array.from({ length: 6 }, (_, index) => baseCandidate(`candidate-${index}`));
    consentRows = candidates.flatMap(({ id }) => [
      { subjectId: id, purpose: 'job_matching', granted: true, grantedAt: now, withdrawnAt: null },
      { subjectId: id, purpose: 'profile_sharing', granted: true, grantedAt: now, withdrawnAt: null },
    ]);
    const prisma = {
      vacancy: { findFirst: jest.fn().mockResolvedValue(baseVacancy()) },
      trade: { findFirst: jest.fn().mockResolvedValue({ id: 'trade-electrician' }) },
      jobSeeker: { findMany: jest.fn().mockResolvedValue(candidates) },
      consent: { findMany: jest.fn().mockResolvedValue(consentRows) },
    } as unknown as PrismaService;
    const pricing = { current: jest.fn().mockResolvedValue(policy) } as unknown as PricingService;
    const service = new MatchingService(prisma, pricing, { now: () => now } as ConsentClock);
    const first = await service.match('vacancy-id', { page: 1 });
    const second = await service.match('vacancy-id', { page: 2 });
    const firstIds = first.matches.map(({ jobSeekerId }) => jobSeekerId);
    const secondIds = second.matches.map(({ jobSeekerId }) => jobSeekerId);
    expect(firstIds).toHaveLength(3);
    expect(secondIds).toHaveLength(3);
    expect(firstIds.filter((id) => secondIds.includes(id))).toHaveLength(0);
  });
});
