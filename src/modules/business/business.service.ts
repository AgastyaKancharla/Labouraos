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
import {
  BUSINESS_CONTACT_ROLES,
  BUSINESS_MESSAGE_LANGUAGES,
  BUSINESS_TYPES,
  EMPLOYEE_COUNT_BANDS,
  HIRING_FREQUENCIES,
  YEARS_RUNNING_BANDS,
} from './business.constants';
import { HEARD_FROM_VALUES } from '../job-seeker/job-seeker.validator';
import { TradeService } from '../trade/trade.service';
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
    private readonly tradeService: TradeService,
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

    const contactName = (dto.contactPersonName ?? dto.additionalContactName ?? dto.contactPerson ?? dto.ownerName)?.trim();
    if (!contactName) throw new BadRequestException('Contact person name is required');
    if (!dto.contactPersonRole || !(BUSINESS_CONTACT_ROLES as readonly string[]).includes(dto.contactPersonRole)) {
      throw new BadRequestException('Contact person role must be owner, manager, hr, supervisor or other');
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

    const isHousehold = businessType === 'household';
    if (isHousehold && !dto.familyName?.trim()) {
      throw new BadRequestException('Household businesses require a familyName');
    }
    this.assertOptionalValue(dto.employeeCountBand, EMPLOYEE_COUNT_BANDS, 'employeeCountBand');
    this.assertOptionalValue(dto.yearsInOperationBand, YEARS_RUNNING_BANDS, 'yearsInOperationBand');
    this.assertOptionalValue(dto.hiringFrequency, HIRING_FREQUENCIES, 'hiringFrequency');
    this.assertOptionalValue(dto.heardFrom, HEARD_FROM_VALUES, 'heardFrom');
    this.assertOptionalValue(dto.contactLanguage, BUSINESS_MESSAGE_LANGUAGES, 'contactLanguage');
    this.assertOptionalTime(dto.openingTime, 'openingTime');
    this.assertOptionalTime(dto.closingTime, 'closingTime');
    this.assertOptionalPincode(dto.pincode);
    this.assertOptionalEmail(dto.billingEmail);
    this.assertWorkingDays(dto.workingDays);

    const suppliedDocuments = [
      dto.gstNumber, dto.licenceNumber, dto.shopEstablishmentNumber, dto.udyamNumber, dto.pan, dto.fssaiNumber,
    ];
    if ((isHousehold || dto.noDocuments === true) && suppliedDocuments.some((value) => value?.trim())) {
      throw new BadRequestException(isHousehold
        ? 'Household businesses cannot provide GST or licence documents'
        : 'A no-documents business cannot include GST or licence numbers');
    }

    const branchNames = new Set<string>();
    const seenPhones = new Set<string>([phoneDigits(phone)]);
    const seenOtps = new Set<string>([dto.otpRequestId]);
    for (const branch of dto.branches ?? []) {
      if (!branch.name?.trim() || !branch.contactPersonName?.trim() ||
          !(BUSINESS_CONTACT_ROLES as readonly string[]).includes(branch.contactPersonRole) ||
          !branch.contactPersonPhone?.trim() || !branch.otpRequestId) {
        throw new BadRequestException('Each branch requires a name, contact name, role and OTP-verified mobile');
      }
      this.assertOptionalValue(branch.contactLanguage, BUSINESS_MESSAGE_LANGUAGES, 'contactLanguage');
      this.assertOptionalPincode(branch.pincode);
      const branchPhone = phoneDigits(branch.contactPersonPhone);
      if (seenPhones.has(branchPhone)) throw new BadRequestException('Each contact mobile must be different');
      seenPhones.add(branchPhone);
      if (seenOtps.has(branch.otpRequestId)) throw new BadRequestException('Each contact needs its own verified OTP');
      seenOtps.add(branch.otpRequestId);
      if (branchNames.has(branch.name.trim())) throw new BadRequestException('Branch names must be unique on one business');
      branchNames.add(branch.name.trim());
      if (!(await this.otpService.isVerified(branch.otpRequestId, branch.contactPersonPhone.trim()))) {
        throw new BadRequestException('Branch contact mobile must pass OTP verification');
      }
    }
    for (const row of dto.staffNeededRows ?? []) {
      if (!row.trade?.trim() || !Number.isSafeInteger(row.headcount) || row.headcount < 1 ||
          !Number.isSafeInteger(row.salaryMinPaise) || row.salaryMinPaise <= 0 ||
          !Number.isSafeInteger(row.salaryMaxPaise) || row.salaryMaxPaise < row.salaryMinPaise ||
          !row.shift?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(row.startDate ?? '') ||
          !Number.isFinite(new Date(`${row.startDate}T00:00:00.000Z`).getTime())) {
        throw new BadRequestException('Each staff-needed row requires trade, headcount, salary range, shift and valid start date');
      }
      if (row.salaryPeriod && row.salaryPeriod !== 'monthly' && row.salaryPeriod !== 'daily') {
        throw new BadRequestException('salaryPeriod must be monthly or daily');
      }
      if (row.branchName?.trim() && !branchNames.has(row.branchName.trim())) {
        throw new BadRequestException('staff-needed branchName must match a branch in this registration');
      }
    }

    const locality = dto.locality?.trim() || null;
    const hideDocuments = isHousehold || dto.noDocuments === true;
    const gstNumber = hideDocuments ? null : (dto.gstNumber?.trim() || null);
    const registrationNumbers = hideDocuments ? [] : [
      gstNumber, dto.licenceNumber, dto.shopEstablishmentNumber, dto.udyamNumber, dto.pan, dto.fssaiNumber,
    ].map((value) => value?.trim()).filter((value): value is string => Boolean(value));
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

    if (!(await this.otpService.consumeVerified(dto.otpRequestId, phone))) {
      throw new BadRequestException('This verified OTP request has already been used or expired');
    }
    for (const branch of dto.branches ?? []) {
      if (!(await this.otpService.consumeVerified(branch.otpRequestId, branch.contactPersonPhone.trim()))) {
        throw new BadRequestException('Branch contact OTP has already been used or expired');
      }
    }

    const capturedChannel = staff.role === 'field_agent' ? 'field_visit' : 'phone_call';
    const latitude = typeof businessLat === 'number' ? businessLat : (typeof visitLat === 'number' ? visitLat : null);
    const longitude = typeof businessLon === 'number' ? businessLon : (typeof visitLon === 'number' ? visitLon : null);
    const accountAgent = staff.role === 'field_agent'
      ? { accountAgentId: staff.id, accountAgentAssignedAt: this.clock.now() }
      : {};
    const created = await this.prisma.$transaction(async (tx) => {
      const savedBusiness = await tx.business.create({
        data: {
          code,
          name: dto.name.trim(),
          address: dto.address?.trim() ?? null,
          phone,
          phoneVerified: true,
          city,
          legalName: isHousehold ? null : (dto.legalName?.trim() || null),
          familyName: isHousehold ? dto.familyName!.trim() : null,
          ownerName: dto.ownerName?.trim() || null,
          additionalContactName: contactName,
          additionalContactPhone: phone,
          contactRole: dto.contactPersonRole,
          contactWhatsAppPhone: dto.contactWhatsAppPhone?.trim() || null,
          contactLanguage: dto.contactLanguage?.trim() || null,
          businessType,
          employeeCountBand: dto.employeeCountBand?.trim() || null,
          employeeCount: dto.employeeCount ?? null,
          staffNeeded: [...(dto.staffNeeded ?? []), ...(dto.staffNeededRows ?? []).map((row) => `${row.trade.trim()} x${row.headcount}`)],
          licenceNumber: hideDocuments ? null : (dto.licenceNumber?.trim() || null),
          shopEstablishmentNumber: hideDocuments ? null : (dto.shopEstablishmentNumber?.trim() || null),
          udyamNumber: hideDocuments ? null : (dto.udyamNumber?.trim() || null),
          pan: hideDocuments ? null : (dto.pan?.trim() || null),
          fssaiNumber: hideDocuments ? null : (dto.fssaiNumber?.trim() || null),
          gstNumber,
          ...(gstLookupData ?? { gstVerified: null, gstLegalName: null, gstStatus: null, gstCheckedAt: null }),
          yearsInOperation: dto.yearsInOperation ?? null,
          yearsInOperationBand: dto.yearsInOperationBand?.trim() || null,
          hiringFrequency: dto.hiringFrequency?.trim() || null,
          openingTime: dto.openingTime?.trim() || null,
          closingTime: dto.closingTime?.trim() || null,
          workingDays: dto.workingDays?.map((day) => day.trim()) ?? [],
          shopNumber: dto.shopNumber?.trim() || null,
          street: dto.street?.trim() || null,
          landmark: dto.landmark?.trim() || null,
          pincode: dto.pincode?.trim() || null,
          billingName: dto.billingName?.trim() || null,
          billingAddress: dto.billingAddress?.trim() || null,
          billingEmail: dto.billingEmail?.trim() || null,
          heardFrom: dto.heardFrom?.trim() || null,
          documentsStatus,
          verificationStatus: 'lead',
          leadCreatedByStaffId: staff.id,
          leadChannel: capturedChannel,
          ...accountAgent,
          locality,
          latitude,
          longitude,
          geofenceFlag,
        },
      });
      const branchIds = new Map<string, string>();
      for (const branch of dto.branches ?? []) {
        const savedBranch = await tx.businessBranch.create({ data: {
          businessId: savedBusiness.id,
          name: branch.name.trim(), shopNumber: branch.shopNumber?.trim() || null,
          street: branch.street?.trim() || null, landmark: branch.landmark?.trim() || null,
          address: branch.address?.trim() || null, locality: branch.locality?.trim() || null,
          pincode: branch.pincode?.trim() || null, latitude: branch.latitude ?? null,
          longitude: branch.longitude ?? null, contactPersonName: branch.contactPersonName.trim(),
          contactPersonRole: branch.contactPersonRole, contactPersonPhone: branch.contactPersonPhone.trim(),
          contactWhatsAppPhone: branch.contactWhatsAppPhone?.trim() || null,
          contactLanguage: branch.contactLanguage?.trim() || null,
        } });
        branchIds.set(branch.name.trim(), savedBranch.id);
      }
      const draftVacancies: Array<{ code: string; headcount: number }> = [];
      for (const row of dto.staffNeededRows ?? []) {
        const vacancyCode = await this.idService.generateCode('vacancy');
        const namedBranch = row.branchName?.trim()
          ? (dto.branches ?? []).find((branch) => branch.name.trim() === row.branchName!.trim())
          : undefined;
        const branchId = namedBranch ? branchIds.get(namedBranch.name.trim()) ?? null : null;
        const branchLatitude = namedBranch?.latitude;
        const branchLongitude = namedBranch?.longitude;
        const branchHasPin = typeof branchLatitude === 'number' && typeof branchLongitude === 'number';
        const vacancy = await tx.vacancy.create({ data: {
          code: vacancyCode, city, businessId: savedBusiness.id, capturedByStaffId: staff.id,
          branchId,
          tradeSkill: row.trade.trim(), headcount: row.headcount, status: 'draft',
          salaryMinPaise: row.salaryMinPaise, salaryMaxPaise: row.salaryMaxPaise,
          salaryPeriod: row.salaryPeriod === 'daily' ? 'daily' : 'monthly',
          shift: row.shift.trim(), startDate: new Date(`${row.startDate}T00:00:00.000Z`),
          locality: namedBranch?.locality?.trim() || locality,
          latitude: branchHasPin ? branchLatitude : latitude,
          longitude: branchHasPin ? branchLongitude : longitude,
          capturedChannel,
        } });
        await this.tradeService.recordSuggestion(tx, row.trade.trim(), staff.id, 'vacancy', vacancy.id);
        draftVacancies.push({ code: vacancy.code, headcount: row.headcount });
      }
      if ((visitLat !== undefined && visitLon !== undefined) || selfieUrl || selfieHash || dto.visit) {
        await tx.businessVisit.create({
          data: {
            businessId: savedBusiness.id,
            staffId: staff.id,
            latitude: typeof visitLat === 'number' ? visitLat : (latitude ?? 0),
            longitude: typeof visitLon === 'number' ? visitLon : (longitude ?? 0),
            selfieUrl,
            selfieHash,
            geofenceFlag,
            visitedAt: dto.visit?.visitedAt
              ? new Date(dto.visit.visitedAt)
              : (dto.visitedAt ? new Date(dto.visitedAt) : new Date()),
          },
        });
      }
      return { business: savedBusiness, draftVacancies };
    });
    const business = created.business;
    for (const branch of dto.branches ?? []) {
      await this.auditService.log({
        actorId: staff.id, action: 'business.branch_created', entityType: 'business', entityCode: business.code,
        after: { branchCount: dto.branches?.length ?? 0, role: branch.contactPersonRole },
        changedFields: ['branch.name', 'branch.locality', 'branch.contactPersonRole'],
        city: business.city,
      });
    }
    for (const vacancy of created.draftVacancies) {
      await this.auditService.log({
        actorId: staff.id, action: 'business.staff_need_draft_created', entityType: 'vacancy', entityCode: vacancy.code,
        after: { businessCode: business.code, headcount: vacancy.headcount, status: 'draft' },
        changedFields: ['tradeSkill', 'headcount', 'salaryMinPaise', 'salaryMaxPaise', 'shift', 'startDate', 'status', 'latitude', 'longitude'],
        city,
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
        ...(business.accountAgentId ? { accountAgentId: business.accountAgentId, accountAgentAssignedAt: business.accountAgentAssignedAt?.toISOString() ?? null } : {}),
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
        ...(business.accountAgentId ? ['accountAgentId', 'accountAgentAssignedAt'] : []),
        'gstVerified',
        'gstStatus',
        'locality',
        'contactRole',
        'contactWhatsAppPhone',
        'contactLanguage',
        'employeeCountBand',
        'yearsInOperationBand',
        'hiringFrequency',
        'openingTime',
        'closingTime',
        'workingDays',
        'shopNumber',
        'street',
        'landmark',
        'pincode',
        'billingEmail',
        'heardFrom',
        'fssaiNumber',
        'familyName',
        'staffNeeded',
      ],
      city: business.city,
    });

    return this.presentBusiness(await this.prisma.business.findUniqueOrThrow({
      where: { id: business.id },
      include: { branches: true, vacancies: true },
    }));
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

    const rows = await this.prisma.business.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { vacancies: true, branches: true },
    });
    return rows.map((row) => this.presentBusiness(row));
  }

  async findById(id: string) {
    let business = await this.prisma.business.findUnique({
      where: { id },
      include: { vacancies: true, branches: true, visits: true, agreements: { select: { signedAt: true } } },
    });
    if (!business) {
      business = await this.prisma.business.findUnique({
        where: { code: id },
        include: { vacancies: true, branches: true, visits: true, agreements: { select: { signedAt: true } } },
      });
    }
    if (!business) {
      throw new NotFoundException(`Business '${id}' not found`);
    }
    const accountAgent = business.accountAgentId
      ? await this.prisma.staff.findUnique({ where: { id: business.accountAgentId }, select: { id: true, code: true, name: true } })
      : null;
    return this.presentBusiness({ ...business, accountAgentSummary: accountAgent });
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

    return this.presentBusiness(await this.prisma.business.findUniqueOrThrow({
      where: { id: res.id },
      include: { branches: true },
    }));
  }

  private presentBusiness<T extends {
    ownerName: string | null;
    phone: string;
    additionalContactName: string | null;
    additionalContactPhone: string | null;
    contactRole: string | null;
  }>(business: T) {
    const contactPersonName = business.additionalContactName ?? business.ownerName;
    const contactPersonPhone = business.additionalContactPhone ?? business.phone;
    const contactPersonRole = business.contactRole ?? 'owner';
    return {
      ...business,
      additionalContactName: contactPersonName,
      additionalContactPhone: contactPersonPhone,
      contactRole: contactPersonRole,
      contactPersonName,
      contactPersonRole,
      contactPersonPhone,
    };
  }

  private assertOptionalValue(value: string | undefined, allowed: readonly string[], field: string) {
    if (value === undefined || value === null || value.trim() === '') return;
    if (!allowed.includes(value.trim())) throw new BadRequestException(`${field} is invalid`);
  }

  private assertOptionalTime(value: string | undefined, field: string) {
    if (!value?.trim()) return;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.trim())) {
      throw new BadRequestException(`${field} must be HH:MM`);
    }
  }

  private assertOptionalPincode(value: string | undefined) {
    if (value === undefined || value === null || value.trim() === '') return;
    if (!/^\d{6}$/.test(value.trim())) throw new BadRequestException('pincode must be 6 digits');
  }

  private assertOptionalEmail(value: string | undefined) {
    if (!value?.trim()) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
      throw new BadRequestException('billingEmail is invalid');
    }
  }

  private assertWorkingDays(value: string[] | undefined) {
    if (value === undefined) return;
    if (!Array.isArray(value) || value.length > 7 || value.some((day) => typeof day !== 'string' || !day.trim())) {
      throw new BadRequestException('workingDays is invalid');
    }
  }
}

function phoneDigits(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('91') && digits.length === 12 ? digits.slice(2) : digits;
}

