import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { ReviewFlagService } from './review-flag.service';

export interface PatternFlagResults {
  businessManyRejections: number;
  businessStopped: number;
  agentRejection: number;
  [key: string]: unknown;
}

@Injectable()
export class PatternFlagService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricingService: PricingService,
    private readonly reviewFlagService: ReviewFlagService,
  ) {}

  async evaluateAll(now = new Date()): Promise<PatternFlagResults> {
    const policy = await this.pricingService.current();

    const businessManyRejections = await this.evaluateBusinessManyRejections(now, policy);
    const businessStopped = await this.evaluateBusinessStoppedAfterInterviews(now, policy);
    const agentRejection = await this.evaluateAgentRejectionPattern(now, policy);

    return {
      businessManyRejections,
      businessStopped,
      agentRejection,
    };
  }

  async evaluateBusinessManyRejections(
    now: Date,
    policy: { patternWindowDays: number; patternBusinessMinInterviews: number },
  ): Promise<number> {
    const windowStart = new Date(
      now.getTime() - policy.patternWindowDays * 24 * 60 * 60 * 1000,
    );
    let raised = 0;

    const businesses = await this.prisma.business.findMany({
      select: { id: true, code: true, name: true, accountAgentId: true },
    });

    for (const business of businesses) {
      // Check if an open flag already exists for this business
      const openFlag = await this.prisma.reviewFlag.findFirst({
        where: {
          kind: 'business_many_rejections',
          subjectType: 'business',
          subjectId: business.id,
          status: 'open',
        },
      });
      if (openFlag) continue;

      // Find interviews for this business with a result in the window
      const interviews = await this.prisma.interview.findMany({
        where: {
          businessId: business.id,
          result: { in: ['selected', 'not_selected'] },
          createdAt: { gte: windowStart, lte: now },
        },
        select: { id: true, result: true },
      });

      if (interviews.length >= policy.patternBusinessMinInterviews) {
        const selectedCount = interviews.filter((i) => i.result === 'selected').length;
        if (selectedCount === 0) {
          await this.reviewFlagService.raise({
            kind: 'business_many_rejections',
            subjectType: 'business',
            subjectId: business.id,
            raisedForStaffId: business.accountAgentId,
            details: {
              businessId: business.id,
              businessCode: business.code,
              businessName: business.name,
              totalInterviews: interviews.length,
              selectedCount: 0,
              windowDays: policy.patternWindowDays,
              minInterviewsThreshold: policy.patternBusinessMinInterviews,
            },
          });
          raised++;
        }
      }
    }

    return raised;
  }

  async evaluateBusinessStoppedAfterInterviews(
    now: Date,
    policy: { patternStopDays: number },
  ): Promise<number> {
    let raised = 0;

    const businesses = await this.prisma.business.findMany({
      select: { id: true, code: true, name: true, accountAgentId: true },
    });

    for (const business of businesses) {
      const openFlag = await this.prisma.reviewFlag.findFirst({
        where: {
          kind: 'business_stopped_after_interviews',
          subjectType: 'business',
          subjectId: business.id,
          status: 'open',
        },
      });
      if (openFlag) continue;

      // Business had interviews
      const lastInterview = await this.prisma.interview.findFirst({
        where: { businessId: business.id },
        orderBy: [{ slotStartsAt: 'desc' }, { createdAt: 'desc' }],
        select: { id: true, slotStartsAt: true, createdAt: true },
      });
      if (!lastInterview) continue;

      const lastInterviewDate = lastInterview.slotStartsAt ?? lastInterview.createdAt;
      const daysSinceLast = Math.floor(
        (now.getTime() - lastInterviewDate.getTime()) / (24 * 60 * 60 * 1000),
      );

      if (daysSinceLast >= policy.patternStopDays) {
        // No new vacancy created after the last interview
        const newVacancy = await this.prisma.vacancy.findFirst({
          where: {
            businessId: business.id,
            createdAt: { gt: lastInterviewDate },
          },
          select: { id: true },
        });

        if (!newVacancy) {
          // No paid placement in between
          const paidPlacement = await this.prisma.placement.findFirst({
            where: {
              businessId: business.id,
              OR: [
                { paidAt: { not: null, gte: lastInterviewDate } },
                {
                  status: {
                    in: ['confirmed', 'active', 'completed', 'dropped_out', 'guarantee_ended'],
                  },
                  createdAt: { gte: lastInterviewDate },
                },
              ],
            },
            select: { id: true },
          });

          if (!paidPlacement) {
            await this.reviewFlagService.raise({
              kind: 'business_stopped_after_interviews',
              subjectType: 'business',
              subjectId: business.id,
              raisedForStaffId: business.accountAgentId,
              details: {
                businessId: business.id,
                businessCode: business.code,
                businessName: business.name,
                lastInterviewDate: lastInterviewDate.toISOString(),
                stopDays: policy.patternStopDays,
                daysSinceLastInterview: daysSinceLast,
              },
            });
            raised++;
          }
        }
      }
    }

    return raised;
  }

  async evaluateAgentRejectionPattern(
    now: Date,
    policy: {
      patternWindowDays: number;
      patternAgentMinInterviews: number;
      patternAgentRejectionPercent: number;
    },
  ): Promise<number> {
    const windowStart = new Date(
      now.getTime() - policy.patternWindowDays * 24 * 60 * 60 * 1000,
    );
    let raised = 0;

    const agents = await this.prisma.staff.findMany({
      where: { role: 'field_agent' },
      select: { id: true, code: true, name: true, teamLeadId: true },
    });

    for (const agent of agents) {
      const openFlag = await this.prisma.reviewFlag.findFirst({
        where: {
          kind: 'agent_rejection_pattern',
          subjectType: 'staff',
          subjectId: agent.id,
          status: 'open',
        },
      });
      if (openFlag) continue;

      // Find agent's account businesses
      const accountBusinesses = await this.prisma.business.findMany({
        where: { accountAgentId: agent.id },
        select: { id: true },
      });
      if (accountBusinesses.length === 0) continue;

      const businessIds = accountBusinesses.map((b) => b.id);

      // Find results across account businesses in window
      const interviews = await this.prisma.interview.findMany({
        where: {
          businessId: { in: businessIds },
          result: { in: ['selected', 'not_selected'] },
          createdAt: { gte: windowStart, lte: now },
        },
        select: { id: true, result: true },
      });

      if (interviews.length >= policy.patternAgentMinInterviews) {
        const notSelectedCount = interviews.filter((i) => i.result === 'not_selected').length;
        const rejectionPercent = Math.round((notSelectedCount / interviews.length) * 100);

        if (rejectionPercent >= policy.patternAgentRejectionPercent) {
          await this.reviewFlagService.raise({
            kind: 'agent_rejection_pattern',
            subjectType: 'staff',
            subjectId: agent.id,
            raisedForStaffId: agent.teamLeadId ?? agent.id,
            details: {
              agentId: agent.id,
              agentCode: agent.code,
              agentName: agent.name,
              totalResults: interviews.length,
              notSelectedCount,
              rejectionPercent,
              minInterviewsThreshold: policy.patternAgentMinInterviews,
              rejectionPercentThreshold: policy.patternAgentRejectionPercent,
              windowDays: policy.patternWindowDays,
            },
          });
          raised++;
        }
      }
    }

    return raised;
  }
}
