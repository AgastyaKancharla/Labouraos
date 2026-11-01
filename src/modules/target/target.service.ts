import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Staff, Target } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { CreateTargetDto } from './dto/create-target.dto';
import { UpdateTargetDto } from './dto/update-target.dto';
import {
  ALL_METRIC_KEYS,
  ALLOWED_TARGET_ROLES,
  TargetMetricKey,
  calculateProRatingFactor,
  evaluateMetricTarget,
  MetricEvaluationResult,
} from './target.constants';

@Injectable()
export class TargetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * DECISION 1 — ROLE RESTRICTION:
   * Only front-line execution agents ('call_agent' and 'field_agent') have operational
   * targets. Supervisory, management and back-office roles ('ceo', 'manager',
   * 'team_lead', 'finance') oversee or support the platform and do not carry individual
   * candidate or placement targets. Setting a target for ineligible roles is refused.
   */
  private assertEligibleRole(role: string): void {
    if (!ALLOWED_TARGET_ROLES.includes(role as (typeof ALLOWED_TARGET_ROLES)[number])) {
      throw new BadRequestException(
        `Targets can only be set for call_agent and field_agent. Role '${role}' is not eligible for targets.`,
      );
    }
  }

  /**
   * DECISION 2 — PARTIAL TARGETS:
   * Null on a metric field means "not targeted for this metric this period". It is excluded
   * from pace flagging and agent dashboards rather than treated as a zero expectation.
   * A zero target and an absent target are fundamentally different. Setting a target where
   * ALL metric fields are null is an empty record and is refused.
   */
  private assertAtLeastOneMetric(dto: Partial<Record<TargetMetricKey, number | null>>): void {
    const hasAtLeastOne = ALL_METRIC_KEYS.some(
      (key) => dto[key] !== undefined && dto[key] !== null,
    );
    if (!hasAtLeastOne) {
      throw new BadRequestException(
        'At least one metric target must be provided. An empty target with all null values is not permitted.',
      );
    }
  }

  private validateMetricValues(dto: Partial<Record<TargetMetricKey, number | null>>): void {
    if (dto.refundRate !== undefined && dto.refundRate !== null) {
      if (typeof dto.refundRate !== 'number' || dto.refundRate < 0 || dto.refundRate > 1) {
        throw new BadRequestException('refundRate must be a number between 0 and 1');
      }
    }
    for (const key of ALL_METRIC_KEYS) {
      if (key === 'refundRate') continue;
      const val = dto[key];
      if (val !== undefined && val !== null) {
        if (!Number.isInteger(val) || val < 0) {
          throw new BadRequestException(`${key} must be a non-negative integer`);
        }
      }
    }
  }

  /**
   * DECISION 3 — PAST PERIODS:
   * Targets cannot be created or edited for a calendar month that has already ended.
   * Retroactively altering a target rewrites historical performance records and creates
   * an integrity risk. Editing the current month or future months is permitted and audited.
   * Uses injectable time (`now`) to enable deterministic time-based testing.
   */
  private assertNotPastPeriod(year: number, month: number, now: Date): void {
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth() + 1; // 1-12

    const isPast =
      year < currentYear || (year === currentYear && month < currentMonth);

    if (isPast) {
      throw new BadRequestException(
        `Cannot set or update target for past period ${year}-${String(month).padStart(2, '0')}. The period has already ended.`,
      );
    }
  }

  async setTarget(dto: CreateTargetDto, actorId: string, now: Date = new Date()) {
    // 1. Fetch staff and assert eligibility (Decision 1)
    const staff = await this.prisma.staff.findUnique({
      where: { id: dto.staffId },
    });
    if (!staff) {
      throw new NotFoundException(`Staff '${dto.staffId}' not found`);
    }
    if (staff.status === 'deactivated') {
      throw new BadRequestException(`Cannot set target for deactivated staff '${staff.code}'`);
    }
    this.assertEligibleRole(staff.role);

    // 2. Assert at least one non-null metric (Decision 2)
    this.assertAtLeastOneMetric(dto);
    this.validateMetricValues(dto);

    // 3. Assert target period is valid and not in the past (Decision 3)
    if (!Number.isInteger(dto.year) || dto.year < 2020 || dto.year > 2100) {
      throw new BadRequestException('year must be a valid 4-digit integer');
    }
    if (!Number.isInteger(dto.month) || dto.month < 1 || dto.month > 12) {
      throw new BadRequestException('month must be an integer between 1 and 12');
    }
    this.assertNotPastPeriod(dto.year, dto.month, now);

    // 4. Assert unique target for (staffId, year, month)
    const existing = await this.prisma.target.findUnique({
      where: {
        staffId_year_month: {
          staffId: dto.staffId,
          year: dto.year,
          month: dto.month,
        },
      },
    });
    if (existing) {
      throw new ConflictException(
        `Target already exists for staff '${staff.code}' for period ${dto.year}-${String(dto.month).padStart(2, '0')}`,
      );
    }

    // 5. Create target record
    const target = await this.prisma.target.create({
      data: {
        staffId: dto.staffId,
        year: dto.year,
        month: dto.month,
        candidatesActivated: dto.candidatesActivated ?? null,
        refundRate: dto.refundRate ?? null,
        vacanciesCaptured: dto.vacanciesCaptured ?? null,
        placementsClosed: dto.placementsClosed ?? null,
        replacementsInside15Days: dto.replacementsInside15Days ?? null,
        repeatBusinesses: dto.repeatBusinesses ?? null,
        createdById: actorId,
      },
      include: {
        staff: true,
      },
    });

    // 6. Audit log
    await this.auditService.log({
      actorId,
      action: 'target.create',
      entityType: 'target',
      entityCode: target.id,
      city: staff.city,
      after: {
        staffId: target.staffId,
        staffCode: staff.code,
        year: target.year,
        month: target.month,
        candidatesActivated: target.candidatesActivated,
        refundRate: target.refundRate,
        vacanciesCaptured: target.vacanciesCaptured,
        placementsClosed: target.placementsClosed,
        replacementsInside15Days: target.replacementsInside15Days,
        repeatBusinesses: target.repeatBusinesses,
      },
    });

    return this.formatTargetResponse(target);
  }

  async updateTarget(
    id: string,
    dto: UpdateTargetDto,
    actorId: string,
    now: Date = new Date(),
  ) {
    const existing = await this.prisma.target.findUnique({
      where: { id },
      include: { staff: true },
    });
    if (!existing) {
      throw new NotFoundException(`Target '${id}' not found`);
    }

    // Assert period not in the past (Decision 3)
    this.assertNotPastPeriod(existing.year, existing.month, now);

    // Merge metrics and assert at least one non-null metric remains (Decision 2)
    const mergedMetrics: Record<TargetMetricKey, number | null> = {
      candidatesActivated:
        dto.candidatesActivated !== undefined
          ? dto.candidatesActivated
          : existing.candidatesActivated,
      refundRate:
        dto.refundRate !== undefined ? dto.refundRate : existing.refundRate,
      vacanciesCaptured:
        dto.vacanciesCaptured !== undefined
          ? dto.vacanciesCaptured
          : existing.vacanciesCaptured,
      placementsClosed:
        dto.placementsClosed !== undefined
          ? dto.placementsClosed
          : existing.placementsClosed,
      replacementsInside15Days:
        dto.replacementsInside15Days !== undefined
          ? dto.replacementsInside15Days
          : existing.replacementsInside15Days,
      repeatBusinesses:
        dto.repeatBusinesses !== undefined
          ? dto.repeatBusinesses
          : existing.repeatBusinesses,
    };

    this.validateMetricValues(dto);
    this.assertAtLeastOneMetric(mergedMetrics);

    const beforeState = {
      candidatesActivated: existing.candidatesActivated,
      refundRate: existing.refundRate,
      vacanciesCaptured: existing.vacanciesCaptured,
      placementsClosed: existing.placementsClosed,
      replacementsInside15Days: existing.replacementsInside15Days,
      repeatBusinesses: existing.repeatBusinesses,
    };

    const updated = await this.prisma.target.update({
      where: { id },
      data: {
        ...mergedMetrics,
        updatedById: actorId,
      },
      include: {
        staff: true,
      },
    });

    await this.auditService.log({
      actorId,
      action: 'target.update',
      entityType: 'target',
      entityCode: updated.id,
      city: existing.staff.city,
      before: beforeState,
      after: mergedMetrics,
    });

    return this.formatTargetResponse(updated);
  }

  async getTargetById(id: string, actor: JwtPayload) {
    const target = await this.prisma.target.findUnique({
      where: { id },
      include: { staff: true },
    });
    if (!target) {
      throw new NotFoundException(`Target '${id}' not found`);
    }

    // Server-side RBAC scoping
    if (actor.role === 'team_lead') {
      if (target.staff.teamLeadId !== actor.sub) {
        throw new ForbiddenException(
          `Access denied: staff '${target.staff.code}' is not part of your team`,
        );
      }
    } else if (actor.role === 'call_agent' || actor.role === 'field_agent') {
      if (target.staffId !== actor.sub) {
        throw new ForbiddenException('Access denied: can only access your own targets');
      }
    } else if (actor.role === 'finance') {
      throw new ForbiddenException('Access denied: finance cannot access targets');
    }

    return this.formatTargetResponse(target);
  }

  async listTargets(
    query: { staffId?: string; year?: number; month?: number },
    actor: JwtPayload,
  ) {
    const where: Prisma.TargetWhereInput = {};

    if (query.year) {
      where.year = Number(query.year);
    }
    if (query.month) {
      where.month = Number(query.month);
    }

    if (actor.role === 'call_agent' || actor.role === 'field_agent') {
      if (query.staffId && query.staffId !== actor.sub) {
        throw new ForbiddenException('Access denied: can only access your own targets');
      }
      where.staffId = actor.sub;
    } else if (actor.role === 'team_lead') {
      if (query.staffId) {
        const staff = await this.prisma.staff.findUnique({
          where: { id: query.staffId },
        });
        if (!staff || staff.teamLeadId !== actor.sub) {
          throw new ForbiddenException(
            `Access denied: staff '${query.staffId}' is not part of your team`,
          );
        }
        where.staffId = query.staffId;
      } else {
        where.staff = { teamLeadId: actor.sub };
      }
    } else if (actor.role === 'finance') {
      throw new ForbiddenException('Access denied: finance cannot access targets');
    } else {
      // CEO and Manager
      if (query.staffId) {
        where.staffId = query.staffId;
      }
    }

    const targets = await this.prisma.target.findMany({
      where,
      include: { staff: true },
      orderBy: [{ year: 'desc' }, { month: 'desc' }, { createdAt: 'desc' }],
    });

    return targets.map((t) => this.formatTargetResponse(t));
  }

  formatTargetResponse(target: Target & { staff: Staff }) {
    const staff = target.staff;
    const { factor, isMidMonthJoiner, daysPresent, daysInMonth } = calculateProRatingFactor(
      staff.createdAt,
      target.year,
      target.month,
    );

    const metricsRecord = {} as Record<TargetMetricKey, MetricEvaluationResult>;
    const storedValues = {} as Record<TargetMetricKey, number | null>;
    const effectiveValues = {} as Record<TargetMetricKey, number | null>;

    for (const key of ALL_METRIC_KEYS) {
      const rawStored = target[key] as number | null;
      storedValues[key] = rawStored;
      const evaluated = evaluateMetricTarget(key, rawStored, factor);
      metricsRecord[key] = evaluated;
      effectiveValues[key] = evaluated.effectiveTarget;
    }

    return {
      id: target.id,
      staffId: target.staffId,
      staff: {
        id: staff.id,
        code: staff.code,
        name: staff.name,
        role: staff.role,
        area: staff.area,
        city: staff.city,
        createdAt: staff.createdAt,
      },
      year: target.year,
      month: target.month,
      proRating: {
        factor,
        isMidMonthJoiner,
        daysPresent,
        daysInMonth,
        staffCreatedAt: staff.createdAt,
      },
      stored: storedValues,
      effective: effectiveValues,
      metrics: metricsRecord,
      createdById: target.createdById,
      updatedById: target.updatedById,
      createdAt: target.createdAt,
      updatedAt: target.updatedAt,
    };
  }
}
