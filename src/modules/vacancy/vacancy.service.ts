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
import { EditPolicyService, EditActor } from '../../common/edit-policy/edit-policy.service';
import { normalizeTradeName, TradeService } from '../trade/trade.service';
import { VacancyConfirmationService } from './vacancy-confirmation.service';
import { BUSINESS_PAUSED_MESSAGE, businessCandidateAccess } from '../business/business-candidate-access';

const IST_OFFSET_MINUTES = 330;

@Injectable()
export class VacancyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idService: IdService,
    private readonly auditService: AuditService,
    private readonly pricingService: PricingService,
    private readonly reviewFlagService: ReviewFlagService,
    private readonly editPolicyService: EditPolicyService,
    private readonly tradeService: TradeService,
    private readonly confirmationService: VacancyConfirmationService,
  ) {}

  async update(id: string, dto: Record<string, unknown>, actor: EditActor | string) {
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
      entityType: 'vacancy',
      entityId: id,
      updates: dto,
      reason,
    });

    if (!diff || !diff.hasChange) {
      return record;
    }

    const data: Record<string, unknown> = {};
    for (const key of diff.changedFields) {
      data[key] = key === 'tradeSkill' && typeof dto[key] === 'string'
        ? normalizeTradeName(dto[key] as string)
        : dto[key];
    }

    const updated = await this.prisma.vacancy.update({
      where: { id: record.id as string },
      data,
    });
    if (typeof data.tradeSkill === 'string') {
      await this.prisma.$transaction((tx) => this.tradeService.recordSuggestion(
        tx,
        data.tradeSkill as string,
        editActor.id,
        'vacancy',
        updated.id,
      ));
    }

    await this.editPolicyService.logEdit({
      actorId: editActor.id,
      entityType: 'vacancy',
      entityCode: record.code as string,
      diff,
      reason,
      city: record.city as string | undefined,
    });

    return updated;
  }

  /**
   * Staff pass their id. The customer app passes `options.selfRegisteredByAccountId`
   * (a business user confirming their own vacancy by a fresh OTP): the same checks
   * and minimum-wage rule, no capturing agent, channel "laboura_app" (proposal C8).
   */
  async create(businessId: string, dto: CreateVacancyDto, actorId: string, options: { selfRegisteredByAccountId?: string } = {}) {
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

    const selfAccountId = options.selfRegisteredByAccountId;
    const staff = selfAccountId ? null : await this.prisma.staff.findUnique({
      where: { id: actorId },
    });
    if (!staff && !selfAccountId) {
      throw new NotFoundException(`Staff '${actorId}' not found`);
    }
    const staffId = staff?.id ?? null;
    const auditActorId = staff?.id ?? `customer:${selfAccountId}`;

    if (staff?.role === 'field_agent' && business.accountAgentId !== staff.id) {
      throw new ForbiddenException('Field agents may only add vacancies to their account businesses');
    }

    let branchId: string | null = null;
    if (dto.branchId) {
      const branch = await this.prisma.businessBranch.findFirst({
        where: { id: dto.branchId, businessId: business.id },
        select: { id: true },
      });
      if (!branch) throw new BadRequestException('branchId must be a branch of this business');
      branchId = branch.id;
    }
    const legalMinimum = await this.confirmationService.legalMinimumFields(
      normalizeTradeName(dto.tradeSkill),
      dto.salaryMinPaise,
      dto.salaryPeriod,
      dto.ownerToldMinimumWage,
    );

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
          capturedByStaffId: staffId,
          tradeSkill: normalizeTradeName(dto.tradeSkill),
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
            (!staff ? 'laboura_app' : null) ??
            dto.capturedChannel ??
            (staff?.role === 'call_agent'
              ? 'phone_call'
              : staff?.role === 'field_agent'
                ? 'field_visit'
                : null),
          interviewSlots: { create: slots },
          branchId,
          ...legalMinimum,
          // Phase 20 Task 8: a new vacancy waits for the contact person's OTP before it can be matched.
          status: 'awaiting_confirmation',
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
        toStatus: 'awaiting_confirmation',
        changedByStaffId: staffId,
      });
      await this.tradeService.recordSuggestion(tx, v.tradeSkill, staffId, 'vacancy', v.id);

      return v;
    });

    await this.auditService.log({
      actorId: auditActorId,
      action: 'vacancy.created',
      entityType: 'vacancy',
      entityCode: vacancy.code,
      after: vacancy as unknown as Record<string, unknown>,
      city: vacancy.city,
    });

    if (staff?.role === 'call_agent' && business.accountAgentId && business.accountAgentId !== staff.id) {
      await this.reviewFlagService.raise({
        kind: 'vacancy_captured_for_account_business',
        subjectType: 'vacancy',
        subjectId: vacancy.id,
        raisedForStaffId: business.accountAgentId,
        details: { vacancyCode: vacancy.code },
      });
    }

    // In the app the contact person confirms on the spot (VacancyConfirmationService.confirmInApp): no code is sent.
    const confirmation = staff ? await this.trySendConfirmationCode(vacancy.id, staff) : null;
    return { ...vacancy, confirmation };
  }

  /**
   * Completes a draft (from the business form's staff-needed rows): checks the required fields and the legal
   * minimum wage, moves it to awaiting_confirmation and sends the contact person the confirmation code.
   */
  async submitForConfirmation(vacancyRef: string, body: { ownerToldMinimumWage?: boolean }, actorId: string) {
    const staff = await this.prisma.staff.findUnique({ where: { id: actorId } });
    if (!staff) throw new NotFoundException(`Staff '${actorId}' not found`);
    const vacancy = await this.prisma.vacancy.findFirst({
      where: vacancyRef.startsWith('VC-') ? { code: vacancyRef } : { id: vacancyRef },
      include: { business: true },
    });
    if (!vacancy) throw new NotFoundException(`Vacancy '${vacancyRef}' not found`);
    if (vacancy.status !== 'draft') {
      throw new BadRequestException(`Only a draft vacancy can be completed (this one is ${vacancy.status})`);
    }
    if (staff.role === 'field_agent' && vacancy.business.accountAgentId !== staff.id && vacancy.capturedByStaffId !== staff.id) {
      throw new ForbiddenException('Field agents may only complete vacancies for their account businesses');
    }
    const missing = [
      ['tradeSkill', vacancy.tradeSkill?.trim()],
      ['salaryMinPaise', vacancy.salaryMinPaise],
      ['headcount', vacancy.headcount],
      ['shift', vacancy.shift?.trim()],
      ['startDate', vacancy.startDate],
    ].filter(([, value]) => value === null || value === undefined || value === '').map(([field]) => field);
    if (missing.length) {
      throw new BadRequestException(`The draft is missing: ${missing.join(', ')}`);
    }
    const legalMinimum = await this.confirmationService.legalMinimumFields(
      vacancy.tradeSkill,
      vacancy.salaryMinPaise!,
      vacancy.salaryPeriod,
      body?.ownerToldMinimumWage,
    );
    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.vacancy.updateMany({
        where: { id: vacancy.id, status: 'draft' },
        data: { ...legalMinimum, status: 'awaiting_confirmation' },
      });
      if (changed.count !== 1) throw new BadRequestException('This draft was already completed');
      await recordStatusChange(tx, {
        subjectType: 'vacancy',
        subjectId: vacancy.id,
        fromStatus: 'draft',
        toStatus: 'awaiting_confirmation',
        changedByStaffId: staff.id,
      });
      return tx.vacancy.findUniqueOrThrow({ where: { id: vacancy.id }, include: { business: true } });
    });
    await this.auditService.log({
      actorId: staff.id,
      action: 'vacancy.draft_completed',
      entityType: 'vacancy',
      entityCode: updated.code,
      before: { status: 'draft' },
      after: { status: 'awaiting_confirmation', belowLegalMinimum: updated.belowLegalMinimum },
      changedFields: ['status', 'belowLegalMinimum', 'ownerToldMinimumWage'],
      city: updated.city,
    });
    const confirmation = await this.trySendConfirmationCode(updated.id, staff);
    return { ...updated, confirmation };
  }

  /** Sending the code must never lose the saved vacancy: if it fails, the agent can send it again. */
  private async trySendConfirmationCode(vacancyId: string, staff: { id: string; role: string }) {
    try {
      return await this.confirmationService.sendCode(vacancyId, { id: staff.id, role: staff.role });
    } catch (error: unknown) {
      return { error: error instanceof Error ? error.message : 'The confirmation code could not be sent' };
    }
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
    if (staff.role === 'team_lead') {
      const team = await this.prisma.staff.findMany({ where: { teamLeadId: staff.id }, select: { id: true } });
      const teamIds = team.map(({ id }) => id);
      where.business = {
        OR: [
          { accountAgentId: { in: teamIds } },
          { leadCreatedByStaffId: { in: teamIds } },
        ],
      };
    }

    return this.prisma.vacancy.findMany({
      where,
      include: { business: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    const vacancy = await this.prisma.vacancy.findUnique({
      where: { id },
      include: { business: true },
    });
    if (!vacancy) {
      throw new NotFoundException(`Vacancy '${id}' not found`);
    }

    return vacancy;
  }

  async findByBusiness(businessId: string) {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
    });
    if (!business) {
      throw new NotFoundException(`Business '${businessId}' not found`);
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
    if (vacancy.status === 'draft' || vacancy.status === 'awaiting_confirmation') {
      throw new BadRequestException('Candidates are shown only after the contact person confirms this vacancy by OTP');
    }

    const businessAccess = businessCandidateAccess(vacancy.business);
    if (!businessAccess.allowed) {
      throw new ForbiddenException(businessAccess.reason === 'paused'
        ? BUSINESS_PAUSED_MESSAGE
        : 'Candidates are hidden until the business is verified');
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
        trades: { some: { trade: { equals: vacancy.tradeSkill, mode: 'insensitive' } } },
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

