import { Injectable } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CUSTOMER_ERROR_CODES, CustomerApiError } from '../../common/customer-auth/customer-auth.errors';
import { CUSTOMER_LANGUAGES } from '../../common/customer-auth/customer-app.constants';
import { CustomerAuthClock } from '../../common/customer-auth/customer-auth.clock';

/** Version of the contact-me tick's wording (C7), kept with the tick. */
export const CONTACT_ME_NOTICE_VERSION = 'contact-me-2026-11-14';

/** First word of a name: other people's screens never get a full name. */
export function firstName(name: string | null | undefined): string | null {
  const word = name?.trim().split(/\s+/)[0];
  return word ? word : null;
}

@Injectable()
export class CustomerAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: CustomerAuthClock,
  ) {}

  /** PATCH /me: language, display name, the contact-me tick. */
  async update(accountId: string, body: Record<string, unknown>) {
    const data: Record<string, unknown> = {};
    if (body.language !== undefined) {
      if (typeof body.language !== 'string' || !(CUSTOMER_LANGUAGES as readonly string[]).includes(body.language)) {
        throw new CustomerApiError(HttpStatus.BAD_REQUEST, CUSTOMER_ERROR_CODES.VALIDATION, 'language must be kn, hi or en', { field: 'language' });
      }
      data.language = body.language;
    }
    if (body.displayName !== undefined) {
      if (body.displayName !== null && (typeof body.displayName !== 'string' || body.displayName.trim().length > 120)) {
        throw new CustomerApiError(HttpStatus.BAD_REQUEST, CUSTOMER_ERROR_CODES.VALIDATION, 'displayName is too long', { field: 'displayName' });
      }
      data.displayName = typeof body.displayName === 'string' && body.displayName.trim() ? body.displayName.trim() : null;
    }
    if (body.contactMe !== undefined) {
      if (typeof body.contactMe !== 'boolean') {
        throw new CustomerApiError(HttpStatus.BAD_REQUEST, CUSTOMER_ERROR_CODES.VALIDATION, 'contactMe must be true or false', { field: 'contactMe' });
      }
      await this.setContactMe(accountId, body.contactMe);
    }
    if (Object.keys(data).length) await this.prisma.customerAccount.update({ where: { id: accountId }, data });
    return this.me(accountId);
  }

  /** The contact-me tick (C7), also copied to the account's open sign-ups. */
  async setContactMe(accountId: string, value: boolean): Promise<void> {
    const now = this.clock.now();
    await this.prisma.customerAccount.update({
      where: { id: accountId },
      data: value
        ? { contactMeConsent: true, contactMeConsentAt: now, contactMeNoticeVersion: CONTACT_ME_NOTICE_VERSION }
        : { contactMeConsent: false, contactMeConsentAt: now },
    });
    await this.prisma.signupTracker.updateMany({ where: { accountId, outcome: 'open' }, data: { contactConsent: value } });
  }

  /** PUT /me/last-profile: the profile Home opens next time (must be one of mine). */
  async setLastProfile(accountId: string, profileId: unknown): Promise<void> {
    const profile = typeof profileId === 'string'
      ? await this.prisma.customerProfile.findFirst({ where: { id: profileId, accountId, status: 'active' }, select: { id: true } })
      : null;
    if (!profile) throw new CustomerApiError(HttpStatus.NOT_FOUND, CUSTOMER_ERROR_CODES.PROFILE_NOT_FOUND, 'Profile not found');
    await this.prisma.customerAccount.update({ where: { id: accountId }, data: { lastProfileId: profile.id } });
  }

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
