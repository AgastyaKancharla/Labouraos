import { BadRequestException } from '@nestjs/common';
import { CreateJobSeekerDto } from './dto/create-job-seeker.dto';

const REGISTRATION_WINDOWS = {
  '09-12': ['09:00', '12:00'],
  '12-15': ['12:00', '15:00'],
  '15-18': ['15:00', '18:00'],
  '18-21': ['18:00', '21:00'],
  '09-21': ['09:00', '21:00'],
} as const;

const HEARD_FROM_VALUES = [
  'toll_free_missed_call', 'ad', 'referral_partner', 'field_visit',
  'social_media', 'walk_in', 'other',
] as const;

const SHIFT_PREFERENCES = ['day', 'night', 'rotational', 'any'] as const;
const JOB_TYPES = ['full_time', 'part_time', 'live_in'] as const;

export type ValidatedJobSeekerRegistration = {
  name: string;
  phone: string;
  preferredCallWindowStart: string;
  preferredCallWindowEnd: string;
  dateOfBirth: Date;
  availableFrom: Date;
  lookingSince: Date;
  trades: Array<{ trade: string; yearsExperience: number }>;
  spokenLanguages: string[];
};

export function validateJobSeekerRegistration(
  dto: CreateJobSeekerDto,
  adultMinimumAge: number,
  now: Date,
): ValidatedJobSeekerRegistration {
  const requiredText: Array<[string, unknown]> = [
    ['name', dto.name], ['phone', dto.phone], ['otpRequestId', dto.otpRequestId],
    ['gender', dto.gender], ['locality', dto.locality], ['pincode', dto.pincode],
  ];
  for (const [field, value] of requiredText) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(`${field} is required`);
    }
  }
  if (!['kn', 'hi', 'en'].includes(dto.messageLanguage)) {
    throw new BadRequestException('messageLanguage must be kn, hi or en');
  }
  const window = REGISTRATION_WINDOWS[dto.bestTimeToCall];
  if (!window) throw new BadRequestException('bestTimeToCall is invalid');
  if (!HEARD_FROM_VALUES.includes(dto.heardFrom)) {
    throw new BadRequestException('heardFrom is invalid');
  }
  if (!SHIFT_PREFERENCES.includes(dto.shiftPreference)) {
    throw new BadRequestException('shiftPreference is invalid');
  }
  if (!JOB_TYPES.includes(dto.jobType)) {
    throw new BadRequestException('jobType is invalid');
  }
  if (!['monthly', 'daily'].includes(dto.salaryPeriod)) {
    throw new BadRequestException('salaryPeriod must be monthly or daily');
  }

  if (!Number.isFinite(dto.latitude) || dto.latitude < -90 || dto.latitude > 90) {
    throw new BadRequestException('latitude must be between -90 and 90');
  }
  if (!Number.isFinite(dto.longitude) || dto.longitude < -180 || dto.longitude > 180) {
    throw new BadRequestException('longitude must be between -180 and 180');
  }
  if (!Number.isSafeInteger(dto.travelDistanceKm) || dto.travelDistanceKm <= 0) {
    throw new BadRequestException('travelDistanceKm must be a positive integer');
  }

  const dob = parseRegistrationDate(dto.dateOfBirth, 'dateOfBirth');
  if (calculateAge(dob, now) < adultMinimumAge) {
    throw new BadRequestException(`Job seeker must be at least ${adultMinimumAge} years old`);
  }
  const availableFrom = parseRegistrationDate(dto.availableFrom, 'availableFrom');
  const lookingSince = parseRegistrationDate(dto.lookingSince, 'lookingSince');
  validateSalaryRange(dto.minSalary, dto.maxSalary);

  if (!Array.isArray(dto.trades) || dto.trades.length < 1 || dto.trades.length > 3) {
    throw new BadRequestException('One to three trades are required');
  }
  const trades = dto.trades.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new BadRequestException(`trades[${index}] is invalid`);
    }
    const trade = typeof entry?.trade === 'string' ? entry.trade.trim().replace(/\s+/g, ' ') : '';
    if (!trade) throw new BadRequestException(`trades[${index}].trade is required`);
    if (!Number.isSafeInteger(entry.yearsExperience) || entry.yearsExperience < 0) {
      throw new BadRequestException(`trades[${index}].yearsExperience must be a nonnegative integer`);
    }
    return { trade, yearsExperience: entry.yearsExperience };
  });
  const tradeKeys = trades.map(({ trade }) => trade.toLocaleLowerCase('en-IN'));
  if (new Set(tradeKeys).size !== tradeKeys.length) {
    throw new BadRequestException('A trade cannot be listed more than once');
  }

  if (!Array.isArray(dto.spokenLanguages) || dto.spokenLanguages.length === 0) {
    throw new BadRequestException('At least one spoken language is required');
  }
  const spokenLanguages = dto.spokenLanguages.map((language, index) => {
    if (typeof language !== 'string' || !language.trim()) {
      throw new BadRequestException(`spokenLanguages[${index}] is required`);
    }
    return language.trim();
  });
  if (new Set(spokenLanguages.map((language) => language.toLocaleLowerCase('en-IN'))).size !== spokenLanguages.length) {
    throw new BadRequestException('A spoken language cannot be listed more than once');
  }

  return {
    name: dto.name.trim(),
    phone: dto.phone.trim(),
    preferredCallWindowStart: window[0],
    preferredCallWindowEnd: window[1],
    dateOfBirth: dob,
    availableFrom,
    lookingSince,
    trades,
    spokenLanguages,
  };
}

function parseRegistrationDate(value: string, field: string): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`${field} must be a valid YYYY-MM-DD date`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException(`${field} must be a valid YYYY-MM-DD date`);
  }
  return parsed;
}

export function assertNoRawAadhaar(data: unknown): void {
  if (!data || typeof data !== 'object') {
    return;
  }

  const obj = data as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    if (key.toLowerCase().includes('aadhaar') || key.toLowerCase().includes('aadhar')) {
      throw new BadRequestException('Raw Aadhaar fields and numbers must never be submitted or stored');
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      // Check 12 consecutive digits or 4-4-4 format
      if (/^\d{12}$/.test(trimmed) || /^\d{4}\s\d{4}\s\d{4}$/.test(trimmed) || /^\d{4}-\d{4}-\d{4}$/.test(trimmed)) {
        throw new BadRequestException('Raw Aadhaar numbers must never be submitted or stored');
      }
    } else if (typeof value === 'number') {
      if (Number.isInteger(value) && value >= 100000000000 && value <= 999999999999) {
        throw new BadRequestException('Raw Aadhaar numbers must never be submitted or stored');
      }
    } else if (typeof value === 'object' && value !== null) {
      assertNoRawAadhaar(value);
    }
  }
}

export function validateCallWindow(start: string, end: string): void {
  if (!start || !end) {
    throw new BadRequestException('preferredCallWindowStart and preferredCallWindowEnd are required');
  }

  const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;
  if (!timeRegex.test(start) || !timeRegex.test(end)) {
    throw new BadRequestException('Call window times must be in HH:mm 24-hour format');
  }

  const [startH, startM] = start.split(':').map(Number);
  const [endH, endM] = end.split(':').map(Number);
  const startMin = startH * 60 + startM;
  const endMin = endH * 60 + endM;

  const minAllowed = 9 * 60; // 09:00 = 540
  const maxAllowed = 21 * 60; // 21:00 = 1260

  if (startMin < minAllowed || startMin > maxAllowed) {
    throw new BadRequestException(
      `preferredCallWindowStart (${start}) must fall inside 09:00–21:00 IST`,
    );
  }

  if (endMin < minAllowed || endMin > maxAllowed) {
    throw new BadRequestException(
      `preferredCallWindowEnd (${end}) must fall inside 09:00–21:00 IST`,
    );
  }

  if (startMin > endMin) {
    throw new BadRequestException(
      'preferredCallWindowStart must not be later than preferredCallWindowEnd',
    );
  }
}

export function validateSalaryRange(minSalary: unknown, maxSalary: unknown): void {
  if (
    typeof minSalary !== 'number' ||
    typeof maxSalary !== 'number' ||
    !Number.isInteger(minSalary) ||
    !Number.isInteger(maxSalary) ||
    minSalary <= 0 ||
    maxSalary <= 0
  ) {
    throw new BadRequestException(
      'minSalary and maxSalary must be positive integers in paise',
    );
  }

  if (minSalary > maxSalary) {
    throw new BadRequestException(
      'minSalary cannot be greater than maxSalary',
    );
  }
}

export function calculateAge(dob: Date, referenceDate: Date = new Date()): number {
  let age = referenceDate.getFullYear() - dob.getFullYear();
  const m = referenceDate.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && referenceDate.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

export function validateJobSeekerAge(
  dob: Date | string | null | undefined,
  targetStatus: string,
  referenceDate: Date = new Date(),
): void {
  const requires18 = ['pending_activation', 'active', 'paused', 'deactivated', 'placed'].includes(
    targetStatus,
  );
  if (requires18) {
    if (!dob) {
      throw new BadRequestException(
        'dateOfBirth is required before status can move to pending_activation or beyond',
      );
    }
    const parsedDob = typeof dob === 'string' ? new Date(dob) : dob;
    if (Number.isNaN(parsedDob.getTime())) {
      throw new BadRequestException('Invalid dateOfBirth provided');
    }
    const age = calculateAge(parsedDob, referenceDate);
    if (age < 18) {
      throw new BadRequestException('Job seeker must be at least 18 years old');
    }
  }
}

