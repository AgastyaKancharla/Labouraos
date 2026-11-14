import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerProfileKind } from './customer-app.constants';
import { CUSTOMER_ERROR_CODES, CustomerApiError } from './customer-auth.errors';

/** One of my profiles: the only way a customer request reaches a record. */
export interface ScopedProfile {
  id: string;
  accountId: string;
  kind: CustomerProfileKind;
  role: string;
  jobSeekerId: string | null;
  businessId: string | null;
  branchId: string | null;
  referralId: string | null;
}

/**
 * "My own records only" (customer app proposal 7.6, 8.1). Every customer route
 * that touches a job seeker, business or partner goes through `profile()`: the
 * profile must belong to the signed-in account and be active, otherwise the
 * answer is 404 PROFILE_NOT_FOUND — the same as for an id that does not exist,
 * so nobody can probe for other people's records.
 */
@Injectable()
export class CustomerScopeService {
  constructor(private readonly prisma: PrismaService) {}

  async profile(accountId: string, profileId: string, kind?: CustomerProfileKind): Promise<ScopedProfile> {
    const row = typeof profileId === 'string' && profileId.length <= 64
      ? await this.prisma.customerProfile.findFirst({
          where: { id: profileId, accountId, status: 'active' },
          select: { id: true, accountId: true, kind: true, role: true, jobSeekerId: true, businessId: true, branchId: true, referralId: true },
        })
      : null;
    if (row && !(await this.stillMine(accountId, [row.id])).has(row.id)) {
      throw new CustomerApiError(HttpStatus.NOT_FOUND, CUSTOMER_ERROR_CODES.PROFILE_NOT_FOUND, 'Profile not found');
    }
    if (!row) {
      throw new CustomerApiError(HttpStatus.NOT_FOUND, CUSTOMER_ERROR_CODES.PROFILE_NOT_FOUND, 'Profile not found');
    }
    if (kind && row.kind !== kind) {
      throw new CustomerApiError(HttpStatus.BAD_REQUEST, CUSTOMER_ERROR_CODES.PROFILE_KIND_MISMATCH, `This is for a ${kind} profile`);
    }
    return row as ScopedProfile;
  }

  /**
   * A profile that rests on a mobile (linked by phone, or self-registered) stays
   * only while the record still carries the account's verified mobile and is
   * not anonymised. Otherwise it is revoked (security review M1): an agent who
   * corrects a phone number, or anonymisation, cuts the app's access at once.
   * Returns the ids still valid; revokes the others.
   */
  async stillMine(accountId: string, profileIds?: string[]): Promise<Set<string>> {
    const account = await this.prisma.customerAccount.findUnique({ where: { id: accountId }, select: { phone: true } });
    const rows = await this.prisma.customerProfile.findMany({
      where: { accountId, status: 'active', ...(profileIds ? { id: { in: profileIds } } : {}) },
      select: {
        id: true, linkedVia: true,
        jobSeeker: { select: { phone: true, anonymisedAt: true } },
        referral: { select: { phone: true, anonymisedAt: true } },
        business: { select: { phone: true, anonymisedAt: true } },
        branch: { select: { contactPersonPhone: true } },
      },
    });
    const digits = (value: string | null | undefined) => (value ?? '').replace(/\D/g, '').slice(-10);
    const mine = digits(account?.phone);
    const valid = new Set<string>();
    const revoke: string[] = [];
    for (const row of rows) {
      const record = row.jobSeeker ?? row.referral ?? row.business;
      const anonymised = Boolean(record?.anonymisedAt);
      const phoneBound = row.linkedVia === 'phone_match' || row.linkedVia === 'self_registered';
      const recordPhone = row.branch ? row.branch.contactPersonPhone : record?.phone;
      const ok = !anonymised && (!phoneBound || (mine.length === 10 && digits(recordPhone) === mine));
      if (ok) valid.add(row.id);
      else revoke.push(row.id);
    }
    if (revoke.length) {
      await this.prisma.customerProfile.updateMany({ where: { id: { in: revoke } }, data: { status: 'revoked', revokedAt: new Date() } });
    }
    return valid;
  }

  /** Business profiles: owner (or a profile with no branch limit and role owner) only. */
  assertBusinessOwner(profile: ScopedProfile): void {
    if (profile.kind !== 'business' || profile.role !== 'owner' || profile.branchId) {
      throw new CustomerApiError(HttpStatus.FORBIDDEN, CUSTOMER_ERROR_CODES.NOT_ALLOWED, 'Only the business owner can do this');
    }
  }
}
