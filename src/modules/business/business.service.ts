import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { AuditService } from '../../common/audit/audit.service';
import { OtpService } from '../../common/otp/otp.service';
import { ReviewFlagService } from '../review-flag/review-flag.service';
import {
  calculateHaversineDistanceMeters,
  DEFAULT_GEOFENCE_RADIUS_METERS,
} from '../../common/geo/geo.util';
import { CreateBusinessDto, RecordVisitDto } from './dto/create-business.dto';
import { assertNoRawAadhaar } from '../job-seeker/job-seeker.validator';
import { BUSINESS_TYPES } from './business.constants';
import { GST_LOOKUP_PROVIDER, GstLookupProvider } from './gst-lookup.provider';
import { BUSINESS_PHOTO_STORAGE, BusinessPhotoStorage } from './storefront-photo.storage';
import { PricingService } from '../pricing/pricing.service';
import { BusinessClock } from './business-clock';
import { BusinessVerificationService } from './business-verification.service';
import { EditPolicyService, EditActor } from '../../common/edit-policy/edit-policy.service';
import { AnonymisationService } from '../../common/anonymisation/anonymisation.service';

@Injectable()
export class BusinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idService: IdService,
    private readonly auditService: AuditService,
    private readonly otpService: OtpService,
    private readonly reviewFlagService: ReviewFlagService,
    private readonly pricingService: PricingService,
    private readonly clock: BusinessClock,
    private readonly verificationService: BusinessVerificationService,
    @Inject(GST_LOOKUP_PROVIDER) private readonly gstLookup: GstLookupProvider,
    @Inject(BUSINESS_PHOTO_STORAGE) private readonly photoStorage: BusinessPhotoStorage,
    private readonly editPolicyService: EditPolicyService,
    private readonly anonymisationService: AnonymisationService,
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

    const { record, diff } = await this.editPolicyService.assertCanEdit({
      actor: editActor,
      entityType: 'business',
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

    const updated = await this.prisma.business.update({
      where: { id: record.id as string },
      data,
    });

    await this.editPolicyService.logEdit({
      actorId: editActor.id,
      entityType: 'business',
      entityCode: record.code as string,
      diff,
      reason,
      city: record.city as string | undefined,
    });

    return updated;
  }

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
      throw new ConflictException('A business with this mobile number already exists');
    }

    const staff = await this.prisma.staff.findUnique({
      where: { id: actorId },
    });
    if (!staff) {
      throw new NotFoundException(`Staff '${actorId}' not found`);
    }

    const businessType = dto.businessType?.trim() || null;
    if (businessType && !(BUSINESS_TYPES as readonly string[]).includes(businessType)) {
      throw new BadRequestException('businessType is not one of the allowed business types');
    }

    const locality = dto.locality?.trim() || null;
    const gstNumber = dto.gstNumber?.trim() || null;
    const registrationNumbers = [gstNumber, dto.licenceNumber, dto.shopEstablishmentNumber, dto.udyamNumber, dto.pan]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value));
    const documentsStatus = registrationNumbers.length > 0 ? 'documented' : 'no_documents';

    let gstLookupData: { gstVerified: boolean; gstLegalName: string | null; gstStatus: string; gstCheckedAt: Date } | null = null;
    if (gstNumber) {
      try {
        const result = await this.gstLookup.lookup(gstNumber);
        gstLookupData = {
          gstVerified: result.verified,
          gstLegalName: result.legalName,
          gstStatus: result.status,
          gstCheckedAt: new Date(),
        };
      } catch {
        gstLookupData = {
          gstVerified: false,
          gstLegalName: null,
          gstStatus: 'lookup_failed',
          gstCheckedAt: new Date(),
        };
      }
    }

    const selfieHash = dto.visit?.selfieHash?.trim() || dto.selfieHash?.trim() || null;
    const selfieUrl = dto.visit?.selfieUrl?.trim() || dto.selfieUrl?.trim() || null;

    if (selfieHash) {
      const duplicateInVisit = await this.prisma.businessVisit.findFirst({
        where: { selfieHash },
      });
      if (duplicateInVisit) {
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
    const city = dto.city?.trim() ?? staff.city ?? 'Bengaluru';
    const policy = await this.pricingService.current();
    const duplicateMatches = await this.findDuplicateMatches({
      name: dto.name.trim(),
      gstNumber,
      licenceNumber: dto.licenceNumber?.trim() || null,
      shopEstablishmentNumber: dto.shopEstablishmentNumber?.trim() || null,
      udyamNumber: dto.udyamNumber?.trim() || null,
      photoHash: null,
      latitude: typeof businessLat === 'number' ? businessLat : (typeof visitLat === 'number' ? visitLat : null),
      longitude: typeof businessLon === 'number' ? businessLon : (typeof visitLon === 'number' ? visitLon : null),
      duplicateRadiusMeters: policy.duplicateBusinessRadiusMeters,
    });

    const otpConsumed = await this.otpService.consumeVerified(dto.otpRequestId, phone);
    if (!otpConsumed) {
      throw new BadRequestException('This verified OTP request has already been used or expired');
    }

    const business = await this.prisma.business.create({
      data: {
        code,
        name: dto.name.trim(),
        address: dto.address?.trim() ?? null,
        phone,
        phoneVerified: true,
        city,
        legalName: dto.legalName?.trim() || null,
        ownerName: dto.ownerName?.trim() || null,
        additionalContactName: dto.additionalContactName?.trim() || dto.contactPerson?.trim() || null,
        additionalContactPhone: dto.additionalContactPhone?.trim() || null,
        businessType,
        employeeCount: dto.employeeCount ?? null,
        staffNeeded: dto.staffNeeded ?? [],
        licenceNumber: dto.licenceNumber?.trim() || null,
        shopEstablishmentNumber: dto.shopEstablishmentNumber?.trim() || null,
        udyamNumber: dto.udyamNumber?.trim() || null,
        pan: dto.pan?.trim() || null,
        gstNumber,
        ...(gstLookupData ?? { gstVerified: null, gstLegalName: null, gstStatus: null, gstCheckedAt: null }),
        yearsInOperation: dto.yearsInOperation ?? null,
        hiringFrequency: dto.hiringFrequency?.trim() || null,
        billingName: dto.billingName?.trim() || null,
        billingAddress: dto.billingAddress?.trim() || null,
        documentsStatus,
        verificationStatus: 'lead',
        leadCreatedByStaffId: staff.id,
        leadChannel: staff.role === 'field_agent' ? 'field_visit' : 'phone_call',
        locality,
        latitude: typeof businessLat === 'number' ? businessLat : (typeof visitLat === 'number' ? visitLat : null),
        longitude: typeof businessLon === 'number' ? businessLon : (typeof visitLon === 'number' ? visitLon : null),
        geofenceFlag,
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

    if (geofenceFlag) {
      await this.reviewFlagService.raise({
        kind: 'gps_mismatch',
        subjectType: 'business',
        subjectId: business.id,
        raisedForStaffId: staff.id,
        details: {
          businessCode: business.code,
          businessLat,
          businessLon,
          visitLat,
          visitLon,
        },
      });
    }

    for (const [matchedBusinessId, matchTypes] of duplicateMatches) {
      await this.raiseDuplicateFlag(business.id, staff.id, matchedBusinessId, [...matchTypes]);
    }

    await this.auditService.log({
      actorId: staff.id,
      action: 'business.created',
      entityType: 'business',
      entityCode: business.code,
      after: {
        businessType: business.businessType,
        documentsStatus: business.documentsStatus,
        verificationStatus: business.verificationStatus,
        leadChannel: business.leadChannel,
        leadCreatedByStaffId: business.leadCreatedByStaffId,
        gstVerified: business.gstVerified,
        gstStatus: business.gstStatus,
        ...(geofenceFlag ? { flags: ['GEOFENCE_MISMATCH'] } : {}),
      },
      changedFields: [
        'businessType',
        'documentsStatus',
        'verificationStatus',
        'leadChannel',
        'leadCreatedByStaffId',
        'gstVerified',
        'gstStatus',
        'locality',
      ],
      city: business.city,
    });

    return business;
  }

  async uploadStorefrontPhoto(businessId: string, photo: Buffer, contentType: string, actorId: string) {
    const extensions: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
    };
    const extension = extensions[contentType];
    if (!extension || photo.length === 0) {
      throw new BadRequestException('Upload a non-empty JPEG, PNG or WebP storefront photo');
    }
    const business = await this.prisma.business.findUnique({ where: { id: businessId } });
    if (!business) throw new NotFoundException(`Business '${businessId}' not found`);
    const actor = await this.prisma.staff.findUnique({ where: { id: actorId } });
    if (!actor) throw new NotFoundException(`Staff '${actorId}' not found`);

    const photoHash = createHash('sha256').update(photo).digest('hex');
    const photoPath = `businesses/${business.id}/storefront/${photoHash}.${extension}`;
    await this.photoStorage.put(photoPath, photo, contentType);
    const updated = await this.prisma.business.update({
      where: { id: business.id },
      data: { storefrontPhotoPath: photoPath, storefrontPhotoHash: photoHash, storefrontPhotoLive: false },
    });

    const policy = await this.pricingService.current();
    const duplicates = await this.findDuplicateMatches({
      name: business.name,
      gstNumber: null,
      licenceNumber: null,
      shopEstablishmentNumber: null,
      udyamNumber: null,
      photoHash,
      latitude: business.latitude,
      longitude: business.longitude,
      duplicateRadiusMeters: policy.duplicateBusinessRadiusMeters,
      excludeBusinessId: business.id,
    });
    for (const [matchedBusinessId, matchTypes] of duplicates) {
      await this.raiseDuplicateFlag(business.id, actor.id, matchedBusinessId, [...matchTypes]);
    }

    await this.auditService.log({
      actorId,
      action: 'business.storefront_photo_uploaded',
      entityType: 'business',
      entityCode: business.code,
      before: { storefrontPhotoPath: business.storefrontPhotoPath, storefrontPhotoHash: business.storefrontPhotoHash },
      after: { storefrontPhotoPath: photoPath, storefrontPhotoHash: photoHash, storefrontPhotoLive: false },
      changedFields: ['storefrontPhotoPath', 'storefrontPhotoHash', 'storefrontPhotoLive'],
      city: business.city,
    });
    return updated;
  }

  private async findDuplicateMatches(input: {
    name: string;
    gstNumber: string | null;
    licenceNumber: string | null;
    shopEstablishmentNumber: string | null;
    udyamNumber: string | null;
    photoHash: string | null;
    latitude: number | null;
    longitude: number | null;
    duplicateRadiusMeters: number;
    excludeBusinessId?: string;
  }) {
    const candidates = await this.prisma.business.findMany({
      where: { id: input.excludeBusinessId ? { not: input.excludeBusinessId } : undefined },
      select: {
        id: true,
        code: true,
        name: true,
        gstNumber: true,
        licenceNumber: true,
        shopEstablishmentNumber: true,
        udyamNumber: true,
        storefrontPhotoHash: true,
        latitude: true,
        longitude: true,
      },
    });
    const matches = new Map<string, Set<string>>();
    const add = (id: string, matchType: string) => {
      const reasons = matches.get(id) ?? new Set<string>();
      reasons.add(matchType);
      matches.set(id, reasons);
    };
    const normalize = (value: string | null | undefined) => value?.replace(/\s+/g, '').toUpperCase() ?? '';
    const comparisons = [
      ['gstNumber', input.gstNumber, 'gst_number'],
      ['licenceNumber', input.licenceNumber, 'licence_number'],
      ['shopEstablishmentNumber', input.shopEstablishmentNumber, 'shop_establishment_number'],
      ['udyamNumber', input.udyamNumber, 'udyam_number'],
      ['storefrontPhotoHash', input.photoHash, 'storefront_photo_hash'],
    ] as const;
    for (const candidate of candidates) {
      for (const [field, value, reason] of comparisons) {
        if (value && normalize(candidate[field]) === normalize(value)) add(candidate.id, reason);
      }
      const existingName = candidate.name.toLowerCase().replace(/\s+/g, '');
      const incomingName = input.name.toLowerCase().replace(/\s+/g, '');
      if (
        existingName && incomingName &&
        (existingName.includes(incomingName) || incomingName.includes(existingName)) &&
        input.latitude !== null && input.longitude !== null &&
        candidate.latitude !== null && candidate.longitude !== null &&
        calculateHaversineDistanceMeters(input.latitude, input.longitude, candidate.latitude, candidate.longitude) <= input.duplicateRadiusMeters
      ) {
        add(candidate.id, 'similar_name_nearby');
      }
    }
    return matches;
  }

  private async raiseDuplicateFlag(businessId: string, actorId: string, matchedBusinessId: string, matchTypes: string[]) {
    const matched = await this.prisma.business.findUnique({ where: { id: matchedBusinessId }, select: { code: true } });
    if (!matched) return;
    const flag = await this.reviewFlagService.raise({
      kind: 'duplicate_business',
      subjectType: 'business',
      subjectId: businessId,
      raisedForStaffId: actorId,
      details: { matchedBusinessCode: matched.code, matchTypes },
    });
    await this.auditService.log({
      actorId,
      action: 'business.duplicate_flag_raised',
      entityType: 'review_flag',
      entityCode: flag.code,
      after: { kind: 'duplicate_business', matchedBusinessCode: matched.code, matchTypes },
      changedFields: ['kind', 'matchedBusinessCode', 'matchTypes'],
    });
  }

  async findAll(actorId: string) {
    const staff = await this.prisma.staff.findUnique({
      where: { id: actorId },
    });
    if (!staff) {
      throw new NotFoundException(`Staff '${actorId}' not found`);
    }

    const where: Prisma.BusinessWhereInput = {};
    if (staff.role === 'team_lead') {
      const team = await this.prisma.staff.findMany({
        where: { teamLeadId: staff.id },
        select: { id: true },
      });
      const teamIds = team.map(({ id }) => id);
      where.OR = [
        { accountAgentId: { in: teamIds } },
        { leadCreatedByStaffId: { in: teamIds } },
      ];
    }

    return this.prisma.business.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { vacancies: true },
    });
  }

  async findById(id: string) {
    let business = await this.prisma.business.findUnique({
      where: { id },
      include: { vacancies: true, visits: true, agreements: { select: { signedAt: true } } },
    });
    if (!business) {
      business = await this.prisma.business.findUnique({
        where: { code: id },
        include: { vacancies: true, visits: true, agreements: { select: { signedAt: true } } },
      });
    }
    if (!business) {
      throw new NotFoundException(`Business '${id}' not found`);
    }
    const accountAgent = business.accountAgentId
      ? await this.prisma.staff.findUnique({ where: { id: business.accountAgentId }, select: { id: true, code: true, name: true } })
      : null;
    return { ...business, accountAgentSummary: accountAgent };
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

    const selfieHash = dto.selfieHash?.trim() || null;
    const selfieUrl = dto.selfieUrl?.trim() || null;
    const assignment = dto.assignmentId
      ? await this.prisma.visitAssignment.findUnique({ where: { id: dto.assignmentId } })
      : null;
    if (dto.assignmentId && !assignment) throw new NotFoundException('Visit assignment not found');
    if (assignment) {
      if (
        assignment.businessId !== business.id ||
        assignment.assignedStaffId !== staff.id ||
        assignment.status !== 'assigned'
      ) {
        throw new ForbiddenException('Only the assigned field agent can complete an open visit assignment');
      }
    }
    if (staff.role === 'field_agent') {
      const accountAgent = business.accountAgentId === staff.id;
      const leadCreatedByAgent =
        business.leadCreatedByStaffId === staff.id &&
        ['lead', 'pending_visit'].includes(business.verificationStatus ?? '');
      const assignedOpenVisit =
        assignment?.assignedStaffId === staff.id && assignment.status === 'assigned';
      if (!accountAgent && !leadCreatedByAgent && !assignedOpenVisit) {
        throw new ForbiddenException('Field agents may only write their account businesses, own open visits, or own active leads');
      }
    }
    const purpose = assignment?.purpose ?? dto.purpose ?? 'follow_up';
    if (purpose === 'verification') {
      if (!assignment) throw new BadRequestException('A verification visit requires its assigned visit assignment');
      if (!selfieUrl || !selfieHash) {
        throw new BadRequestException('A verification visit requires the visit photo and its hash');
      }
      if (!dto.ownerOtpRequestId || !dto.ownerOtpCode) {
        throw new BadRequestException('Owner presence OTP is required for a verification visit');
      }
      const otpValid = await this.otpService.verifyOtp(dto.ownerOtpRequestId, dto.ownerOtpCode);
      const otpBelongsToOwner = otpValid
        ? await this.otpService.isVerified(dto.ownerOtpRequestId, business.phone)
        : false;
      if (!otpBelongsToOwner) {
        throw new BadRequestException('Valid owner presence OTP is required for a verification visit');
      }
    }

    if (selfieHash) {
      const duplicateInVisit = await this.prisma.businessVisit.findFirst({
        where: {
          selfieHash,
          businessId: { not: business.id },
        },
      });
      if (duplicateInVisit) {
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

    const visitedAt = dto.visitedAt ? new Date(dto.visitedAt) : this.clock.now();
    const visit = await this.prisma.$transaction(async (tx) => {
      const created = await tx.businessVisit.create({
        data: {
          businessId: business.id,
          staffId: staff.id,
          latitude: dto.latitude,
          longitude: dto.longitude,
          selfieUrl,
          selfieHash,
          geofenceFlag,
          purpose,
          ownerOtpRequestId: purpose === 'verification' ? dto.ownerOtpRequestId : null,
          photoLive: false,
          assignmentId: assignment?.id ?? null,
          visitedAt,
        },
      });
      if (assignment) {
        const completed = await tx.visitAssignment.updateMany({
          where: {
            id: assignment.id,
            assignedStaffId: staff.id,
            status: 'assigned',
          },
          data: { status: 'done', visitId: created.id },
        });
        if (completed.count !== 1) {
          throw new ForbiddenException('Only the assigned field agent can complete an open visit assignment');
        }
        if (assignment.purpose === 'interview_attendance' && assignment.relatedType === 'interview' && assignment.relatedId) {
          await tx.interview.update({
            where: { id: assignment.relatedId },
            data: { attendanceVisitId: created.id },
          });
        }
      }
      if (geofenceFlag && !business.geofenceFlag) {
        await tx.business.update({
          where: { id: business.id },
          data: { geofenceFlag: true },
        });
      }
      return created;
    });

    await this.auditService.log({
      actorId: staff.id,
      action: 'business.visit_recorded',
      entityType: 'business_visit',
      entityCode: visit.id,
      after: {
        businessId: business.id,
        purpose,
        assignmentId: assignment?.id ?? null,
        ownerOtpRequestId: purpose === 'verification' ? dto.ownerOtpRequestId : null,
        geofenceFlag,
        photoLive: false,
        assignmentStatus: assignment ? 'done' : null,
      },
      changedFields: ['latitude', 'longitude', 'selfieUrl', 'selfieHash', 'purpose', 'assignmentId', 'assignmentStatus'],
      reason: geofenceFlag ? 'Visit recorded with a geofence mismatch for review' : 'Business visit recorded',
      city: business.city,
    });

    if (purpose === 'verification') {
      await this.verificationService.advanceToPendingTlCheckIfReady(business.id, staff.id);
    }

    return visit;
  }

  async erase(id: string, actorId: string) {
    const actor = await this.prisma.staff.findUnique({
      where: { id: actorId },
    });
    if (!actor) {
      throw new NotFoundException(`Staff '${actorId}' not found`);
    }

    const res = await this.anonymisationService.anonymise(
      'business',
      id,
      'DPDP erasure request',
      actorId,
    );
    if (res.message.includes('already')) {
      return {
        message: 'Business already erased',
        id: res.id,
        code: res.code,
        anonymisedAt: res.anonymisedAt,
      };
    }

    return this.prisma.business.findUniqueOrThrow({
      where: { id: res.id },
    });
  }
}

