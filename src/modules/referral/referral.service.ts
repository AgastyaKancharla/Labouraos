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

@Injectable()
export class ReferralService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idService: IdService,
    private readonly auditService: AuditService,
    private readonly otpService: OtpService,
  ) {}

  async create(dto: CreateReferralDto, actorId: string) {
    assertNoRawAadhaar(dto);

    if (!dto.name || typeof dto.name !== 'string' || !dto.name.trim()) {
      throw new BadRequestException('Name is required');
    }

    const phone = (dto.phone ?? dto.mobileNumber)?.trim();
    if (!phone) {
      throw new BadRequestException('Mobile number is required');
    }

    const type = dto.type ?? 'individual';
    if (type !== 'individual' && type !== 'business') {
      throw new BadRequestException("type must be either 'individual' or 'business'");
    }

    if (!dto.otpRequestId) {
      throw new BadRequestException('otpRequestId is required: mobile number must pass OTP verification');
    }

    const isVerified = await this.otpService.isVerified(dto.otpRequestId, phone);
    if (!isVerified) {
      throw new BadRequestException('Mobile number must pass OTP verification before registration');
    }

    const existing = await this.prisma.referral.findUnique({
      where: { phone },
    });
    if (existing) {
      throw new ConflictException(`Referral partner with phone '${phone}' already exists`);
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
      },
    });

    await this.auditService.log({
      actorId,
      action: 'referral.create',
      entityType: 'referral',
      entityCode: code,
      after: referral as unknown as Record<string, unknown>,
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
    const referral = await this.prisma.referral.findUnique({
      where: { id },
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
}
