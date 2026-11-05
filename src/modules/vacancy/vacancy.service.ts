import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { AuditService } from '../../common/audit/audit.service';
import { PricingService } from '../pricing/pricing.service';
import { CreateVacancyDto } from './dto/create-vacancy.dto';
import { recordStatusChange } from '../../common/status-history/status-history.helper';
import { ReviewFlagService } from '../review-flag/review-flag.service';
import { VACANCY_EXTRAS } from './vacancy.constants';

const IST_OFFSET_MINUTES = 330;

@Injectable()
export class VacancyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idService: IdService,
    private readonly auditService: AuditService,
    private readonly pricingService: PricingService,
    private readonly reviewFlagService: ReviewFlagService,
  ) {}

  async create(businessId: string, dto: CreateVacancyDto, actorId: string) {
    if (!dto.tradeSkill || typeof dto.tradeSkill !== 'string' || !dto.tradeSkill.trim()) {
      throw new BadRequestException('tradeSkill is required');
    }

    if (
      typeof dto.salaryMinPaise !== 'number' ||
      !Number.isInteger(dto.salaryMinPaise) ||
      dto.salaryMinPaise <= 0
    ) {
      throw new BadRequestException('salaryMinPaise must be a positive integer in paise');
    }
    if (
      dto.salaryMaxPaise !== undefined &&
      (!Number.isInteger(dto.salaryMaxPaise) || dto.salaryMaxPaise < dto.salaryMinPaise)
    ) {
      throw new BadRequestException('salaryMaxPaise must be an integer at least salaryMinPaise');
    }
    if (
      dto.genderRequirement !== undefined &&
      dto.genderRequirement !== null &&
      dto.genderRequirement !== 'none' &&
      !dto.genderReason?.trim()
    ) {
      throw new BadRequestException('genderReason is required when genderRequirement is specified');
    }
    if (
      dto.extras &&
      (!Array.isArray(dto.extras) || dto.extras.some((extra) => !VACANCY_EXTRAS.some((allowed) => allowed === extra)))
    ) {
      throw new BadRequestException('extras contains an unsupported value');
    }
    for (const [field, values] of [
      ['languagesRequired', dto.languagesRequired],
      ['licencesRequired', dto.licencesRequired],
    ] as const) {
      if (values && (!Array.isArray(values) || values.some((value) => typeof value !== 'string'))) {
        throw new BadRequestException(`${field} must be a list of strings`);
      }
    }
    if (dto.interviewType && !['walk_in', 'scheduled'].includes(dto.interviewType)) {
      throw new BadRequestException('interviewType must be walk_in or scheduled');
    }
    if (dto.interviewType === 'scheduled' && dto.walkInDate) {
      throw new BadRequestException('walkInDate can only be used for walk_in interviews');
    }
    if (dto.interviewType === 'walk_in' && dto.interviewSlots?.length) {
      throw new BadRequestException('interviewSlots are only used for scheduled interviews');
    }

    const headcount = dto.headcount ?? 1;
    if (typeof headcount !== 'number' || !Number.isInteger(headcount) || headcount < 1) {
      throw new BadRequestException('headcount must be a positive integer');
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

    if (
      staff.role === 'field_agent' &&
      (business.area !== null
        ? business.area !== staff.area
        : business.leadCreatedByStaffId !== staff.id && business.accountAgentId !== staff.id)
    ) {
      throw new ForbiddenException(
        `Access denied: business is in area '${business.area}', not your area '${staff.area}'`,
      );
    }

    const policy = await this.pricingService.current();
    const interviewType = dto.interviewType ?? 'walk_in';
    const slots = this.buildInterviewSlots(dto, interviewType, policy.walkInStart, policy.walkInEnd);
    const code = await this.idService.generateCode('vacancy');

    const vacancy = await this.prisma.$transaction(async (tx) => {
      const v = await tx.vacancy.create({
        data: {
          code,
          city: business.city,
          businessId: business.id,
          capturedByStaffId: staff.id,
          tradeSkill: dto.tradeSkill.trim(),
          salaryMinPaise: dto.salaryMinPaise,
          salaryMaxPaise: dto.salaryMaxPaise ?? null,
          salaryPeriod: dto.salaryPeriod ?? null,
          headcount,
          description: dto.description?.trim() ?? null,
          roleTitle: dto.roleTitle?.trim() ?? null,
          extras: dto.extras ?? [],
          workingHours: dto.workingHours?.trim() ?? null,
          shift: dto.shift?.trim() ?? null,
          weeklyOff: dto.weeklyOff?.trim() ?? null,
          latitude: dto.latitude ?? business.latitude,
          longitude: dto.longitude ?? business.longitude,
          locality: dto.locality?.trim() || business.locality,
          experienceRequiredYears: dto.experienceRequiredYears ?? null,
          educationRequired: dto.educationRequired?.trim() ?? null,
          languagesRequired: dto.languagesRequired ?? [],
          licencesRequired: dto.licencesRequired ?? [],
          ageMin: dto.ageMin ?? null,
          ageMax: dto.ageMax ?? null,
          genderRequirement: dto.genderRequirement ?? null,
          genderReason: dto.genderReason?.trim() ?? null,
          startDate: dto.startDate ? this.parseDate(dto.startDate, 'startDate') : null,
          urgency: dto.urgency ?? null,
          probationDays: dto.probationDays ?? null,
          interviewType,
          interviewContactName: dto.interviewContactName?.trim() ?? null,
          capturedChannel:
            dto.capturedChannel ??
            (staff.role === 'call_agent'
              ? 'phone_call'
              : staff.role === 'field_agent'
                ? 'field_visit'
                : null),
          interviewSlots: { create: slots },
          status: 'open',
        },
        include: {
          business: true,
          interviewSlots: true,
        },
      });

      await recordStatusChange(tx, {
        subjectType: 'vacancy',
        subjectId: v.id,
        fromStatus: null,
        toStatus: 'open',
        changedByStaffId: staff.id,
      });

      return v;
    });

    await this.auditService.log({
      actorId: staff.id,
      action: 'vacancy.created',
      entityType: 'vacancy',
      entityCode: vacancy.code,
      after: vacancy as unknown as Record<string, unknown>,
      city: vacancy.city,
    });

    if (staff.role === 'call_agent' && business.accountAgentId && business.accountAgentId !== staff.id) {
      await this.reviewFlagService.raise({
        kind: 'vacancy_captured_for_account_business',
        subjectType: 'vacancy',
        subjectId: vacancy.id,
        raisedForStaffId: business.accountAgentId,
        details: { vacancyCode: vacancy.code },
      });
    }

    return vacancy;
  }

  async findAll(actorId: string, filterStatus?: string) {
    const staff = await this.prisma.staff.findUnique({
      where: { id: actorId },
    });
    if (!staff) {
      throw new NotFoundException(`Staff '${actorId}' not found`);
    }

    const where: Prisma.VacancyWhereInput = {};
    if (filterStatus) {
      where.status = filterStatus;
    }

    if (staff.role === 'field_agent') {
      where.business = {
        area: staff.area ?? undefined,
        city: staff.city,
      };
    }

    return this.prisma.vacancy.findMany({
      where,
      include: { business: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string, actorId: string) {
    const vacancy = await this.prisma.vacancy.findUnique({
      where: { id },
      include: { business: true },
    });
    if (!vacancy) {
      throw new NotFoundException(`Vacancy '${id}' not found`);
    }

    const staff = await this.prisma.staff.findUnique({
      where: { id: actorId },
    });
    if (staff?.role === 'field_agent' && vacancy.business.area !== staff.area) {
      throw new ForbiddenException(
        `Access denied: vacancy business is in area '${vacancy.business.area}', not your area '${staff.area}'`,
      );
    }

    return vacancy;
  }

  async findByBusiness(businessId: string, actorId: string) {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
    });
    if (!business) {
      throw new NotFoundException(`Business '${businessId}' not found`);
    }

    const staff = await this.prisma.staff.findUnique({
      where: { id: actorId },
    });
    if (staff?.role === 'field_agent' && business.area !== staff.area) {
      throw new ForbiddenException(
        `Access denied: business is in area '${business.area}', not your area '${staff.area}'`,
      );
    }

    return this.prisma.vacancy.findMany({
      where: { businessId },
      include: { business: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getCandidates(vacancyId: string, actorId: string) {
    const vacancy = await this.prisma.vacancy.findFirst({
      where: vacancyId.startsWith('VC-') ? { code: vacancyId } : { id: vacancyId },
      include: { business: true },
    });
    if (!vacancy) {
      throw new NotFoundException(`Vacancy '${vacancyId}' not found`);
    }

    const staff = await this.prisma.staff.findUnique({
      where: { id: actorId },
    });
    if (!staff) {
      throw new NotFoundException(`Staff '${actorId}' not found`);
    }

    if (vacancy.salaryMinPaise === null) return [];

    if (staff.role === 'field_agent' && vacancy.business.area !== staff.area) {
      throw new ForbiddenException(
        `Access denied: vacancy business is in area '${vacancy.business.area}', not your area '${staff.area}'`,
      );
    }

    const matchingConsents = await this.prisma.consent.findMany({
      where: {
        subjectType: 'job_seeker',
        purpose: 'job_matching',
        granted: true,
        grantedAt: { not: null },
        withdrawnAt: null,
      },
      select: { subjectId: true },
    });
    const consentedJobSeekerIds = matchingConsents.map((consent) => consent.subjectId);
    if (consentedJobSeekerIds.length === 0) {
      return [];
    }

    return this.prisma.jobSeeker.findMany({
      where: {
        id: { in: consentedJobSeekerIds },
        city: vacancy.city,
        status: 'active',
        OR: [
          { trades: { some: { trade: { equals: vacancy.tradeSkill, mode: 'insensitive' } } } },
          { trades: { none: {} }, tradeSkill: { equals: vacancy.tradeSkill, mode: 'insensitive' } },
        ],
        minSalary: { lte: vacancy.salaryMinPaise },
        maxSalary: { gte: vacancy.salaryMinPaise },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  private buildInterviewSlots(
    dto: CreateVacancyDto,
    interviewType: string,
    walkInStart: string,
    walkInEnd: string,
  ) {
    if (interviewType === 'walk_in') {
      if (!dto.walkInDate) return [];
      const startsAt = this.istDateTime(dto.walkInDate, walkInStart);
      const endsAt = this.istDateTime(dto.walkInDate, walkInEnd);
      if (endsAt <= startsAt) throw new BadRequestException('walk-in end must be after start');
      return [{ startsAt, endsAt, capacity: null }];
    }

    return (dto.interviewSlots ?? []).map((slot) => {
      const startsAt = new Date(slot.startsAt);
      const endsAt = new Date(slot.endsAt);
      if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
        throw new BadRequestException('Scheduled slots require valid startsAt and endsAt, with end after start');
      }
      if (slot.capacity !== undefined && (!Number.isInteger(slot.capacity) || slot.capacity <= 0)) {
        throw new BadRequestException('Scheduled slot capacity must be a positive integer');
      }
      return { startsAt, endsAt, capacity: slot.capacity ?? null };
    });
  }

  private istDateTime(day: string, time: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(time)) {
      throw new BadRequestException('walkInDate must be YYYY-MM-DD and policy times must be HH:mm');
    }
    const value = new Date(`${day}T${time}:00+05:30`);
    if (Number.isNaN(value.getTime())) {
      throw new BadRequestException('walkInDate or policy time is invalid');
    }
    const istValue = new Date(value.getTime() + IST_OFFSET_MINUTES * 60_000).toISOString();
    if (istValue.slice(0, 10) !== day || istValue.slice(11, 16) !== time) {
      throw new BadRequestException('walkInDate or policy time is invalid');
    }
    return value;
  }

  private parseDate(value: string, field: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new BadRequestException(`${field} must be a valid date`);
    return date;
  }
}

