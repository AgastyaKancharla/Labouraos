import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { RBAC_MATRIX, Role } from '../rbac/rbac.types';
import { OTP_PROVIDER, OtpProvider, OtpSendOptions, OtpSendResult } from './otp.interface';

export const OTP_PURPOSES = [
  'job_seeker',
  'business_contact',
  'referral',
  'vacancy_confirm',
  'branch_contact',
] as const;

export type OtpPurpose = (typeof OTP_PURPOSES)[number];

function phoneDigits(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('91') && digits.length === 12 ? digits.slice(2) : digits;
}

function phoneVariants(phone: string): string[] {
  const digits = phoneDigits(phone);
  return [...new Set([phone.trim(), digits, `91${digits}`, `+91${digits}`])];
}

@Injectable()
export class OtpService {
  constructor(
    @Inject(OTP_PROVIDER)
    private readonly provider: OtpProvider,
    private readonly auditService: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  async sendOtp(
    phone: string,
    purpose: OtpPurpose = 'job_seeker',
    actorId?: string,
    actorRole = '',
    requestId?: string,
  ): Promise<OtpSendResult | { alreadyRegistered: true; type?: string; code?: string }> {
    if (!phone?.trim()) throw new BadRequestException('Phone number is required');
    if (!(OTP_PURPOSES as readonly string[]).includes(purpose)) {
      throw new BadRequestException('purpose must be one of the supported OTP purposes');
    }

    const last4 = phoneDigits(phone).slice(-4);
    if (!requestId && purpose !== 'vacancy_confirm') {
      const duplicate = await this.findDuplicate(phone);
      if (duplicate) {
        const visible = await this.canSeeRecord(duplicate, actorId, actorRole);
        const response = visible
          ? { alreadyRegistered: true as const, type: duplicate.type, code: duplicate.code }
          : { alreadyRegistered: true as const };
        if (actorId) await this.auditService.log({
          actorId,
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
    const result = await this.provider.sendOtp(phone, options);
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
    const variants = phoneVariants(phone);
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
