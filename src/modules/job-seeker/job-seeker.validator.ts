import { BadRequestException } from '@nestjs/common';

export function assertNoRawAadhaar(data: unknown): void {
  if (!data || typeof data !== 'object') {
    return;
  }

  const obj = data as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    if (key.toLowerCase().includes('aadhaar')) {
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
