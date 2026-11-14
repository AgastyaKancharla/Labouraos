import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CUSTOMER_BUSINESS_ROLES } from '../../common/customer-auth/customer-app.constants';
import { mobileLookupValues } from '../../common/phone/indian-mobile';

export interface LinkedProfile {
  profileId: string;
  kind: string;
  code: string;
  linkedVia: string;
}

type Tx = Prisma.TransactionClient | PrismaService;

/** A race with another sign-in of the same person: the link already exists, skip it. */
async function createOrSkip<T>(create: () => Promise<T>): Promise<T | null> {
  try {
    return await create();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return null;
    throw error;
  }
}

/** The contact's role on the business; "other" is not an owner. */
function businessRole(role: string | null | undefined): string {
  if (role && (CUSTOMER_BUSINESS_ROLES as readonly string[]).includes(role)) return role;
  return role === 'other' ? 'supervisor' : 'owner';
}

/**
 * Attaches an account to the records an agent already made with the same
 * OTP-verified mobile (proposal 3.4): the job seeker, the referral partner,
 * a business whose contact mobile it is, or a branch whose contact person it
 * is (that profile sees only the branch). Never creates a record and never a
 * second link: a record linked to another account stays with it.
 */
@Injectable()
export class CustomerLinkingService {
  constructor(private readonly prisma: PrismaService) {}

  async linkByVerifiedPhone(accountId: string, phone: string, tx: Tx = this.prisma): Promise<LinkedProfile[]> {
    const variants = mobileLookupValues(phone);
    const linked: LinkedProfile[] = [];

    const seeker = await tx.jobSeeker.findFirst({
      where: { phone: { in: variants }, anonymisedAt: null },
      select: { id: true, code: true, customerProfiles: { select: { id: true, accountId: true, status: true } } },
    });
    if (seeker && seeker.customerProfiles.length === 0) {
      const p = await createOrSkip(() => tx.customerProfile.create({
        data: { accountId, kind: 'job_seeker', jobSeekerId: seeker.id, role: 'self', linkedVia: 'phone_match' },
      }));
      if (p) linked.push({ profileId: p.id, kind: 'job_seeker', code: seeker.code, linkedVia: 'phone_match' });
    }

    const referral = await tx.referral.findFirst({
      where: { phone: { in: variants }, anonymisedAt: null },
      select: { id: true, code: true, customerProfiles: { select: { id: true } } },
    });
    if (referral && referral.customerProfiles.length === 0) {
      const p = await createOrSkip(() => tx.customerProfile.create({
        data: { accountId, kind: 'referral', referralId: referral.id, role: 'self', linkedVia: 'phone_match' },
      }));
      if (p) linked.push({ profileId: p.id, kind: 'referral', code: referral.code, linkedVia: 'phone_match' });
    }

    // Only the business's own OTP-verified contact mobile (Business.phone) links a
    // business profile. An "additional contact" number was never verified and
    // links nothing (security review M1).
    const businesses = await tx.business.findMany({
      where: { anonymisedAt: null, phone: { in: variants } },
      select: { id: true, code: true, contactRole: true },
    });
    for (const business of businesses) {
      const existing = await tx.customerProfile.findFirst({
        where: { accountId, businessId: business.id, branchId: null },
        select: { id: true },
      });
      if (existing) continue;
      const p = await createOrSkip(() => tx.customerProfile.create({
        data: { accountId, kind: 'business', businessId: business.id, role: businessRole(business.contactRole), linkedVia: 'phone_match' },
      }));
      if (p) linked.push({ profileId: p.id, kind: 'business', code: business.code, linkedVia: 'phone_match' });
    }

    const branches = await tx.businessBranch.findMany({
      where: { contactPersonPhone: { in: variants }, business: { anonymisedAt: null } },
      select: { id: true, businessId: true, contactPersonRole: true, business: { select: { code: true } } },
    });
    for (const branch of branches) {
      // Already the whole business's contact: no narrower branch profile.
      if (businesses.some((b) => b.id === branch.businessId)) continue;
      const existing = await tx.customerProfile.findFirst({
        where: { accountId, businessId: branch.businessId, branchId: branch.id },
        select: { id: true },
      });
      if (existing) continue;
      // A branch contact is never the business owner; with no known role, supervisor.
      const role = branch.contactPersonRole === 'owner' ? 'manager'
        : (CUSTOMER_BUSINESS_ROLES as readonly string[]).includes(branch.contactPersonRole ?? '') ? branch.contactPersonRole! : 'supervisor';
      const p = await createOrSkip(() => tx.customerProfile.create({
        data: { accountId, kind: 'business', businessId: branch.businessId, branchId: branch.id, role, linkedVia: 'phone_match' },
      }));
      if (p) linked.push({ profileId: p.id, kind: 'business', code: branch.business.code, linkedVia: 'phone_match' });
    }
    return linked;
  }
}
