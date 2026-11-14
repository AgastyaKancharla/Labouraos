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
    if (!row) {
      throw new CustomerApiError(HttpStatus.NOT_FOUND, CUSTOMER_ERROR_CODES.PROFILE_NOT_FOUND, 'Profile not found');
    }
    if (kind && row.kind !== kind) {
      throw new CustomerApiError(HttpStatus.BAD_REQUEST, CUSTOMER_ERROR_CODES.PROFILE_KIND_MISMATCH, `This is for a ${kind} profile`);
    }
    return row as ScopedProfile;
  }

  /** Business profiles: owner (or a profile with no branch limit and role owner) only. */
  assertBusinessOwner(profile: ScopedProfile): void {
    if (profile.kind !== 'business' || profile.role !== 'owner' || profile.branchId) {
      throw new CustomerApiError(HttpStatus.FORBIDDEN, CUSTOMER_ERROR_CODES.NOT_ALLOWED, 'Only the business owner can do this');
    }
  }
}
