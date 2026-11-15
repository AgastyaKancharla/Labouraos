import { BadRequestException } from '@nestjs/common';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { EditPolicyService, pickEditableFields } from './edit-policy.service';
import { ALLOWED_REFERRAL_UPDATE_FIELDS } from '../../modules/referral/referral.service';
import { ALLOWED_BUSINESS_UPDATE_FIELDS } from '../../modules/business/business.service';
import { ALLOWED_VACANCY_UPDATE_FIELDS } from '../../modules/vacancy/vacancy.service';
import { ALLOWED_PLACEMENT_UPDATE_FIELDS } from '../../modules/placement/placement.service';

/**
 * Security AC-1: the four PATCH routes (referrals, businesses, vacancies,
 * placements) used to copy the whole request body into prisma.update, nested
 * relation writes included. These tests pin the allowlists and the column
 * checks, and scan every service for a request body spread into a Prisma write.
 */

const service = new EditPolicyService({} as never, {} as never);

describe('AC-1 edit allowlists', () => {
  const NEVER_EDITABLE = [
    'phoneVerified', 'status', 'verificationStatus', 'verifiedAt', 'verifiedByStaffId', 'documentsStatus',
    'gstVerified', 'accountAgentId', 'accountAgentAssignedAt', 'leadCreatedByStaffId', 'paidAt', 'placementFee',
    'gstAmount', 'feePercentAtCreation', 'gstPercentAtCreation', 'invoiceCode', 'pausedAt', 'pausedByStaffId',
    'pauseReason', 'suspendedAt', 'suspendedUntil', 'suspendedByStaffId', 'suspensionReason', 'confirmedAt',
    'confirmationMethod', 'confirmedByName', 'registeredByStaffId', 'registeredBy', 'payments', 'business',
    'businessId', 'placements', 'jobSeekers', 'capturedByStaffId', 'createdByStaffId', 'anonymisedAt',
    'belowLegalMinimum', 'legalMinimumPaise', 'joinedDate', 'guaranteeEndedReason', 'customerProfiles',
  ];

  it.each([
    ['referral', ALLOWED_REFERRAL_UPDATE_FIELDS],
    ['business', ALLOWED_BUSINESS_UPDATE_FIELDS],
    ['vacancy', ALLOWED_VACANCY_UPDATE_FIELDS],
    ['placement', ALLOWED_PLACEMENT_UPDATE_FIELDS],
  ])('the %s allowlist holds no status, verification, money, pause, suspension or relation field', (_name, allowed) => {
    expect(NEVER_EDITABLE.filter((field) => allowed.has(field))).toEqual([]);
  });

  it.each([
    [{ registeredBy: { create: { staffCode: 'CEO-99999', role: 'ceo' } } }, ALLOWED_REFERRAL_UPDATE_FIELDS],
    [{ payments: { create: { amount: 99900, status: 'approved' } } }, ALLOWED_REFERRAL_UPDATE_FIELDS],
    [{ business: { update: { verificationStatus: 'verified' } } }, ALLOWED_VACANCY_UPDATE_FIELDS],
    [{ placements: { create: { status: 'confirmed' } } }, ALLOWED_BUSINESS_UPDATE_FIELDS],
    [{ paidAt: '2026-11-15T00:00:00Z' }, ALLOWED_PLACEMENT_UPDATE_FIELDS],
    [{ suspendedAt: '2026-11-15T00:00:00Z', suspensionReason: 'x' }, ALLOWED_BUSINESS_UPDATE_FIELDS],
    [{ status: 'cancelled' }, ALLOWED_VACANCY_UPDATE_FIELDS],
  ])('refuses %j with 400', (body, allowed) => {
    expect(() => pickEditableFields(body as Record<string, unknown>, allowed, 'record')).toThrow(BadRequestException);
  });

  it('keeps allowed fields and drops control keys', () => {
    expect(
      pickEditableFields({ name: 'Ravi', reason: 'typo', id: 'x', phoneOtpRequestId: 'r1', pincode: undefined }, ALLOWED_REFERRAL_UPDATE_FIELDS, 'referral'),
    ).toEqual({ name: 'Ravi' });
  });

  it('refuses a body that is not an object', () => {
    expect(() => pickEditableFields([] as unknown as Record<string, unknown>, ALLOWED_REFERRAL_UPDATE_FIELDS, 'referral')).toThrow(BadRequestException);
  });
});

describe('AC-1 diffAndValidateReason column checks', () => {
  const referral = { id: 'r1', code: 'RF-00001', name: 'Old', phone: '+919876543210', pincode: null, latitude: null };

  it('refuses an unknown key', () => {
    expect(() => service.diffAndValidateReason(referral, { nonsense: 'x' }, 'r', 'referral')).toThrow('Unknown field: nonsense');
  });

  it.each([
    ['registeredBy', { create: { role: 'ceo' } }],
    ['payments', { create: { amount: 1 } }],
    ['jobSeekers', { connect: [{ id: 'j1' }] }],
  ])('refuses the relation %s', (key, value) => {
    expect(() => service.diffAndValidateReason(referral, { [key]: value }, 'r', 'referral')).toThrow(/linked record/);
  });

  it.each([
    ['name', { set: 'x' }],
    ['name', ['x']],
    ['latitude', '12.9'],
    ['pincode', 560001],
  ])('refuses %s = %j (wrong type for the column)', (key, value) => {
    expect(() => service.diffAndValidateReason(referral, { [key]: value }, 'r', 'referral')).toThrow(/wrong type/);
  });

  it('accepts arrays only for list columns, of plain values', () => {
    const business = { id: 'b1', staffNeeded: [], workingDays: [] };
    expect(service.diffAndValidateReason(business, { staffNeeded: ['cook'] }, undefined, 'business').changedFields).toEqual(['staffNeeded']);
    expect(() => service.diffAndValidateReason(business, { staffNeeded: [{ set: 'x' }] }, undefined, 'business')).toThrow(/wrong type/);
    expect(() => service.diffAndValidateReason(business, { staffNeeded: 'cook' }, undefined, 'business')).toThrow(/wrong type/);
  });

  it('without an entity type, only the record’s own keys with plain values', () => {
    expect(() => service.diffAndValidateReason(referral, { other: 1 }, 'r')).toThrow('Unknown field: other');
    expect(() => service.diffAndValidateReason(referral, { name: { set: 'x' } }, 'r')).toThrow(/wrong type/);
    expect(service.diffAndValidateReason(referral, { name: 'New' }, 'r').changedFields).toEqual(['name']);
  });
});

describe('AC-1 no request body spread into a Prisma write', () => {
  const root = join(__dirname, '..', '..');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        if (entry !== 'node_modules' && entry !== 'test-support') walk(path);
      } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts') && !entry.endsWith('.d.ts')) {
        files.push(path);
      }
    }
  };
  walk(root);

  /** The text of each `.create(` / `.update(` / `.upsert(` / `...Many(` call, up to its closing parenthesis. */
  function prismaWriteCalls(source: string): string[] {
    const calls: string[] = [];
    const start = /\.(create|createMany|update|updateMany|upsert)\(\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = start.exec(source))) {
      let depth = 0;
      let end = match.index;
      for (let i = source.indexOf('(', match.index); i < source.length; i += 1) {
        if (source[i] === '(') depth += 1;
        else if (source[i] === ')') {
          depth -= 1;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      calls.push(source.slice(match.index, end + 1));
    }
    return calls;
  }

  const RAW_BODY = /\bdata\s*:\s*(dto|body|req\.body|payload)\b(?!\.)|\.\.\.\s*(dto|body|req\.body|payload)\b(?!\.)/;

  it('finds no `data: dto`, `data: body` or `...dto` / `...body` in any Prisma write', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const call of prismaWriteCalls(source)) {
        if (RAW_BODY.test(call)) offenders.push(`${relative(root, file)}: ${call.split('\n')[0].trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the scanner catches the pattern it looks for', () => {
    const sample = "await this.prisma.referral.update({ where: { id }, data: { ...dto, x: 1 } });\nprisma.business.update({ where: { id }, data: body })";
    expect(prismaWriteCalls(sample).filter((call) => RAW_BODY.test(call))).toHaveLength(2);
    expect(RAW_BODY.test('prisma.x.update({ data: { name: dto.name } })')).toBe(false);
  });
});
