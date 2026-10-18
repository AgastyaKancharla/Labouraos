import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { AuditService } from '../../common/audit/audit.service';
import { OtpService } from '../../common/otp/otp.service';
import { CreateBusinessDto } from './dto/create-business.dto';
import { assertNoRawAadhaar } from '../job-seeker/job-seeker.validator';

@Injectable()
export class BusinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idService: IdService,
    private readonly auditService: AuditService,
    private readonly otpService: OtpService,
  ) {}

  async create(dto: CreateBusinessDto, actorId: string) {
    assertNoRawAadhaar(dto);

    if (!dto.name || typeof dto.name !== 'string' || !dto.name.trim()) {
      throw new BadRequestException('Name is required');
    }

    const phone = (dto.phone ?? dto.mobileNumber)?.trim();
    if (!phone) {
      throw new BadRequestException('Mobile number is required');
    }

    if (!dto.otpRequestId) {
      throw new BadRequestException(
        'otpRequestId is required: mobile number must pass OTP verification',
      );
    }

    const isVerified = await this.otpService.isVerified(dto.otpRequestId, phone);
    if (!isVerified) {
      throw new BadRequestException(
        'Mobile number must pass OTP verification before registration',
      );
    }

    const existing = await this.prisma.business.findUnique({
      where: { phone },
    });
    if (existing) {
      throw new ConflictException(`Business with phone '${phone}' already exists`);
    }

    const staff = await this.prisma.staff.findUnique({
      where: { id: actorId },
    });
    if (!staff) {
      throw new NotFoundException(`Staff '${actorId}' not found`);
    }

    let area = dto.area?.trim();
    if (staff.role === 'field_agent') {
      if (!staff.area) {
        throw new ForbiddenException('Field agent does not have an assigned area');
      }
      if (area && area !== staff.area) {
        throw new ForbiddenException(
          `Access denied: field agent is restricted to area '${staff.area}' and cannot set area '${area}'`,
        );
      }
      area = staff.area;
    } else {
      if (!area) {
        throw new BadRequestException('area is required');
      }
    }

    const code = await this.idService.generateCode('business');
    const contactName = (dto.contactPerson ?? dto.contactName)?.trim() ?? null;
    const city = dto.city?.trim() ?? staff.city ?? 'Bengaluru';

    const business = await this.prisma.business.create({
      data: {
        code,
        name: dto.name.trim(),
        address: dto.address?.trim() ?? null,
        contactName,
        phone,
        phoneVerified: true,
        area,
        city,
        gstNumber: dto.gstNumber?.trim() ?? null,
        latitude: typeof dto.latitude === 'number' ? dto.latitude : null,
        longitude: typeof dto.longitude === 'number' ? dto.longitude : null,
      },
    });

    await this.auditService.log({
      actorId: staff.id,
      action: 'business.created',
      entityType: 'business',
      entityCode: business.code,
      after: business as unknown as Record<string, unknown>,
      city: business.city,
    });

    return business;
  }

  async findAll(actorId: string, filterArea?: string) {
    const staff = await this.prisma.staff.findUnique({
      where: { id: actorId },
    });
    if (!staff) {
      throw new NotFoundException(`Staff '${actorId}' not found`);
    }

    const where: Prisma.BusinessWhereInput = {};
    if (staff.role === 'field_agent') {
      where.area = staff.area ?? undefined;
      where.city = staff.city;
    } else if (filterArea) {
      where.area = filterArea;
    }

    return this.prisma.business.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { vacancies: true },
    });
  }

  async findById(id: string, actorId: string) {
    const business = await this.prisma.business.findUnique({
      where: { id },
      include: { vacancies: true },
    });
    if (!business) {
      throw new NotFoundException(`Business '${id}' not found`);
    }

    const staff = await this.prisma.staff.findUnique({
      where: { id: actorId },
    });
    if (staff?.role === 'field_agent' && business.area !== staff.area) {
      throw new ForbiddenException(
        `Access denied: business is in area '${business.area}', not your area '${staff.area}'`,
      );
    }

    return business;
  }
}
