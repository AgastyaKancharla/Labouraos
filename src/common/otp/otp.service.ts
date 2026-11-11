import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { RBAC_MATRIX, Role } from '../rbac/rbac.types';
import { mobileLookupValues, phoneLast4, requireIndianMobile } from '../phone/indian-mobile';
import { OTP_PROVIDER, OtpProvider, OtpSendOptions, OtpSendResult } from './otp.interface';

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
      const duplicate = await this.findDuplicate(phone);
      if (duplicate) {
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

  async isVerified(requestId: string, phone?: string): Promise<boolean> {
    return this.provider.isVerified ? this.provider.isVerified(requestId, phone) : false;
  }

  async consumeVerified(requestId: string, phone: string): Promise<boolean> {
    return this.provider.consumeVerified
      ? this.provider.consumeVerified(requestId, phone)
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
      return { ...seeker, type: 'job_seeker', resource: 'job_seeker' as const, ownerStaffIds: [seeker.registeredByStaffId] };
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
      };
    }
    const referral = await this.prisma.referral.findFirst({
      where: { phone: { in: variants } },
      select: { id: true, code: true },
    });
    return referral ? { ...referral, type: 'referral', resource: 'referral' as const, ownerStaffIds: [] } : null;
  }

  private async canSeeRecord(
    record: { resource: 'job_seeker' | 'business' | 'referral'; id: string; ownerStaffIds: Array<string | null> },
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
    if (record.ownerStaffIds.includes(actorId)) return true;
    if (rule.scope !== 'own_team' || actor.role !== 'team_lead') return false;
    const ownerIds = record.ownerStaffIds.filter((id): id is string => Boolean(id));
    if (!ownerIds.length) return false;
    const inTeam = await this.prisma.staff.findFirst({
      where: { id: { in: ownerIds }, teamLeadId: actorId },
      select: { id: true },
    });
    return Boolean(inTeam);
  }
}
