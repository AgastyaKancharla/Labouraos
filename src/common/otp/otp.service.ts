import { OwnTeam, businessOwners } from '../rbac/own-team';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { RBAC_MATRIX, Role } from '../rbac/rbac.types';
import { mobileLookupValues, phoneLast4, requireIndianMobile } from '../phone/indian-mobile';
import { OTP_PROVIDER, OtpProvider, OtpSendOptions, OtpSendResult } from './otp.interface';
import { publicPageOtpPurpose } from './public-page-otp';
import { assertFullNumberSearchAllowed, recordFullNumberSearch } from '../phone/full-number-search';

export const OTP_PURPOSES = [
  'job_seeker',
  'business_contact',
  'referral',
  'vacancy_confirm',
  'branch_contact',
  /** The owner confirms an interview result in the shop (selected: salary and joining date; not selected: reason). */
  'interview_result',
] as const;

/** Purposes that confirm something for an existing record, so the "already registered" check is skipped. */
const CONFIRMATION_PURPOSES: readonly string[] = ['vacancy_confirm', 'interview_result'];

export type OtpPurpose = (typeof OTP_PURPOSES)[number];


@Injectable()
export class OtpService {
  constructor(
    @Inject(OTP_PROVIDER)
    private readonly provider: OtpProvider,
    private readonly auditService: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  async sendOtp(phone: string): Promise<OtpSendResult>;
  async sendOtp(
    phone: string,
    purpose: OtpPurpose,
    actorId: string,
    actorRole: string,
    requestId?: string,
  ): Promise<OtpSendResult | { alreadyRegistered: true; type?: string; code?: string }>;
  async sendOtp(
    rawPhone: string,
    purpose: OtpPurpose = 'job_seeker',
    actorId?: string,
    actorRole = '',
    requestId?: string,
  ): Promise<OtpSendResult | { alreadyRegistered: true; type?: string; code?: string }> {
    if (typeof rawPhone !== 'string' || !rawPhone.trim()) throw new BadRequestException('Phone number is required');
    // One format everywhere: the code goes to, and is checked against, +91 and 10 digits.
    const phone = requireIndianMobile(rawPhone);
    if (!(OTP_PURPOSES as readonly string[]).includes(purpose)) {
      throw new BadRequestException('purpose must be one of the supported OTP purposes');
    }

    const last4 = phoneLast4(phone);
    const staffId = actorId;
    if (staffId && !requestId && !CONFIRMATION_PURPOSES.includes(purpose)) {
      // Security L1: an "Already registered" answer tells the staff member the
      // number is ours, so it counts as a full-number search (audited, 30 an
      // hour). At the limit every fresh send is refused, so a number that is ours
      // and one that is not get the same answer.
      await assertFullNumberSearchAllowed(this.prisma, staffId);
      const duplicate = await this.findDuplicate(phone);
      if (duplicate) {
        await recordFullNumberSearch(this.prisma, this.auditService, { id: staffId, role: actorRole }, 'otp_send', phone);
        const visible = await this.canSeeRecord(duplicate, staffId, actorRole);
        const response = visible
          ? { alreadyRegistered: true as const, type: duplicate.type, code: duplicate.code }
          : { alreadyRegistered: true as const };
        await this.auditService.log({
          actorId: staffId,
          action: 'otp.send_attempt',
          entityType: 'otp_request',
          entityCode: duplicate.code,
          after: { phoneMasked: `******${last4}`, purpose, alreadyRegistered: true },
          city: 'Bengaluru',
        });
        return response;
      }
    }

    const options: OtpSendOptions = { purpose, requestId };
    let result: OtpSendResult;
    try {
      result = await this.provider.sendOtp(phone, options);
    } catch (error: unknown) {
      if (actorId) {
        await this.auditService.log({
          actorId,
          action: 'otp.send_attempt',
          entityType: 'otp_request',
          entityCode: requestId ?? 'unissued',
          after: {
            phoneMasked: `******${last4}`,
            purpose,
            isResend: Boolean(requestId),
            failed: true,
          },
          city: 'Bengaluru',
        });
      }
      throw error;
    }
    if (actorId) await this.auditService.log({
      actorId,
      action: 'otp.send_attempt',
      entityType: 'otp_request',
      entityCode: result.requestId,
      after: {
        phoneMasked: `******${last4}`,
        purpose,
        resendAvailableAt: result.resendAvailableAt,
        resendsLeft: result.resendsLeft,
        isResend: Boolean(requestId),
      },
      city: 'Bengaluru',
    });
    return result;
  }

  async verifyOtp(requestId: string, code: string, actorId?: string): Promise<boolean> {
    const verified = await this.provider.verifyOtp(requestId, code);
    const phoneLast4 = await this.provider.getPhoneLast4?.(requestId);
    if (actorId) await this.auditService.log({
      actorId,
      action: 'otp.verify_attempt',
      entityType: 'otp_request',
      entityCode: requestId,
      after: { phoneMasked: phoneLast4 ? `******${phoneLast4}` : '******', verified },
      city: 'Bengaluru',
    });
    return verified;
  }

  /**
   * A staff-sent code bound to one record (e.g. `vacancy_confirm:<vacancyId>:<round>`),
   * so it only confirms that record in that round. Never reachable from POST /otp/send
   * (OTP_PURPOSES). Audited like any staff send.
   */
  async sendBoundOtp(rawPhone: string, purpose: string, actorId: string, requestId?: string): Promise<OtpSendResult> {
    const phone = requireIndianMobile(rawPhone);
    const result = await this.provider.sendOtp(phone, { purpose, requestId });
    await this.auditService.log({
      actorId,
      action: 'otp.send_attempt',
      entityType: 'otp_request',
      entityCode: result.requestId,
      after: { phoneMasked: `******${phoneLast4(phone)}`, purpose: purpose.split(':')[0], isResend: Boolean(requestId) },
      city: 'Bengaluru',
    });
    return result;
  }

  /**
   * "Send code" on a person's own public page (/p/...): the code goes to the
   * number the link was issued for, with a purpose bound to that link
   * (public-page-otp.ts). Only isVerifiedForPage / consumeVerifiedForPage with
   * the same link accept it, and no staff-sent code is accepted there.
   */
  async sendPublicPageOtp(rawPhone: string, linkToken: string): Promise<OtpSendResult> {
    const phone = requireIndianMobile(rawPhone);
    return this.provider.sendOtp(phone, { purpose: publicPageOtpPurpose(linkToken) });
  }

  /** A code sent from this link's own page, verified, unused and for this phone. */
  async isVerifiedForPage(requestId: string | undefined | null, phone: string | null | undefined, linkToken: string): Promise<boolean> {
    if (typeof requestId !== 'string' || !requestId || !phone) return false;
    return this.isVerified(requestId, phone, publicPageOtpPurpose(linkToken));
  }

  /** Uses up the page's verified code (a submit): it opens nothing after this. */
  async consumeVerifiedForPage(requestId: string | undefined | null, phone: string | null | undefined, linkToken: string): Promise<boolean> {
    if (typeof requestId !== 'string' || !requestId || !phone) return false;
    return this.consumeVerified(requestId, phone, publicPageOtpPurpose(linkToken));
  }

  /**
   * A phone that is passed but empty (`''`, null) never matches: it refuses, rather
   * than skipping the check that the code went to that number (a link or record
   * with no phone must not accept any verified code).
   */
  async isVerified(requestId: string, phone?: string | null, purpose?: string): Promise<boolean> {
    if (phone !== undefined && !phone) return false;
    return this.provider.isVerified ? this.provider.isVerified(requestId, phone, purpose) : false;
  }

  async consumeVerified(requestId: string, phone: string | null, purpose?: string): Promise<boolean> {
    if (!phone) return false;
    return this.provider.consumeVerified
      ? this.provider.consumeVerified(requestId, phone, purpose)
      : false;
  }

  getProvider(): OtpProvider {
    return this.provider;
  }

  private async findDuplicate(phone: string) {
    const variants = mobileLookupValues(phone);
    const seeker = await this.prisma.jobSeeker.findFirst({
      where: { phone: { in: variants } },
      select: { id: true, code: true, registeredByStaffId: true },
    });
    if (seeker) {
      return { ...seeker, type: 'job_seeker', resource: 'job_seeker' as const, ownerStaffIds: [seeker.registeredByStaffId], teamOwnerIds: [seeker.registeredByStaffId] };
    }
    const business = await this.prisma.business.findFirst({
      where: { OR: [
        { phone: { in: variants } },
        { additionalContactPhone: { in: variants } },
      ] },
      select: { id: true, code: true, accountAgentId: true, leadCreatedByStaffId: true },
    });
    if (business) {
      return {
        ...business,
        type: 'business',
        resource: 'business' as const,
        ownerStaffIds: [business.accountAgentId, business.leadCreatedByStaffId],
        teamOwnerIds: businessOwners(business),
      };
    }
    const branch = await this.prisma.businessBranch.findFirst({
      where: { contactPersonPhone: { in: variants } },
      select: { business: { select: { id: true, code: true, accountAgentId: true, leadCreatedByStaffId: true } } },
    });
    if (branch) {
      return {
        ...branch.business,
        type: 'business',
        resource: 'business' as const,
        ownerStaffIds: [branch.business.accountAgentId, branch.business.leadCreatedByStaffId],
        teamOwnerIds: businessOwners(branch.business),
      };
    }
    const referral = await this.prisma.referral.findFirst({
      where: { phone: { in: variants } },
      select: { id: true, code: true },
    });
    return referral ? { ...referral, type: 'referral', resource: 'referral' as const, ownerStaffIds: [], teamOwnerIds: [] } : null;
  }

  private async canSeeRecord(
    record: {
      resource: 'job_seeker' | 'business' | 'referral';
      id: string;
      ownerStaffIds: Array<string | null>;
      /** Whose team the record belongs to (businessOwners for a business). */
      teamOwnerIds: Array<string | null>;
    },
    actorId: string,
    actorRole: string,
  ): Promise<boolean> {
    const role = actorRole as Role;
    const rule = RBAC_MATRIX[role]?.[record.resource]?.read;
    if (!rule?.allowed) return false;
    if (rule.scope === 'all') return true;
    if (rule.scope !== 'own_team' && rule.scope !== 'own_account' && rule.scope !== 'own_lead') return false;

    const actor = await this.prisma.staff.findUnique({
      where: { id: actorId },
      select: { id: true, role: true, teamLeadId: true },
    });
    if (!actor) return false;
    // A Team Lead: the record's team (businessOwners for a business, rev 170).
    if (rule.scope === 'own_team' && actor.role === 'team_lead') {
      return new OwnTeam(this.prisma).includesAny(actorId, record.teamOwnerIds);
    }
    return record.ownerStaffIds.includes(actorId);
  }
}
