import { PRODUCT_LANGUAGE } from '../../common/language/english-only';
import { OwnTeam } from '../../common/rbac/own-team';
import { assertNotBanned } from '../conduct/permanent-ban.check';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { AuditService } from '../../common/audit/audit.service';
import { OtpService } from '../../common/otp/otp.service';
import { CreateReferralDto } from './dto/create-referral.dto';
import { assertNoRawAadhaar, HEARD_FROM_VALUES } from '../job-seeker/job-seeker.validator';
import { EditPolicyService, EditActor, pickEditableFields } from '../../common/edit-policy/edit-policy.service';
import { mobileLookupValues, requireIndianMobile } from '../../common/phone/indian-mobile';
import { sendPhoneChangedNotice } from '../../common/phone/phone-change-notice';
import { MessagingService } from '../message/messaging.service';
import { recordFullNumberSearch } from '../../common/phone/full-number-search';

/**
 * The only columns PATCH /referrals/:id writes (security AC-1). Not here, on
 * purpose: phoneVerified, type, businessId, city, photo, pause fields,
 * registeredByStaffId, anonymisedAt and every relation (payments, job seekers,
 * ID checks, customer profiles). A phone change needs an OTP on the new number.
 */
export const ALLOWED_REFERRAL_UPDATE_FIELDS: ReadonlySet<string> = new Set([
  'name',
  'phone',
  'whatsappPhone',
  'individualRole',
  'partnerBusinessType',
  'partnerBusinessName',
  'locality',
  'pincode',
  'latitude',
  'longitude',
  'heardFrom',
]);

const INDIVIDUAL_ROLES = ['auto_driver', 'shop_staff', 'shop_owner', 'security_guard', 'existing_worker', 'other'];

function validateReferralValues(updates: Record<string, unknown>) {
  if ('name' in updates && (typeof updates.name !== 'string' || !updates.name.trim())) {
    throw new BadRequestException('Name is required');
  }
  if ('pincode' in updates && !/^\d{6}$/.test(String(updates.pincode ?? ''))) {
    throw new BadRequestException('A valid 6-digit pincode is required');
  }
  if ('heardFrom' in updates && !(HEARD_FROM_VALUES as readonly string[]).includes(updates.heardFrom as string)) {
    throw new BadRequestException('heardFrom must be a supported value');
  }
  if ('individualRole' in updates && updates.individualRole !== null && !INDIVIDUAL_ROLES.includes(updates.individualRole as string)) {
    throw new BadRequestException('A valid individualRole is required for individual partners');
  }
}

@Injectable()
export class ReferralService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idService: IdService,
    private readonly auditService: AuditService,
    private readonly otpService: OtpService,
    private readonly editPolicyService: EditPolicyService,
    @Optional() private readonly messaging?: MessagingService,
  ) {}

  async update(id: string, dto: Record<string, unknown>, actor: EditActor | string) {
    assertNoRawAadhaar(dto);

    let editActor: EditActor;
    if (typeof actor === 'string') {
      const staff = await this.prisma.staff.findUnique({
        where: { id: actor },
        select: { id: true, role: true, teamLeadId: true },
      });
      if (staff) {
        editActor = { id: staff.id, role: staff.role, teamLeadId: staff.teamLeadId };
      } else {
        editActor = { id: actor, role: 'manager' };
      }
    } else {
      editActor = actor;
    }

    const reason = typeof dto.reason === 'string' ? dto.reason : undefined;
    // Security (AC-1): only the partner's own details; status, pause, payouts,
    // who registered him and every linked record have their own routes.
    const updates = pickEditableFields(dto, ALLOWED_REFERRAL_UPDATE_FIELDS, 'referral partner');
    // Saved and compared as +91 and 10 digits, like every other write.
    if (updates.phone !== undefined) updates.phone = requireIndianMobile(updates.phone, 'phone');
    if (updates.whatsappPhone !== undefined) updates.whatsappPhone = requireIndianMobile(updates.whatsappPhone, 'whatsappPhone');
    validateReferralValues(updates);

    const { record, diff } = await this.editPolicyService.assertCanEdit({
      actor: editActor,
      entityType: 'referral',
      entityId: id,
      updates,
      reason,
    });

    if (!diff || !diff.hasChange) {
      return record;
    }

    // Like a job seeker: a new mobile number is checked by OTP on that number.
    let phoneChange: { otpRequestId: string; phone: string } | null = null;
    if (diff.changedFields.includes('phone')) {
      const newPhone = updates.phone as string;
      const otpRequestId = typeof dto.phoneOtpRequestId === 'string' ? dto.phoneOtpRequestId
        : typeof dto.otpRequestId === 'string' ? dto.otpRequestId : null;
      if (!otpRequestId) {
        throw new BadRequestException('Changing the mobile number needs an OTP check on the new number: send an OTP to it and pass phoneOtpRequestId');
      }
      if (!(await this.otpService.isVerified(otpRequestId, newPhone, 'referral'))) {
        throw new BadRequestException('The new mobile number must pass OTP verification before it is saved');
      }
      const taken = await this.prisma.referral.findFirst({
        where: { phone: { in: mobileLookupValues(newPhone) }, id: { not: record.id as string } },
        select: { id: true, code: true },
      });
      if (taken) {
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          message: 'Already registered — open it. A referral partner with this mobile number already exists',
          existingReferralCode: taken.code,
        });
      }
      // D11: a permanently banned phone never comes back through an edit either.
      await assertNotBanned(this.prisma, { phone: newPhone });
      phoneChange = { otpRequestId, phone: newPhone };
    }
    if (phoneChange && !(await this.otpService.consumeVerified(phoneChange.otpRequestId, phoneChange.phone, 'referral'))) {
      throw new BadRequestException('This verified OTP request has already been used or expired');
    }

    const data: Record<string, unknown> = {};
    for (const key of diff.changedFields) {
      data[key] = updates[key];
    }

    const updated = await this.prisma.referral.update({
      where: { id: record.id as string },
      data: phoneChange ? { ...data, phoneVerified: true } : data,
    });
    if (phoneChange) {
      await this.auditService.log({
        actorId: editActor.id,
        action: 'referral.phone_changed',
        entityType: 'referral',
        entityCode: updated.code,
        after: { phoneVerifiedByOtp: true },
        changedFields: ['phoneVerified'],
        reason: reason ?? 'Mobile number changed after OTP on the new number',
        city: updated.city,
      });
      // M3: the old number is told.
      await sendPhoneChangedNotice(this.messaging, { subjectType: 'referral', subjectId: updated.id, code: updated.code, oldPhone: record.phone as string, newPhone: phoneChange.phone });
    }

    await this.editPolicyService.logEdit({
      actorId: editActor.id,
      entityType: 'referral',
      entityCode: record.code as string,
      diff,
      reason,
      city: record.city as string | undefined,
    });

    return updated;
  }

  async create(dto: CreateReferralDto, actorId: string, options: { selfRegisteredByAccountId?: string } = {}) {
    assertNoRawAadhaar(dto);
    // Customer app self-registration: same checks and OTP, no registering agent.
    const auditActorId = options.selfRegisteredByAccountId ? `customer:${options.selfRegisteredByAccountId}` : actorId;

    const submitted = dto as unknown as Record<string, unknown>;
    if (['upiId', 'accountNumber', 'ifsc', 'bankAccount'].some((field) => field in submitted)) {
      throw new BadRequestException('Payout details must be entered by the referral partner through their own link');
    }

    if (!dto.name || typeof dto.name !== 'string' || !dto.name.trim()) {
      throw new BadRequestException('Name is required');
    }

    const typedPhone = (dto.phone ?? dto.mobileNumber)?.trim();
    if (!typedPhone) {
      throw new BadRequestException('Mobile number is required');
    }
    const phone = requireIndianMobile(typedPhone, 'phone');

    const type = dto.type;
    if (!type) throw new BadRequestException("type is required and must be either 'individual' or 'business'");
    if (type !== 'individual' && type !== 'business') {
      throw new BadRequestException("type must be either 'individual' or 'business'");
    }

    if (!dto.whatsappPhone?.trim()) throw new BadRequestException('WhatsApp number is required');
    const whatsappPhone = requireIndianMobile(dto.whatsappPhone, 'whatsappPhone');
    if (!dto.locality?.trim()) throw new BadRequestException('Locality is required');
    if (!/^\d{6}$/.test(dto.pincode ?? '')) throw new BadRequestException('A valid 6-digit pincode is required');
    if (!(HEARD_FROM_VALUES as readonly string[]).includes(dto.heardFrom)) {
      throw new BadRequestException('heardFrom is required and must be a supported value');
    }
    if ((dto.latitude === undefined) !== (dto.longitude === undefined)) {
      throw new BadRequestException('latitude and longitude must be provided together');
    }
    if (type === 'individual' && !INDIVIDUAL_ROLES.includes(dto.individualRole ?? '')) {
      throw new BadRequestException('A valid individualRole is required for individual partners');
    }
    if (type === 'business') {
      if (dto.businessId) {
        const business = await this.prisma.business.findUnique({ where: { id: dto.businessId }, select: { id: true } });
        if (!business) throw new BadRequestException('businessId must reference a registered business');
      } else if (!dto.partnerBusinessType?.trim() || !dto.partnerBusinessName?.trim()) {
        throw new BadRequestException('partnerBusinessType and partnerBusinessName are required for a business partner');
      }
    }

    if (!dto.otpRequestId) {
      throw new BadRequestException('otpRequestId is required: mobile number must pass OTP verification');
    }

    const isVerified = await this.otpService.isVerified(dto.otpRequestId, phone);
    if (!isVerified) {
      throw new BadRequestException('Mobile number must pass OTP verification before registration');
    }

    const existing = await this.prisma.referral.findFirst({
      where: { phone: { in: mobileLookupValues(phone) } },
    });
    if (existing) {
      // Security L1: the 409 tells a staff member the number is ours: a full-number search (audited, 30 an hour).
      if (!options.selfRegisteredByAccountId) {
        await recordFullNumberSearch(this.prisma, this.auditService, { id: actorId }, 'referral_create', phone);
      }
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        message: 'Already registered — open it. A referral partner with this mobile number already exists',
        existingReferralCode: existing.code,
      });
    }

    // D11 (rev 176): a permanently banned phone cannot register again.
    await assertNotBanned(this.prisma, { phone });
    const otpConsumed = await this.otpService.consumeVerified(dto.otpRequestId, phone);
    if (!otpConsumed) {
      throw new BadRequestException('This verified OTP request has already been used or expired');
    }

    const code = await this.idService.generateCode('referral');

    const referral = await this.prisma.referral.create({
      data: {
        code,
        name: dto.name.trim(),
        phone,
        phoneVerified: true,
        type,
        city: dto.city ?? 'Bengaluru',
        whatsappPhone,
        // English only (rev 193): the partner's messages are in English.
        language: PRODUCT_LANGUAGE,
        individualRole: type === 'individual' ? dto.individualRole : null,
        businessId: type === 'business' ? dto.businessId ?? null : null,
        partnerBusinessType: type === 'business' ? dto.partnerBusinessType?.trim() ?? null : null,
        partnerBusinessName: type === 'business' ? dto.partnerBusinessName?.trim() ?? null : null,
        locality: dto.locality.trim(),
        pincode: dto.pincode,
        latitude: dto.latitude ?? null,
        longitude: dto.longitude ?? null,
        heardFrom: dto.heardFrom,
        // Who registered the partner: a Team Lead reads only their team's partners.
        registeredByStaffId: options.selfRegisteredByAccountId ? null : this.registeringStaffId(actorId),
      },
    });

    await this.auditService.log({
      actorId: auditActorId,
      action: 'referral.create',
      entityType: 'referral',
      entityCode: code,
      after: { code, type, phoneVerified: true },
      changedFields: [
        'name', 'phone', 'phoneVerified', 'type', 'whatsappPhone', 'language',
        'individualRole', 'businessId', 'partnerBusinessType', 'partnerBusinessName',
        'locality', 'pincode', 'latitude', 'longitude', 'heardFrom',
      ],
      city: referral.city,
    });

    return referral;
  }

  async findAll(viewer?: { id: string; role: string }) {
    return this.prisma.referral.findMany({
      where: await this.readScope(viewer),
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string, viewer?: { id: string; role: string }) {
    const referral = await this.prisma.referral.findFirst({
      where: { AND: [{ OR: [{ id }, { code: id }] }, await this.readScope(viewer)] },
      include: {
        jobSeekers: true,
        payments: true,
      },
    });
    if (!referral) {
      throw new NotFoundException(`Referral partner '${id}' not found`);
    }
    return referral;
  }

  /**
   * A Team Lead reads only partners registered by their team (themselves and the
   * people who report to them). Partners registered before this was kept have no
   * registering agent and are left to the CEO and Managers. Others as before.
   */
  private async readScope(viewer?: { id: string; role: string }): Promise<Prisma.ReferralWhereInput> {
    if (viewer?.role !== 'team_lead') return {};
    // The same team every Team Lead check uses (OwnTeam).
    return { registeredByStaffId: { in: await new OwnTeam(this.prisma).memberIds(viewer.id) } };
  }

  /** The registering agent: the signed-in staff member (the only caller), never 'system'. */
  private registeringStaffId(actorId: string): string | null {
    return actorId && actorId !== 'system' ? actorId : null;
  }

  /**
   * Pause a partner (CEO only — enforced on the route; guide, Referral
   * partners). A reason is required and the change is audited. While paused,
   * new referrals naming this partner are refused (JobSeekerService.create);
   * payouts already earned are still paid.
   */
  async pause(id: string, actorId: string, reason: unknown) {
    const text = typeof reason === 'string' ? reason.trim() : '';
    if (!text) throw new BadRequestException('A reason is required to pause a partner');
    const partner = await this.prisma.referral.findUnique({ where: { id } });
    if (!partner) throw new NotFoundException(`Referral partner '${id}' not found`);
    if (partner.pausedAt) throw new BadRequestException(`${partner.code} is already paused`);
    const updated = await this.prisma.referral.update({
      where: { id },
      data: { pausedAt: new Date(), pausedByStaffId: actorId, pauseReason: text },
    });
    await this.auditService.log({
      actorId,
      action: 'referral.paused',
      entityType: 'referral',
      entityCode: partner.code,
      before: { pausedAt: null },
      after: { pausedAt: updated.pausedAt?.toISOString(), pauseReason: text },
      reason: text,
    });
    return updated;
  }

  /** Unpause: the partner takes new referrals again. Audited. */
  async unpause(id: string, actorId: string, reason?: unknown) {
    const partner = await this.prisma.referral.findUnique({ where: { id } });
    if (!partner) throw new NotFoundException(`Referral partner '${id}' not found`);
    if (!partner.pausedAt) throw new BadRequestException(`${partner.code} is not paused`);
    const updated = await this.prisma.referral.update({
      where: { id },
      data: { pausedAt: null, pausedByStaffId: null, pauseReason: null },
    });
    const text = typeof reason === 'string' && reason.trim() ? reason.trim() : undefined;
    await this.auditService.log({
      actorId,
      action: 'referral.unpaused',
      entityType: 'referral',
      entityCode: partner.code,
      before: { pausedAt: partner.pausedAt.toISOString(), pauseReason: partner.pauseReason },
      after: { pausedAt: null },
      ...(text ? { reason: text } : {}),
    });
    return updated;
  }
}
