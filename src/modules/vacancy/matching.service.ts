import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { refundGuaranteeDeadline } from '../../common/money/money';
import { ConsentClock } from '../consent/consent-clock';
import { PricingService } from '../pricing/pricing.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { jobSeekerHasTrade } from '../job-seeker/job-seeker-legacy-read';
import {
  CANDIDATE_PHOTO_LINK_TTL_SECONDS,
  CANDIDATE_PHOTO_STORAGE,
  CandidatePhotoStorage,
} from '../job-seeker/photo-storage';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEIGHT_KEYS = ['clock', 'distance', 'experience', 'salary', 'reliability', 'completeness', 'pastResults'] as const;

const OPTIONAL_PROFILE_FIELDS = [
  'gender', 'whatsappPhone', 'photoStoragePath', 'photoTakenAt', 'locality', 'pincode', 'latitude', 'longitude',
  'travelDistanceKm', 'preferredLocalities', 'willingToRelocate', 'needsAccommodation',
  'salaryPeriod', 'availableFrom', 'lookingSince', 'shiftPreference', 'jobType',
  'currentlyWorking', 'lastEmployer', 'lastRole', 'lastSalaryPaise', 'educationLevel',
  'certificates', 'drivingLicenceType', 'ownVehicle', 'policeVerified', 'hasSmartphone',
  'cvStoragePath', 'keySkills', 'qualification', 'currentSalaryPaise',
] as const;

type FactorName = (typeof WEIGHT_KEYS)[number];
type MatchCandidate = {
  id: string;
  status: string;
  name: string;
  minSalary: number;
  maxSalary: number;
  salaryPeriod: string | null;
  paymentReceivedAt: Date | null;
  dateOfBirth: Date | null;
  gender: string | null;
  latitude: number | null;
  longitude: number | null;
  travelDistanceKm: number | null;
  availableFrom: Date | null;
  shiftPreference: string | null;
  drivingLicenceType: string | null;
  certificates: string[];
  preferredLocalities: string[];
  willingToRelocate: boolean | null;
  needsAccommodation: boolean | null;
  whatsappPhone: string | null;
  locality: string | null;
  pincode: string | null;
  lookingSince: Date | null;
  jobType: string | null;
  currentlyWorking: boolean | null;
  lastEmployer: string | null;
  lastRole: string | null;
  lastSalaryPaise: number | null;
  educationLevel: string | null;
  ownVehicle: boolean | null;
  policeVerified: boolean | null;
  hasSmartphone: boolean | null;
  cvStoragePath: string | null;
  keySkills: string[];
  qualification: string | null;
  currentSalaryPaise: number | null;
  photoStoragePath: string | null;
  photoTakenAt: Date | null;
  trades: Array<{ trade: string; yearsExperience: number; isPrimary: boolean }>;
  languages: Array<{ language: string; speaks: boolean }>;
  hits: Array<{ reason: string; reversedAt: Date | null }>;
  placements: Array<{ businessId: string; status: string; replacementCandidates: Array<{ status: string }> }>;
  replacementCandidateOffers: Array<{ status: string; placement: { businessId: string } }>;
  payments: Array<{ type: string; status: string }>;
  interviews: Array<{ status: string; businessId: string; result: string | null }>;
  consents: Array<{ purpose: string; granted: boolean; grantedAt: Date | null; withdrawnAt: Date | null }>;
};

type VacancyForMatching = {
  id: string;
  code: string;
  city: string;
  businessId: string;
  tradeSkill: string;
  salaryMinPaise: number | null;
  salaryMaxPaise: number | null;
  salaryPeriod: string | null;
  latitude: number | null;
  longitude: number | null;
  experienceRequiredYears: number | null;
  languagesRequired: string[];
  licencesRequired: string[];
  availableFrom: Date | null;
  startDate: Date | null;
  ageMin: number | null;
  ageMax: number | null;
  genderRequirement: string | null;
  shift: string | null;
  business: { verificationStatus: string | null };
};

type CandidateMatch = {
  jobSeekerId: string;
  score: number;
  matchReasons: string[];
  photoStoragePath: string | null;
  card: {
    firstName: string;
    photoUrl: string | null;
    photoUrlExpiresInSeconds: number | null;
    age: number;
    trade: string;
    yearsExperience: number;
    languages: string[];
    distanceKm: number;
    expectedSalary: { minPaise: number; maxPaise: number };
    matchReasons: string[];
  };
};

@Injectable()
export class MatchingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricingService: PricingService,
    private readonly clock: ConsentClock,
    @Optional() @Inject(CANDIDATE_PHOTO_STORAGE) private readonly photoStorage?: CandidatePhotoStorage,
  ) {}

  async match(vacancyId: string, options: { page: number }) {
    if (!Number.isInteger(options.page) || options.page < 1) {
      throw new BadRequestException('page must be a positive integer');
    }

    const vacancy = (await this.prisma.vacancy.findFirst({
      where: vacancyId.startsWith('VC-') ? { code: vacancyId } : { id: vacancyId },
      include: { business: true },
    })) as VacancyForMatching | null;
    if (!vacancy) throw new NotFoundException(`Vacancy '${vacancyId}' not found`);
    if (vacancy.business.verificationStatus !== 'verified') {
      throw new ForbiddenException('Candidates are hidden until the business is verified');
    }

    const listedTrade = await this.prisma.trade.findFirst({
      where: { active: true, nameKey: vacancy.tradeSkill.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-IN') },
      select: { id: true },
    });
    if (!listedTrade) {
      return {
        vacancyId: vacancy.id,
        page: options.page,
        pageSize: (await this.pricingService.current()).matchPageSize,
        total: 0,
        leftOut: { no_location: 0, no_travel_distance: 0, consent_missing: 0 },
        matches: [],
      };
    }

    const policy = await this.pricingService.current();
    const weights = this.readWeights(policy.matchingWeights);
    const now = this.clock.now();
    const seekers = (await this.prisma.jobSeeker.findMany({
      where: { status: 'active' },
      include: {
        trades: true,
        languages: true,
        hits: { select: { reason: true, reversedAt: true } },
        placements: { include: { replacementCandidates: { select: { status: true } } } },
        interviews: { select: { status: true, businessId: true, result: true } },
        replacementCandidateOffers: { include: { placement: { select: { businessId: true } } } },
        payments: { select: { type: true, status: true } },
      },
    })) as unknown as MatchCandidate[];
    const activeConsents = await this.prisma.consent.findMany({
      where: {
        subjectType: 'job_seeker',
        subjectId: { in: seekers.map((seeker) => seeker.id) },
        purpose: { in: ['job_matching', 'profile_sharing'] },
        granted: true,
        grantedAt: { not: null },
        withdrawnAt: null,
      },
      select: { subjectId: true, purpose: true, granted: true, grantedAt: true, withdrawnAt: true },
    });
    const consentsBySeeker = new Map<string, MatchCandidate['consents']>();
    for (const consent of activeConsents) {
      const rows = consentsBySeeker.get(consent.subjectId) ?? [];
      rows.push(consent);
      consentsBySeeker.set(consent.subjectId, rows);
    }

    const leftOut = { no_location: 0, no_travel_distance: 0, consent_missing: 0 };
    const matches: CandidateMatch[] = [];
    for (const rawSeeker of seekers) {
      const seeker: MatchCandidate = { ...rawSeeker, consents: consentsBySeeker.get(rawSeeker.id) ?? [] };
      if (seeker.status !== 'active') continue;
      const consentPurposes = new Set(
        seeker.consents
          .filter((row) => row.granted && row.grantedAt && !row.withdrawnAt)
          .map((row) => row.purpose),
      );
      const hasConsent = consentPurposes.has('job_matching') && consentPurposes.has('profile_sharing');
      if (!hasConsent) {
        leftOut.consent_missing += 1;
        continue;
      }
      if (!this.passesBeforeDistanceRules(seeker, vacancy, policy.salaryDaysPerMonth)) continue;
      if (seeker.latitude === null || seeker.longitude === null || vacancy.latitude === null || vacancy.longitude === null) {
        leftOut.no_location += 1;
        continue;
      }
      if (seeker.travelDistanceKm === null) {
        leftOut.no_travel_distance += 1;
        continue;
      }
      const distanceKm = distanceInKm(seeker.latitude, seeker.longitude, vacancy.latitude, vacancy.longitude);
      if (distanceKm > seeker.travelDistanceKm) continue;
      if (!this.passesAfterDistanceRules(seeker, vacancy, policy.adultMinimumAge, now)) continue;
      const match = this.score(
        seeker,
        vacancy,
        distanceKm,
        weights,
        policy.jobSeekerGuaranteeDays,
        policy.salaryDaysPerMonth,
        policy.maxHits,
        now,
      );
      matches.push(match);
    }

    matches.sort((a, b) => b.score - a.score || a.jobSeekerId.localeCompare(b.jobSeekerId));
    const pageSize = policy.matchPageSize;
    const offset = (options.page - 1) * pageSize;
    const pageMatches = await Promise.all(matches.slice(offset, offset + pageSize).map(async (match) => {
      const { photoStoragePath, ...publicMatch } = match;
      const photoUrl = photoStoragePath
        ? await this.requirePhotoStorage().signedUrl(photoStoragePath, CANDIDATE_PHOTO_LINK_TTL_SECONDS)
        : null;
      return {
        ...publicMatch,
        card: {
          ...match.card,
          photoUrl,
          photoUrlExpiresInSeconds: photoUrl ? CANDIDATE_PHOTO_LINK_TTL_SECONDS : null,
        },
      };
    }));

    return {
      vacancyId: vacancy.id,
      page: options.page,
      pageSize,
      total: matches.length,
      leftOut,
      matches: pageMatches,
    };
  }

  private passesBeforeDistanceRules(
    seeker: MatchCandidate,
    vacancy: VacancyForMatching,
    salaryDaysPerMonth: number,
  ): boolean {
    if (!jobSeekerHasTrade(seeker, vacancy.tradeSkill)) return false;
    if (vacancy.salaryMinPaise === null) return false;
    const vacancyMin = monthlyAmount(vacancy.salaryMinPaise, vacancy.salaryPeriod, salaryDaysPerMonth);
    const vacancyMax = monthlyAmount(vacancy.salaryMaxPaise ?? vacancy.salaryMinPaise, vacancy.salaryPeriod, salaryDaysPerMonth);
    const seekerMin = monthlyAmount(seeker.minSalary, seeker.salaryPeriod, salaryDaysPerMonth);
    const seekerMax = monthlyAmount(seeker.maxSalary, seeker.salaryPeriod, salaryDaysPerMonth);
    if (seekerMin > vacancyMax || seekerMax < vacancyMin) return false;

    if (this.hasLiveOffer(seeker.id, seeker)) return false;
    return true;
  }

  private passesAfterDistanceRules(
    seeker: MatchCandidate,
    vacancy: VacancyForMatching,
    adultMinimumAge: number,
    now: Date,
  ): boolean {
    if (this.businessRejected(vacancy.businessId, seeker.id, seeker)) return false;

    const providedLanguages = seeker.languages.filter((row) => row.speaks).map((row) => row.language.toLowerCase());
    if (vacancy.languagesRequired.some((language) => !providedLanguages.includes(language.toLowerCase()))) return false;
    const licences = [seeker.drivingLicenceType, ...seeker.certificates].filter((value): value is string => !!value)
      .map((value) => value.toLowerCase());
    if (vacancy.licencesRequired.some((licence) => !licences.includes(licence.toLowerCase()))) return false;

    if (seeker.availableFrom && vacancy.startDate && seeker.availableFrom.getTime() > vacancy.startDate.getTime()) return false;
    if (!seeker.dateOfBirth) return false;
    const age = ageOn(seeker.dateOfBirth, now);
    if (age < adultMinimumAge || (vacancy.ageMin !== null && age < vacancy.ageMin) || (vacancy.ageMax !== null && age > vacancy.ageMax)) return false;
    if (vacancy.genderRequirement && !['none', 'any'].includes(vacancy.genderRequirement.toLowerCase()) &&
      seeker.gender?.toLowerCase() !== vacancy.genderRequirement.toLowerCase()) return false;
    if (seeker.shiftPreference !== 'any' && (
      !seeker.shiftPreference || seeker.shiftPreference.toLowerCase() !== vacancy.shift?.toLowerCase()
    )) return false;
    if (vacancy.business.verificationStatus !== 'verified') return false;
    return true;
  }

  private score(
    seeker: MatchCandidate,
    vacancy: VacancyForMatching,
    distanceKm: number,
    weights: Record<FactorName, number>,
    guaranteeDays: number,
    salaryDaysPerMonth: number,
    maxHits: number,
    now: Date,
  ): CandidateMatch {
    const matchedTrade = seeker.trades.find((trade) => trade.trade.trim().toLowerCase() === vacancy.tradeSkill.trim().toLowerCase());
    const experience = matchedTrade?.yearsExperience ?? 0;
    const travelDistance = seeker.travelDistanceKm ?? 0;
    const deadline = seeker.paymentReceivedAt ? refundGuaranteeDeadline(seeker.paymentReceivedAt, guaranteeDays) : null;
    const daysLeft = deadline ? Math.ceil((deadline.getTime() - now.getTime()) / DAY_MS) : guaranteeDays;
    const clockScore = deadline && now > deadline && this.refundStillOwed(seeker) ? 1 : clip((guaranteeDays - daysLeft) / guaranteeDays);
    const experienceScore = vacancy.experienceRequiredYears
      ? clip(experience / vacancy.experienceRequiredYears)
      : 1;
    const vacancyMin = monthlyAmount(vacancy.salaryMinPaise ?? 0, vacancy.salaryPeriod, salaryDaysPerMonth);
    const vacancyMax = monthlyAmount(vacancy.salaryMaxPaise ?? vacancy.salaryMinPaise ?? 0, vacancy.salaryPeriod, salaryDaysPerMonth);
    const seekerMin = monthlyAmount(seeker.minSalary, seeker.salaryPeriod, salaryDaysPerMonth);
    const salaryScore = vacancyMax <= vacancyMin
      ? (seekerMin <= vacancyMin ? 1 : 0)
      : clip(1 - Math.max(0, seekerMin - vacancyMin) / (vacancyMax - vacancyMin));
    const reliabilityScore = clip(1 - seeker.hits.filter((hit) => !hit.reversedAt).length / maxHits);
    const completenessScore = completeness(seeker);
    const results = [...seeker.placements.flatMap((placement) => {
      if (placement.status === 'rejected') return [false];
      if (['confirmed', 'active', 'completed', 'replaced', 'dropped_out'].includes(placement.status)) return [true];
      return [];
    }), ...seeker.placements.flatMap((placement) => placement.replacementCandidates.map((candidate) => candidate.status === 'accepted' ? true : candidate.status === 'rejected' ? false : null).filter((v): v is boolean => v !== null))];
    const selected = results.filter(Boolean).length;
    const pastResultsScore = results.length ? selected / results.length : 0.5;
    const factors: Record<FactorName, number> = {
      clock: clockScore,
      distance: clip(1 - distanceKm / travelDistance),
      experience: experienceScore,
      salary: salaryScore,
      reliability: reliabilityScore,
      completeness: completenessScore,
      pastResults: pastResultsScore,
    };
    const score = (Object.keys(weights) as FactorName[]).reduce((total, key) => total + factors[key] * weights[key], 0);
    const tradeYears = matchedTrade?.yearsExperience ?? 0;
    const matchReasons = [
      `${vacancy.tradeSkill}, ${tradeYears} yrs`,
      `${Math.round(distanceKm)} km away`,
      'Salary fits',
      deadline ? `Day ${Math.min(guaranteeDays, Math.max(1, guaranteeDays - daysLeft))} of ${guaranteeDays}` : `Day 1 of ${guaranteeDays}`,
    ];
    return {
      jobSeekerId: seeker.id,
      score,
      matchReasons,
      photoStoragePath: seeker.photoStoragePath,
      card: {
        firstName: seeker.name.trim().split(/\s+/)[0] ?? '',
        photoUrl: null,
        photoUrlExpiresInSeconds: null,
        age: ageOn(seeker.dateOfBirth!, now),
        trade: matchedTrade?.trade ?? vacancy.tradeSkill,
        yearsExperience: experience,
        languages: seeker.languages.filter((language) => language.speaks).map((language) => language.language),
        distanceKm: Math.round(distanceKm),
        expectedSalary: {
          minPaise: seekerMin,
          maxPaise: monthlyAmount(seeker.maxSalary, seeker.salaryPeriod, salaryDaysPerMonth),
        },
        matchReasons,
      },
    };
  }

  private requirePhotoStorage(): CandidatePhotoStorage {
    if (!this.photoStorage) throw new Error('Candidate photo storage is not configured');
    return this.photoStorage;
  }

  private refundStillOwed(seeker: MatchCandidate): boolean {
    const hasPaidActivation = seeker.paymentReceivedAt !== null || seeker.payments.some((payment) => payment.type === 'activation' && ['succeeded', 'completed'].includes(payment.status));
    const alreadyRefunded = seeker.payments.some((payment) => payment.type === 'refund' && ['succeeded', 'completed'].includes(payment.status));
    const refundForfeitingHit = seeker.hits.some((hit) => !hit.reversedAt && ['offer_declined', 'offer_no_reply', 'interview_no_show'].includes(hit.reason));
    return hasPaidActivation && !alreadyRefunded && !refundForfeitingHit;
  }

  private hasLiveOffer(_jobSeekerId: string, seeker: MatchCandidate): boolean {
    return seeker.placements.some((row) => row.status === 'offered' || row.status === 'confirmed') ||
      seeker.interviews.some((row) => row.status === 'offered' || row.status === 'confirmed') ||
      seeker.replacementCandidateOffers.some((row) => row.status === 'offered');
  }

  private businessRejected(businessId: string, _jobSeekerId: string, seeker: MatchCandidate): boolean {
    return seeker.placements.some((row) => row.businessId === businessId && (
      row.status === 'rejected' || row.replacementCandidates.some((candidate) => candidate.status === 'rejected')
    )) || seeker.interviews.some((interview) => interview.businessId === businessId && interview.result === 'not_selected');
  }

  private readWeights(value: Prisma.JsonValue): Record<FactorName, number> {
    const object = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, Prisma.JsonValue> : {};
    const weights = {} as Record<FactorName, number>;
    for (const key of WEIGHT_KEYS) {
      const configured = object[key];
      if (typeof configured !== 'number' || !Number.isFinite(configured) || configured < 0) {
        throw new Error(`PricingPolicy matchingWeights.${key} must be a non-negative number`);
      }
      weights[key] = configured;
    }
    return weights;
  }
}

function monthlyAmount(amount: number, period: string | null, daysPerMonth: number): number {
  return period?.toLowerCase() === 'daily' ? amount * daysPerMonth : amount;
}

function distanceInKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function ageOn(dateOfBirth: Date, now: Date): number {
  let age = now.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const beforeBirthday = now.getUTCMonth() < dateOfBirth.getUTCMonth() ||
    (now.getUTCMonth() === dateOfBirth.getUTCMonth() && now.getUTCDate() < dateOfBirth.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

function completeness(seeker: MatchCandidate): number {
  const row = seeker as unknown as Record<string, unknown>;
  const filled = OPTIONAL_PROFILE_FIELDS.filter((field) => {
    const value = row[field];
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'string') return value.trim().length > 0;
    return value !== null && value !== undefined;
  }).length;
  return OPTIONAL_PROFILE_FIELDS.length ? filled / OPTIONAL_PROFILE_FIELDS.length : 0;
}

function clip(value: number): number {
  return Math.max(0, Math.min(1, value));
}
