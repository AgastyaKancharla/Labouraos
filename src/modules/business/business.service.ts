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
import {
  calculateHaversineDistanceMeters,
  DEFAULT_GEOFENCE_RADIUS_METERS,
} from '../../common/geo/geo.util';
import { CreateBusinessDto, RecordVisitDto } from './dto/create-business.dto';
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

    const selfieHash = dto.visit?.selfieHash?.trim() || dto.selfieHash?.trim() || null;
    const selfieUrl = dto.visit?.selfieUrl?.trim() || dto.selfieUrl?.trim() || null;

    if (selfieHash) {
      const duplicateInBusiness = await this.prisma.business.findFirst({
        where: { selfieHash },
      });
      const duplicateInVisit = await this.prisma.businessVisit.findFirst({
        where: { selfieHash },
      });
      if (duplicateInBusiness || duplicateInVisit) {
        throw new BadRequestException(
          'Duplicate selfie detected: image hash already used for another business record',
        );
      }
    }

    const businessLat = dto.businessLatitude ?? (dto.visit || dto.visitLatitude !== undefined ? dto.latitude : dto.latitude);
    const businessLon = dto.businessLongitude ?? (dto.visit || dto.visitLongitude !== undefined ? dto.longitude : dto.longitude);

    const visitLat = dto.visit?.latitude ?? dto.visitLatitude ?? (dto.businessLatitude !== undefined ? dto.latitude : undefined);
    const visitLon = dto.visit?.longitude ?? dto.visitLongitude ?? (dto.businessLongitude !== undefined ? dto.longitude : undefined);

    let geofenceFlag = false;
    const radiusMeters =
      Number(process.env.GEOFENCE_RADIUS_METERS) || DEFAULT_GEOFENCE_RADIUS_METERS;

    if (
      typeof businessLat === 'number' &&
      typeof businessLon === 'number' &&
      typeof visitLat === 'number' &&
      typeof visitLon === 'number'
    ) {
      const distance = calculateHaversineDistanceMeters(
        businessLat,
        businessLon,
        visitLat,
        visitLon,
      );
      if (distance > radiusMeters) {
        geofenceFlag = true;
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
        latitude: typeof businessLat === 'number' ? businessLat : (typeof visitLat === 'number' ? visitLat : null),
        longitude: typeof businessLon === 'number' ? businessLon : (typeof visitLon === 'number' ? visitLon : null),
        geofenceFlag,
        selfieUrl,
        selfieHash,
      },
    });

    if (
      (visitLat !== undefined && visitLon !== undefined) ||
      selfieUrl ||
      selfieHash ||
      dto.visit
    ) {
      await this.prisma.businessVisit.create({
        data: {
          businessId: business.id,
          staffId: staff.id,
          latitude: typeof visitLat === 'number' ? visitLat : (business.latitude ?? 0),
          longitude: typeof visitLon === 'number' ? visitLon : (business.longitude ?? 0),
          selfieUrl,
          selfieHash,
          geofenceFlag,
          visitedAt: dto.visit?.visitedAt
            ? new Date(dto.visit.visitedAt)
            : (dto.visitedAt ? new Date(dto.visitedAt) : new Date()),
        },
      });
    }

    await this.auditService.log({
      actorId: staff.id,
      action: 'business.created',
      entityType: 'business',
      entityCode: business.code,
      after: {
        ...business,
        ...(geofenceFlag ? { flags: ['GEOFENCE_MISMATCH'] } : {}),
      } as unknown as Record<string, unknown>,
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
      include: { vacancies: true, visits: true },
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

  async recordVisit(businessId: string, dto: RecordVisitDto, actorId: string) {
    if (typeof dto.latitude !== 'number' || typeof dto.longitude !== 'number') {
      throw new BadRequestException('latitude and longitude are required for visit record');
    }

    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
    });
    if (!business) {
      throw new NotFoundException(`Business '${businessId}' not found`);
    }

    const staff = await this.prisma.staff.findUnique({
      where: { id: actorId },
    });
    if (!staff) {
      throw new NotFoundException(`Staff '${actorId}' not found`);
    }

    if (staff.role === 'field_agent' && business.area !== staff.area) {
      throw new ForbiddenException(
        `Access denied: business is in area '${business.area}', not your area '${staff.area}'`,
      );
    }

    const selfieHash = dto.selfieHash?.trim() || null;
    const selfieUrl = dto.selfieUrl?.trim() || null;

    if (selfieHash) {
      const duplicateInBusiness = await this.prisma.business.findFirst({
        where: {
          selfieHash,
          id: { not: business.id },
        },
      });
      const duplicateInVisit = await this.prisma.businessVisit.findFirst({
        where: {
          selfieHash,
          businessId: { not: business.id },
        },
      });
      if (duplicateInBusiness || duplicateInVisit) {
        throw new BadRequestException(
          'Duplicate selfie detected: image hash already used for another business record',
        );
      }
    }

    let geofenceFlag = false;
    const radiusMeters =
      Number(process.env.GEOFENCE_RADIUS_METERS) || DEFAULT_GEOFENCE_RADIUS_METERS;

    if (
      typeof business.latitude === 'number' &&
      typeof business.longitude === 'number'
    ) {
      const distance = calculateHaversineDistanceMeters(
        business.latitude,
        business.longitude,
        dto.latitude,
        dto.longitude,
      );
      if (distance > radiusMeters) {
        geofenceFlag = true;
      }
    }

    const visit = await this.prisma.businessVisit.create({
      data: {
        businessId: business.id,
        staffId: staff.id,
        latitude: dto.latitude,
        longitude: dto.longitude,
        selfieUrl,
        selfieHash,
        geofenceFlag,
        visitedAt: dto.visitedAt ? new Date(dto.visitedAt) : new Date(),
      },
    });

    if (geofenceFlag && !business.geofenceFlag) {
      await this.prisma.business.update({
        where: { id: business.id },
        data: { geofenceFlag: true },
      });
    }

    await this.auditService.log({
      actorId: staff.id,
      action: 'business.visit_recorded',
      entityType: 'business_visit',
      entityCode: visit.id,
      after: {
        ...visit,
        ...(geofenceFlag ? { flags: ['GEOFENCE_MISMATCH'] } : {}),
      } as unknown as Record<string, unknown>,
      city: business.city,
    });

    return visit;
  }

  async erase(id: string, actorId: string) {
    const actor = await this.prisma.staff.findUnique({
      where: { id: actorId },
    });
    if (!actor) {
      throw new NotFoundException(`Staff '${actorId}' not found`);
    }

    const business = await this.prisma.business.findUnique({
      where: { id },
    });
    if (!business) {
      throw new NotFoundException(`Business '${id}' not found`);
    }

    // Idempotent: safe no-op if already erased
    if (business.erasedAt) {
      return {
        message: 'Business already erased',
        id: business.id,
        code: business.code,
        erasedAt: business.erasedAt,
      };
    }

    const beforeState = {
      name: business.name,
      phone: business.phone,
      contactName: business.contactName,
      address: business.address,
      gstNumber: business.gstNumber,
    };

    const updated = await this.prisma.business.update({
      where: { id: business.id },
      data: {
        name: 'ANONYMIZED_BUSINESS',
        phone: `ERASED-${business.code}`,
        contactName: 'Anonymized Contact',
        address: 'Anonymized Address',
        gstNumber: null,
        selfieUrl: null,
        selfieHash: null,
        erasedAt: new Date(),
      },
    });

    await this.auditService.log({
      action: 'dpdp.erasure_requested',
      entityType: 'business',
      entityCode: business.code,
      actorId: actor.id,
      city: business.city,
      before: beforeState,
      after: {
        name: updated.name,
        phone: updated.phone,
        contactName: updated.contactName,
        address: updated.address,
        gstNumber: updated.gstNumber,
        erasedAt: updated.erasedAt,
      },
    });

    return updated;
  }
}

