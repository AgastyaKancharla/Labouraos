import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma, PricingPolicy } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';

export { PricingPolicy };

/** How far ahead the go-live date may be set (about a year). */
export const GO_LIVE_MAX_DAYS_AHEAD = 366;

/** "YYYY-MM-DD" of an instant in IST. */
function istDayKey(at: Date): string {
  return new Date(at.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/** A policy's go-live date as "YYYY-MM-DD" (stored as a calendar date), or null. */
export function goLiveDayOf(policy: { goLiveDate?: Date | null } | null | undefined): string | null {
  const date = policy?.goLiveDate;
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async current(): Promise<PricingPolicy> {
    const now = new Date();
    const policy = await this.prisma.pricingPolicy.findFirst({
      where: {
        effectiveFrom: { lte: now },
      },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    });

    if (!policy) {
      throw new Error('No active PricingPolicy found in database');
    }

    return policy;
  }

  async getPolicy(): Promise<PricingPolicy> {
    return this.current();
  }

  async createVersion(
    updates: Partial<PricingPolicy>,
    actorId: string,
  ): Promise<PricingPolicy> {
    if (
      updates.officeNetworkRequired !== undefined &&
      updates.officeNetworkRequired !== null &&
      typeof updates.officeNetworkRequired !== 'boolean'
    ) {
      throw new BadRequestException('officeNetworkRequired must be true or false');
    }
    const before = await this.current();

    const created = await this.prisma.pricingPolicy.create({
      data: {
        activationFeePaise: updates.activationFeePaise ?? before.activationFeePaise,
        placementFeePercent: updates.placementFeePercent ?? before.placementFeePercent,
        gstPercent: updates.gstPercent ?? before.gstPercent,
        referralPayoutPaise: updates.referralPayoutPaise ?? before.referralPayoutPaise,
        joiningRewardPaise: updates.joiningRewardPaise ?? before.joiningRewardPaise,
        joiningRewardAfterDays: updates.joiningRewardAfterDays ?? before.joiningRewardAfterDays,
        jobSeekerGuaranteeDays: updates.jobSeekerGuaranteeDays ?? before.jobSeekerGuaranteeDays,
        offerReplyHours: updates.offerReplyHours ?? before.offerReplyHours,
        maxHits: updates.maxHits ?? before.maxHits,
        interviewResultDeadline: updates.interviewResultDeadline ?? before.interviewResultDeadline,
        interviewResultCloseHours: updates.interviewResultCloseHours ?? before.interviewResultCloseHours,
        interviewResultEscalateHours: updates.interviewResultEscalateHours ?? before.interviewResultEscalateHours,
        placementPaymentDueHours: updates.placementPaymentDueHours ?? before.placementPaymentDueHours,
        replacementWindowDays: updates.replacementWindowDays ?? before.replacementWindowDays,
        replacementSearchDays: updates.replacementSearchDays ?? before.replacementSearchDays,
        maxFreeReplacements: updates.maxFreeReplacements ?? before.maxFreeReplacements,
        maxReplacementRejections: updates.maxReplacementRejections ?? before.maxReplacementRejections,
        claimReportDays: updates.claimReportDays ?? before.claimReportDays,
        claimDecisionHours: updates.claimDecisionHours ?? before.claimDecisionHours,
        noBypassMonths: updates.noBypassMonths ?? before.noBypassMonths,
        noBypassPenaltyPercent: updates.noBypassPenaltyPercent ?? before.noBypassPenaltyPercent,
        payoutDetailsCoolingHours: updates.payoutDetailsCoolingHours ?? before.payoutDetailsCoolingHours,
        idleLogoutMinutes: updates.idleLogoutMinutes ?? before.idleLogoutMinutes,
        maxSessionMinutes: updates.maxSessionMinutes ?? before.maxSessionMinutes,
        loginCodeValidMinutes: updates.loginCodeValidMinutes ?? before.loginCodeValidMinutes,
        failedLoginLimit: updates.failedLoginLimit ?? before.failedLoginLimit,
        lockoutMinutes: updates.lockoutMinutes ?? before.lockoutMinutes,
        callingHoursStart: updates.callingHoursStart ?? before.callingHoursStart,
        callingHoursEnd: updates.callingHoursEnd ?? before.callingHoursEnd,
        duplicateBusinessRadiusMeters:
          updates.duplicateBusinessRadiusMeters ?? before.duplicateBusinessRadiusMeters,
        consentWithdrawalCallWindowMinutes:
          updates.consentWithdrawalCallWindowMinutes ?? before.consentWithdrawalCallWindowMinutes,
        walkInStart: updates.walkInStart ?? before.walkInStart,
        walkInEnd: updates.walkInEnd ?? before.walkInEnd,
        shiftStart: updates.shiftStart ?? before.shiftStart,
        shiftEnd: updates.shiftEnd ?? before.shiftEnd,
        productionHoursFullDay: updates.productionHoursFullDay ?? before.productionHoursFullDay,
        halfDayBelowHours: updates.halfDayBelowHours ?? before.halfDayBelowHours,
        dayToleranceMinutes: updates.dayToleranceMinutes ?? before.dayToleranceMinutes,
        lateGraceMinutes: updates.lateGraceMinutes ?? before.lateGraceMinutes,
        shortBreakMinutes: updates.shortBreakMinutes ?? before.shortBreakMinutes,
        lunchMinutes: updates.lunchMinutes ?? before.lunchMinutes,
        idleAfterMinutes: updates.idleAfterMinutes ?? before.idleAfterMinutes,
        casualLeavePerMonth: updates.casualLeavePerMonth ?? before.casualLeavePerMonth,
        emergencyLeavePerMonth: updates.emergencyLeavePerMonth ?? before.emergencyLeavePerMonth,
        refundPriorityWindowDays:
          updates.refundPriorityWindowDays ?? before.refundPriorityWindowDays,
        weeklyOffDays: updates.weeklyOffDays ?? before.weeklyOffDays,
        visitShortMinutes: updates.visitShortMinutes ?? before.visitShortMinutes,
        visitMaxTravelKmh: updates.visitMaxTravelKmh ?? before.visitMaxTravelKmh,
        visitSameSpotMeters: updates.visitSameSpotMeters ?? before.visitSameSpotMeters,
        visitNoOnboardingCount: updates.visitNoOnboardingCount ?? before.visitNoOnboardingCount,
        visitNoOnboardingDays: updates.visitNoOnboardingDays ?? before.visitNoOnboardingDays,
        matchPageSize: updates.matchPageSize ?? before.matchPageSize,
        salaryDaysPerMonth: updates.salaryDaysPerMonth ?? before.salaryDaysPerMonth,
        legalMinimumWageUnskilledPaise:
          updates.legalMinimumWageUnskilledPaise ?? before.legalMinimumWageUnskilledPaise,
        legalMinimumWageSemiSkilledPaise:
          updates.legalMinimumWageSemiSkilledPaise ?? before.legalMinimumWageSemiSkilledPaise,
        legalMinimumWageSkilledPaise:
          updates.legalMinimumWageSkilledPaise ?? before.legalMinimumWageSkilledPaise,
        legalMinimumWageHighlySkilledPaise:
          updates.legalMinimumWageHighlySkilledPaise ?? before.legalMinimumWageHighlySkilledPaise,
        legalMinimumWageEffectiveFrom: updates.legalMinimumWageEffectiveFrom
          ? new Date(updates.legalMinimumWageEffectiveFrom)
          : before.legalMinimumWageEffectiveFrom,
        matchingWeights:
          updates.matchingWeights === null || updates.matchingWeights === undefined
            ? (before.matchingWeights as Prisma.InputJsonValue)
            : (updates.matchingWeights as Prisma.InputJsonValue),
        adultMinimumAge: updates.adultMinimumAge ?? before.adultMinimumAge,
        financeBusinessRefundLimitPaise:
          updates.financeBusinessRefundLimitPaise ?? before.financeBusinessRefundLimitPaise,
        financeExpenseLimitPaise: updates.financeExpenseLimitPaise ?? before.financeExpenseLimitPaise,
        referralTdsYearlyLimitPaise: updates.referralTdsYearlyLimitPaise ?? before.referralTdsYearlyLimitPaise,
        payrollSalaryDays: updates.payrollSalaryDays ?? before.payrollSalaryDays,
        goLiveDate:
          updates.goLiveDate === undefined
            ? before.goLiveDate
            : updates.goLiveDate === null
              ? null
              : new Date(updates.goLiveDate),
        companyLegalName: updates.companyLegalName ?? before.companyLegalName,
        companyGstin: updates.companyGstin !== undefined ? updates.companyGstin : before.companyGstin,
        companyAddress: updates.companyAddress !== undefined ? updates.companyAddress : before.companyAddress,
        followUpGraceDays: updates.followUpGraceDays ?? before.followUpGraceDays,
        patternWindowDays: updates.patternWindowDays ?? before.patternWindowDays,
        patternBusinessMinInterviews:
          updates.patternBusinessMinInterviews ?? before.patternBusinessMinInterviews,
        patternStopDays: updates.patternStopDays ?? before.patternStopDays,
        patternAgentMinInterviews: updates.patternAgentMinInterviews ?? before.patternAgentMinInterviews,
        patternAgentRejectionPercent:
          updates.patternAgentRejectionPercent ?? before.patternAgentRejectionPercent,
        behindPaceStartDay: updates.behindPaceStartDay ?? before.behindPaceStartDay,
        behindPaceThresholdPercent: updates.behindPaceThresholdPercent ?? before.behindPaceThresholdPercent,
        registrationLinkValidHours: updates.registrationLinkValidHours ?? before.registrationLinkValidHours,
        paymentOnlyLinkMinutes: updates.paymentOnlyLinkMinutes ?? before.paymentOnlyLinkMinutes,
        officeNetworkRequired: updates.officeNetworkRequired ?? before.officeNetworkRequired,
        effectiveFrom: updates.effectiveFrom ? new Date(updates.effectiveFrom) : new Date(),
        setByStaffId: actorId,
      },
    });

    const actor = await this.prisma.staff.findUnique({
      where: { id: actorId },
    });

    if (actor) {
      await this.auditService.log({
        actorId: actor.id,
        action: 'pricing_change',
        entityType: 'pricing',
        entityCode: created.id,
        before: before as unknown as Record<string, unknown>,
        after: created as unknown as Record<string, unknown>,
        city: 'Bengaluru',
      });
    }

    this.logger.log(`New pricing policy version created (${created.id}) by actor ${actorId}`);
    return created;
  }

  async updatePolicy(
    updates: Partial<PricingPolicy>,
    actorId: string,
  ): Promise<PricingPolicy> {
    return this.createVersion(updates, actorId);
  }

  /**
   * Approval limits (guide: Finance portal). Finance approves and pays a business
   * refund up to `businessRefundLimitPaise` and an expense up to `expenseLimitPaise`;
   * anything above, and any refund outside the rules, needs the CEO. Only the CEO
   * calls this (enforced on the controller); every change is a new audited version.
   */
  async updateApprovalLimits(input: {
    businessRefundLimitPaise: number;
    expenseLimitPaise: number;
  }, actorId: string): Promise<PricingPolicy> {
    const values: Array<[string, number]> = [
      ['businessRefundLimitPaise', input?.businessRefundLimitPaise],
      ['expenseLimitPaise', input?.expenseLimitPaise],
    ];
    for (const [field, value] of values) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new BadRequestException(`${field} must be a whole number of paise, zero or more`);
      }
    }
    return this.createVersion({
      financeBusinessRefundLimitPaise: input.businessRefundLimitPaise,
      financeExpenseLimitPaise: input.expenseLimitPaise,
    }, actorId);
  }

  async getApprovalLimits(): Promise<{ businessRefundLimitPaise: number; expenseLimitPaise: number }> {
    const policy = await this.current();
    return {
      businessRefundLimitPaise: policy.financeBusinessRefundLimitPaise,
      expenseLimitPaise: policy.financeExpenseLimitPaise,
    };
  }

  /**
   * The go-live date (owner decision 12 Nov): the CEO sets the day Laboura starts
   * using the software. Payroll counts only from the later of a person's joining
   * date and this day (days before it are handled outside the app, never absent);
   * leave accrual starts from the later of the two as well. "YYYY-MM-DD", or null
   * to clear it. Every change is a new audited Settings version. CEO only.
   */
  async updateGoLiveDate(input: { goLiveDate?: unknown }, actorId: string, now: Date = new Date()): Promise<PricingPolicy> {
    const value = input?.goLiveDate;
    let date: Date | null = null;
    if (value !== null && value !== '') {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new BadRequestException('goLiveDate must be a date like 2026-11-20, or null to clear it');
      }
      date = new Date(`${value}T00:00:00.000Z`);
      if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
        throw new BadRequestException('goLiveDate must be a real calendar date');
      }
      // A typo must not move payroll and leave years away: at most a year ahead,
      // and never before the company's first records (its first staff account or joining date).
      const latest = istDayKey(new Date(now.getTime() + GO_LIVE_MAX_DAYS_AHEAD * 24 * 3600_000));
      if (value > latest) {
        throw new BadRequestException(`goLiveDate can be at most a year ahead (${latest} at the latest)`);
      }
      const firstDay = await this.firstRecordDay();
      if (firstDay && value < firstDay) {
        throw new BadRequestException(`goLiveDate can't be before the company's first records (${firstDay})`);
      }
    }
    const before = goLiveDayOf(await this.current());
    const after = date ? date.toISOString().slice(0, 10) : null;
    if (before === after) return this.current();
    await this.assertGoLiveMonthsOpen(before, after);
    return this.createVersion({ goLiveDate: date }, actorId);
  }

  /**
   * A go-live change moves whose days count in every month from the earlier of the
   * old and new go-live month on. It is refused once any of those months has a
   * salary sheet with the CEO, approved or paid, or is closed: a frozen or closed
   * month never changes.
   */
  private async assertGoLiveMonthsOpen(before: string | null, after: string | null): Promise<void> {
    const months = [before, after].filter((d): d is string => Boolean(d)).map((d) => d.slice(0, 7)).sort();
    if (!months.length) return;
    const from = months[0];
    const frozen = await this.prisma.payrollRun.findFirst({
      where: { month: { gte: from }, status: { in: ['with_ceo', 'approved', 'paid'] } },
      orderBy: { month: 'asc' },
      select: { month: true, status: true },
    });
    if (frozen) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: 'go_live_payroll_frozen',
        message: `The go-live date can't change now: the ${frozen.month} salary sheet is ${frozen.status === 'with_ceo' ? 'with the CEO' : frozen.status}, and a frozen month never changes.`,
      });
    }
    const closed = await this.prisma.monthClose.findFirst({
      where: { month: { gte: from }, status: 'closed' },
      orderBy: { month: 'asc' },
      select: { month: true },
    });
    if (closed) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: 'month_closed',
        message: `The go-live date can't change now: ${closed.month} is closed.`,
      });
    }
  }

  /** The IST day of the company's first record: the earliest staff account or joining date. */
  private async firstRecordDay(): Promise<string | null> {
    const [created, joined] = await Promise.all([
      this.prisma.staff.findFirst({ orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
      this.prisma.staff.findFirst({ where: { joinedOn: { not: null } }, orderBy: { joinedOn: 'asc' }, select: { joinedOn: true } }),
    ]);
    const days = [created ? istDayKey(created.createdAt) : null, joined?.joinedOn ? joined.joinedOn.toISOString().slice(0, 10) : null].filter(
      (d): d is string => Boolean(d),
    );
    return days.length ? days.sort()[0] : null;
  }

  /** The go-live day as an IST calendar key ("YYYY-MM-DD"), or null when not set. */
  async goLiveDay(): Promise<string | null> {
    const policy = await this.current();
    return goLiveDayOf(policy);
  }

  /** Company legal name, GSTIN and address printed on GST invoices. CEO only. */
  async updateCompanyDetails(input: {
    legalName: string;
    gstin?: string | null;
    address?: string | null;
  }, actorId: string): Promise<PricingPolicy> {
    const legalName = typeof input?.legalName === 'string' ? input.legalName.trim() : '';
    if (!legalName) throw new BadRequestException('legalName is required');
    const gstin = typeof input.gstin === 'string' ? input.gstin.trim().toUpperCase() : null;
    if (gstin && !/^[0-9]{2}[A-Z0-9]{13}$/.test(gstin)) {
      throw new BadRequestException('gstin must be 15 characters: a 2-digit state code then 13 letters or digits');
    }
    const address = typeof input.address === 'string' ? input.address.trim() : null;
    return this.createVersion({
      companyLegalName: legalName,
      companyGstin: gstin || null,
      companyAddress: address || null,
    }, actorId);
  }

  async updateMinimumWages(input: {
    unskilledPaise: number;
    semiSkilledPaise: number;
    skilledPaise: number;
    highlySkilledPaise: number;
    effectiveFrom: string;
  }, actorId: string): Promise<PricingPolicy> {
    const wageValues: Array<[string, number]> = [
      ['unskilledPaise', input.unskilledPaise],
      ['semiSkilledPaise', input.semiSkilledPaise],
      ['skilledPaise', input.skilledPaise],
      ['highlySkilledPaise', input.highlySkilledPaise],
    ];
    for (const [field, value] of wageValues) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new BadRequestException(`${field} must be a positive integer number of paise`);
      }
    }
    const effectiveFrom = new Date(input.effectiveFrom);
    if (Number.isNaN(effectiveFrom.getTime())) throw new BadRequestException('effectiveFrom must be a valid date');
    return this.createVersion({
      legalMinimumWageUnskilledPaise: input.unskilledPaise,
      legalMinimumWageSemiSkilledPaise: input.semiSkilledPaise,
      legalMinimumWageSkilledPaise: input.skilledPaise,
      legalMinimumWageHighlySkilledPaise: input.highlySkilledPaise,
      legalMinimumWageEffectiveFrom: effectiveFrom,
    }, actorId);
  }
}
