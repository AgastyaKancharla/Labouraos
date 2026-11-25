import { OwnTeam, businessesOwnedBy } from '../../common/rbac/own-team';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  HttpStatus,
} from '@nestjs/common';
import { codedError } from '../../common/http/coded-error';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { AuditService } from '../../common/audit/audit.service';
import { PricingService } from '../pricing/pricing.service';
import { CreateVacancyDto } from './dto/create-vacancy.dto';
import { recordStatusChange } from '../../common/status-history/status-history.helper';
import { ReviewFlagService } from '../review-flag/review-flag.service';
import { VACANCY_EXTRAS } from './vacancy.constants';
import { EditPolicyService, EditActor, pickEditableFields } from '../../common/edit-policy/edit-policy.service';
import { normalizeTradeName, TradeService } from '../trade/trade.service';
import { VacancyConfirmationService } from './vacancy-confirmation.service';
import { shiftLabel } from '../business/business-shift';
import { BUSINESS_SUSPENDED_MESSAGE, businessAccessMessage, businessCandidateAccess, isBusinessSuspended } from '../business/business-candidate-access';

const IST_OFFSET_MINUTES = 330;

/**
 * The only columns PATCH /vacancies/:id writes (security AC-1). Not here, on
 * purpose: status (closing has POST /vacancies/:id/close), the business,
 * branch, capturing agent and channel, the replacement link, the owner's
 * confirmation fields and the legal-minimum-wage check (set by the
 * confirmation flow), city, and every relation.
 */
export const ALLOWED_VACANCY_UPDATE_FIELDS: ReadonlySet<string> = new Set([
  'tradeSkill',
  'roleTitle',
  'headcount',
  'description',
  'salaryMinPaise',
  'salaryMaxPaise',
  'salaryPeriod',
  'extras',
  'workingHours',
  'shift',
  'weeklyOff',
  'locality',
  'latitude',
  'longitude',
  'experienceRequiredYears',
  'educationRequired',
  'languagesRequired',
  'licencesRequired',
  'ageMin',
  'ageMax',
  'genderRequirement',
  'genderReason',
  'startDate',
  'urgency',
  'probationDays',
  'interviewType',
  'interviewContactName',
]);

/** M2: the salary periods the vacancy form takes. */
export const VACANCY_SALARY_PERIODS = ['monthly', 'daily'] as const;

/** M2: a change to any of these runs the legal minimum wage check again. */
const MINIMUM_WAGE_FIELDS = ['tradeSkill', 'salaryMinPaise', 'salaryMaxPaise', 'salaryPeriod', 'headcount'];

/** Statuses a vacancy can be closed from (POST /vacancies/:id/close). */
// pending_tl_check (25 Nov, B4): confirmed, waiting for the Team Lead's vacancy check.
export const CLOSABLE_VACANCY_STATUSES = ['open', 'draft', 'awaiting_confirmation', 'pending_tl_check'];

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

  /**
   * The business shift a vacancy picks (17 Nov): it must be one of this
   * business's shifts. The vacancy keeps its own copy (label in `shift`, and
   * the times matching reads), so a later change to the list never changes it.
   */
  private async pickedShift(businessId: string, shiftId: unknown) {
    if (shiftId === undefined || shiftId === null || shiftId === '') return null;
    const shift = typeof shiftId === 'string' && shiftId.length <= 64
      ? await this.prisma.businessShift.findFirst({ where: { id: shiftId, businessId } })
      : null;
    if (!shift) throw new BadRequestException('businessShiftId must be one of this business\'s shifts');
    return { shift: shiftLabel(shift), businessShiftId: shift.id, shiftStartTime: shift.startTime, shiftEndTime: shift.endTime };
  }

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
    // The "I told the owner about the minimum wage" tick goes with a salary change; it is not a column write.
    // A picked business shift (17 Nov) is turned into its label here; its id and times are written below.
    const { ownerToldMinimumWage, businessShiftId, ...body } = dto;
    let picked: Awaited<ReturnType<VacancyService['pickedShift']>> = null;
    if (businessShiftId !== undefined) {
      const owner = await this.prisma.vacancy.findFirst({ where: { OR: [{ id }, { code: id }] }, select: { businessId: true } });
      if (!owner) throw new NotFoundException('Vacancy not found');
      picked = await this.pickedShift(owner.businessId, businessShiftId);
      if (picked) body.shift = picked.shift;
    }
    // Security (AC-1): job details only; status, confirmation and links have their own routes.
    const updates = pickEditableFields(body, ALLOWED_VACANCY_UPDATE_FIELDS, 'vacancy');
    if ('headcount' in updates && (!Number.isInteger(updates.headcount) || (updates.headcount as number) < 1)) {
      throw new BadRequestException('headcount must be a whole number of at least 1');
    }
    for (const key of ['salaryMinPaise', 'salaryMaxPaise'] as const) {
      if (key in updates && updates[key] !== null && (!Number.isInteger(updates[key]) || (updates[key] as number) < 0)) {
        throw new BadRequestException(`${key} must be a whole number of paise`);
      }
    }
    // M2: the same checks as the vacancy form.
    if ('salaryPeriod' in updates && !(VACANCY_SALARY_PERIODS as readonly unknown[]).includes(updates.salaryPeriod)) {
      throw new BadRequestException('salaryPeriod must be monthly or daily');
    }
    if ('tradeSkill' in updates && (typeof updates.tradeSkill !== 'string' || !normalizeTradeName(updates.tradeSkill))) {
      throw new BadRequestException('tradeSkill is required');
    }

    const { record, diff } = await this.editPolicyService.assertCanEdit({
      actor: editActor,
      entityType: 'vacancy',
      entityId: id,
      updates,
      reason,
    });

    if (!diff || !diff.hasChange) {
      return record;
    }
    if (['filled', 'cancelled', 'closed'].includes(record.status as string)) {
      throw new ConflictException('This vacancy is closed and cannot be edited');
    }

    const data: Record<string, unknown> = {};
    if (diff.changedFields.includes('shift')) {
      // A typed shift drops the picked one; a picked one brings its id and times.
      Object.assign(data, picked
        ? { businessShiftId: picked.businessShiftId, shiftStartTime: picked.shiftStartTime, shiftEndTime: picked.shiftEndTime }
        : { businessShiftId: null, shiftStartTime: null, shiftEndTime: null });
    }
    for (const key of diff.changedFields) {
      if (key === 'tradeSkill' && typeof updates[key] === 'string') {
        data[key] = normalizeTradeName(updates[key] as string);
      } else if (key === 'startDate') {
        data[key] = updates[key] ? new Date(updates[key] as string) : null;
      } else {
        data[key] = updates[key];
      }
    }

    // M2: the salary range must make sense, and a change to the trade, salary, period or
    // headcount runs the legal minimum wage check again (the tick is asked for again). A draft
    // is checked when it is sent for confirmation (submitForConfirmation), as at creation.
    const fromStatus = record.status as string;
    const effective = <T>(key: string): T => (key in data ? data[key] : record[key]) as T;
    const salaryMin = effective<number | null>('salaryMinPaise');
    const salaryMax = effective<number | null>('salaryMaxPaise');
    if (salaryMin !== null && salaryMin !== undefined && salaryMax !== null && salaryMax !== undefined && salaryMin > salaryMax) {
      throw new BadRequestException('salaryMinPaise cannot be more than salaryMaxPaise');
    }
    // M2-R3: past the draft a vacancy always has a starting salary, so the minimum wage check always runs.
    if (fromStatus !== 'draft' && diff.changedFields.some((field) => MINIMUM_WAGE_FIELDS.includes(field)) && !(typeof salaryMin === 'number' && salaryMin > 0)) {
      throw new BadRequestException('salaryMinPaise is required (more than 0) once a vacancy is past the draft');
    }
    if (fromStatus !== 'draft' && diff.changedFields.some((field) => MINIMUM_WAGE_FIELDS.includes(field)) && typeof salaryMin === 'number') {
      Object.assign(data, await this.confirmationService.legalMinimumFields(
        effective<string>('tradeSkill'),
        salaryMin,
        effective<string | null>('salaryPeriod'),
        ownerToldMinimumWage,
        { businessId: record.businessId as string },
      ));
    }

    // M2: the owner confirmed the old details. Any change to a vacancy past the draft clears that
    // confirmation and sends it back to "waiting for the owner's OTP" (also when it was already
    // waiting): earlier codes and links no longer confirm it, and the agent is told.
    const reconfirm = fromStatus !== 'draft';
    if (reconfirm) {
      Object.assign(data, {
        status: 'awaiting_confirmation',
        confirmedAt: null,
        confirmationMethod: null,
        confirmedByName: null,
        confirmedByRole: null,
        confirmedPhoneLast4: null,
        confirmationRecordedByStaffId: null,
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // M2-R1: lock the row (a confirm locks it too) and decide from the locked row. If the status
      // moved since it was loaded (confirmed, sent for confirmation, closed), the checks above were
      // made for another state: refuse, and the agent opens it again.
      const [locked] = await tx.$queryRaw<{ status: string }[]>(
        Prisma.sql`SELECT "status" FROM "Vacancy" WHERE "id" = ${record.id as string} FOR UPDATE`,
      );
      if (!locked || locked.status !== fromStatus) {
        throw new ConflictException('This vacancy changed while you were editing it. Open it again.');
      }
      const row = await tx.vacancy.update({ where: { id: record.id as string }, data });
      if (reconfirm) {
        await recordStatusChange(tx, {
          subjectType: 'vacancy',
          subjectId: row.id,
          fromStatus,
          toStatus: 'awaiting_confirmation',
          changedByStaffId: editActor.id,
          reason: 'details_changed_owner_must_confirm_again',
        });
      }
      if (typeof data.tradeSkill === 'string') {
        await this.tradeService.recordSuggestion(tx, data.tradeSkill, editActor.id, 'vacancy', row.id);
      }
      return row;
    });
    if (reconfirm) await this.confirmationService.revokeLiveConfirmations(updated.id);

    await this.editPolicyService.logEdit({
      actorId: editActor.id,
      entityType: 'vacancy',
      entityCode: record.code as string,
      diff,
      reason,
      city: record.city as string | undefined,
    });
    if (reconfirm) {
      await this.auditService.log({
        actorId: editActor.id,
        action: 'vacancy.confirmation_reset',
        entityType: 'vacancy',
        entityCode: updated.code,
        before: { status: fromStatus, confirmed: Boolean(record.confirmedAt) },
        after: { status: 'awaiting_confirmation', confirmed: false },
        changedFields: ['status', 'confirmedAt'],
        reason: 'Vacancy details changed: the owner must confirm again',
        city: updated.city,
      });
      return { ...updated, ownerMustConfirmAgain: true, message: 'Details saved. The owner must confirm the vacancy again: send them a new code or link.' };
    }

    return updated;
  }

  /**
   * Close a vacancy (C-Vacancy "Close vacancy"): no more matching or interviews.
   * Was PATCH { status: 'cancelled' } before security AC-1 took status off the
   * edit route. Team Lead (own team, through the edit policy), Manager or CEO;
   * a reason is required; open, draft or waiting-for-owner vacancies only.
   */
  async close(id: string, actor: EditActor, reasonInput: unknown) {
    const reason = typeof reasonInput === 'string' ? reasonInput.trim() : '';
    if (!reason) throw new BadRequestException('A reason is required to close a vacancy');
    if (!['team_lead', 'manager', 'ceo'].includes(actor.role)) {
      throw new ForbiddenException('Only a Team Lead, a Manager or the CEO can close a vacancy');
    }
    const { record } = await this.editPolicyService.assertCanEdit({ actor, entityType: 'vacancy', entityId: id });
    const vacancyId = record.id as string;
    const fromStatus = record.status as string;
    const closed = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.vacancy.updateMany({
        where: { id: vacancyId, status: { in: CLOSABLE_VACANCY_STATUSES } },
        data: { status: 'cancelled' },
      });
      if (changed.count === 0) return false;
      await recordStatusChange(tx, {
        subjectType: 'vacancy',
        subjectId: vacancyId,
        fromStatus,
        toStatus: 'cancelled',
        changedByStaffId: actor.id,
        reason,
      });
      return true;
    });
    if (!closed) {
      throw new BadRequestException('Only an open, draft or waiting-for-owner vacancy can be closed');
    }
    await this.auditService.log({
      actorId: actor.id,
      action: 'vacancy.closed',
      entityType: 'vacancy',
      entityCode: record.code as string,
      before: { status: fromStatus },
      after: { status: 'cancelled' },
      changedFields: ['status'],
      reason,
      city: (record.city as string | undefined) ?? 'Bengaluru',
    });
    return this.prisma.vacancy.findUniqueOrThrow({ where: { id: vacancyId } });
  }

  /**
   * Staff pass their id. The customer app passes `options.selfRegisteredByAccountId`
   * (a business user confirming their own vacancy by a fresh OTP): the same checks
   * and minimum-wage rule, no capturing agent, channel "laboura_app" (proposal C8).
   */
  /**
   * The vacancy form's checks, with no database work: create() runs them first,
   * and the customer app runs them before it uses up a fresh OTP.
   * Returns the headcount.
   */
  validateCreateInput(dto: CreateVacancyDto): number {
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
    return headcount;
  }

  async create(businessId: string, dto: CreateVacancyDto, actorId: string, options: { selfRegisteredByAccountId?: string } = {}) {
    const headcount = this.validateCreateInput(dto);

    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
    });
    if (!business) {
      throw new NotFoundException(`Business '${businessId}' not found`);
    }
    // D6 (rev 176): a suspended business adds no new vacancies while the suspension lasts.
    if (isBusinessSuspended(business)) throw new ForbiddenException(BUSINESS_SUSPENDED_MESSAGE);

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
    const picked = await this.pickedShift(business.id, dto.businessShiftId);
    const legalMinimum = await this.confirmationService.legalMinimumFields(
      normalizeTradeName(dto.tradeSkill),
      dto.salaryMinPaise,
      dto.salaryPeriod,
      dto.ownerToldMinimumWage,
      { businessId: business.id },
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
          shift: picked ? picked.shift : dto.shift?.trim() ?? null,
          businessShiftId: picked?.businessShiftId ?? null,
          shiftStartTime: picked?.shiftStartTime ?? null,
          shiftEndTime: picked?.shiftEndTime ?? null,
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
    // Laboura Field (rev 188) switches on these codes; the messages stay as they were.
    if (vacancy.status !== 'draft') {
      throw codedError(HttpStatus.BAD_REQUEST, 'NOT_A_DRAFT', `Only a draft vacancy can be completed (this one is ${vacancy.status})`, { status: vacancy.status });
    }
    if (staff.role === 'field_agent' && vacancy.business.accountAgentId !== staff.id && vacancy.capturedByStaffId !== staff.id) {
      throw codedError(HttpStatus.FORBIDDEN, 'NOT_YOUR_BUSINESS', 'Field agents may only complete vacancies for their account businesses');
    }
    const missing = [
      ['tradeSkill', vacancy.tradeSkill?.trim()],
      ['salaryMinPaise', vacancy.salaryMinPaise],
      ['headcount', vacancy.headcount],
      ['shift', vacancy.shift?.trim()],
      ['startDate', vacancy.startDate],
    ].filter(([, value]) => value === null || value === undefined || value === '').map(([field]) => field);
    if (missing.length) {
      throw codedError(HttpStatus.BAD_REQUEST, 'DRAFT_INCOMPLETE', `The draft is missing: ${missing.join(', ')}`, { missing });
    }
    const legalMinimum = await this.confirmationService.legalMinimumFields(
      vacancy.tradeSkill,
      vacancy.salaryMinPaise!,
      vacancy.salaryPeriod,
      body?.ownerToldMinimumWage,
      { businessId: vacancy.businessId },
    );
    const updated = await this.prisma.$transaction(async (tx) => {
      // M2-R1: only the draft that was checked above (an edit since then changes updatedAt).
      const changed = await tx.vacancy.updateMany({
        where: { id: vacancy.id, status: 'draft', updatedAt: vacancy.updatedAt },
        data: { ...legalMinimum, status: 'awaiting_confirmation' },
      });
      if (changed.count !== 1) throw codedError(HttpStatus.BAD_REQUEST, 'DRAFT_CHANGED', 'This draft was already completed or changed. Open it again.');
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
      where.business = businessesOwnedBy(await new OwnTeam(this.prisma).memberIds(staff.id));
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
      throw new ForbiddenException(businessAccessMessage(businessAccess, 'Candidates are hidden until the business is verified'));
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

    // A Team Lead sees only their own team's job seekers (owner decision, 14 Nov; OwnTeam).
    const team = staff.role === 'team_lead' ? await new OwnTeam(this.prisma).memberIds(staff.id) : null;
    return this.prisma.jobSeeker.findMany({
      where: {
        id: { in: consentedJobSeekerIds },
        ...(team ? { registeredByStaffId: { in: team } } : {}),
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

