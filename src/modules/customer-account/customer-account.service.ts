import { Injectable } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CUSTOMER_ERROR_CODES, CustomerApiError } from '../../common/customer-auth/customer-auth.errors';

/** First word of a name: other people's screens never get a full name. */
export function firstName(name: string | null | undefined): string | null {
  const word = name?.trim().split(/\s+/)[0];
  return word ? word : null;
}

@Injectable()
export class CustomerAccountService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /customer-api/v1/me: the account and the profiles it may act for. */
  async me(accountId: string) {
    const account = await this.prisma.customerAccount.findUnique({
      where: { id: accountId },
      select: {
        id: true,
        phone: true,
        phoneVerifiedAt: true,
        email: true,
        displayName: true,
        language: true,
        contactMeConsent: true,
        status: true,
        lastProfileId: true,
        createdAt: true,
        identities: { select: { provider: true } },
        profiles: {
          where: { status: 'active' },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            kind: true,
            role: true,
            jobSeeker: { select: { code: true, name: true } },
            referral: { select: { code: true, name: true } },
            business: { select: { code: true, name: true } },
            branch: { select: { name: true } },
          },
        },
      },
    });
    if (!account) {
      throw new CustomerApiError(HttpStatus.NOT_FOUND, CUSTOMER_ERROR_CODES.SESSION_ENDED, 'Account not found');
    }
    return {
      id: account.id,
      phone: account.phone,
      phoneVerified: Boolean(account.phoneVerifiedAt),
      email: account.email,
      displayName: account.displayName,
      language: account.language,
      contactMeConsent: account.contactMeConsent,
      status: account.status,
      signInMethods: [...new Set(account.identities.map((i) => i.provider))].sort(),
      lastProfileId: account.lastProfileId,
      createdAt: account.createdAt,
      profiles: account.profiles.map((p) => {
        const record = p.jobSeeker ?? p.referral ?? p.business;
        return {
          id: p.id,
          kind: p.kind,
          role: p.role,
          code: record?.code ?? null,
          // Their own record: a business shows its name, a person their first name.
          title: p.business ? p.business.name : firstName(record?.name),
          branchName: p.branch?.name ?? null,
        };
      }),
    };
  }
}
