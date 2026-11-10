import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma, PricingPolicy } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';

export { PricingPolicy };

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
