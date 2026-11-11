import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { AuditService } from '../../common/audit/audit.service';
import { OtpService } from '../../common/otp/otp.service';
import { CreateReferralDto } from './dto/create-referral.dto';
import { assertNoRawAadhaar } from '../job-seeker/job-seeker.validator';
import { EditPolicyService, EditActor } from '../../common/edit-policy/edit-policy.service';
import { mobileLookupValues, requireIndianMobile } from '../../common/phone/indian-mobile';

@Injectable()
export class ReferralService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idService: IdService,
    private readonly auditService: AuditService,
    private readonly otpService: OtpService,
    private readonly editPolicyService: EditPolicyService,
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
    // Saved and compared as +91 and 10 digits, like every other write.
    if (dto.phone !== undefined) dto.phone = requireIndianMobile(dto.phone, 'phone');
    if (dto.whatsappPhone !== undefined) dto.whatsappPhone = requireIndianMobile(dto.whatsappPhone, 'whatsappPhone');

    const { record, diff } = await this.editPolicyService.assertCanEdit({
      actor: editActor,
      entityType: 'referral',
      entityId: id,
      updates: dto,
      reason,
    });

    if (!diff || !diff.hasChange) {
      return record;
    }

    const data: Record<string, unknown> = {};
    for (const key of diff.changedFields) {
      data[key] = dto[key];
    }

    const updated = await this.prisma.referral.update({
      where: { id: record.id as string },
      data,
    });

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

  async create(dto: CreateReferralDto, actorId: string) {
    assertNoRawAadhaar(dto);

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

    if (!['kn', 'hi', 'en'].includes(dto.language)) throw new BadRequestException('language must be kn, hi, or en');
    if (!dto.whatsappPhone?.trim()) throw new BadRequestException('WhatsApp number is required');
    const whatsappPhone = requireIndianMobile(dto.whatsappPhone, 'whatsappPhone');
    if (!dto.locality?.trim()) throw new BadRequestException('Locality is required');
    if (!/^\d{6}$/.test(dto.pincode ?? '')) throw new BadRequestException('A valid 6-digit pincode is required');
    if (!['toll_free_missed_call', 'ad', 'referral_partner', 'field_visit', 'social_media', 'walk_in', 'other'].includes(dto.heardFrom)) {
      throw new BadRequestException('heardFrom is required and must be a supported value');
    }
    if ((dto.latitude === undefined) !== (dto.longitude === undefined)) {
      throw new BadRequestException('latitude and longitude must be provided together');
    }
    const individualRoles = ['auto_driver', 'shop_staff', 'shop_owner', 'security_guard', 'existing_worker', 'other'];
    if (type === 'individual' && !individualRoles.includes(dto.individualRole ?? '')) {
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
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        message: 'Already registered — open it. A referral partner with this mobile number already exists',
        existingReferralCode: existing.code,
      });
    }

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
        language: dto.language,
        individualRole: type === 'individual' ? dto.individualRole : null,
        businessId: type === 'business' ? dto.businessId ?? null : null,
        partnerBusinessType: type === 'business' ? dto.partnerBusinessType?.trim() ?? null : null,
        partnerBusinessName: type === 'business' ? dto.partnerBusinessName?.trim() ?? null : null,
        locality: dto.locality.trim(),
        pincode: dto.pincode,
        latitude: dto.latitude ?? null,
        longitude: dto.longitude ?? null,
        heardFrom: dto.heardFrom,
      },
    });

    await this.auditService.log({
      actorId,
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

  async findAll() {
    return this.prisma.referral.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    let referral = await this.prisma.referral.findUnique({
      where: { id },
      include: {
        jobSeekers: true,
        payments: true,
      },
    });
    if (!referral) {
      referral = await this.prisma.referral.findUnique({
        where: { code: id },
        include: {
          jobSeekers: true,
          payments: true,
        },
      });
    }
    if (!referral) {
      throw new NotFoundException(`Referral partner '${id}' not found`);
    }
    return referral;
  }
}
