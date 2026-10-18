import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { calculatePlacementFee, refundGuaranteeDeadline } from '../../common/money/money';
import { PriorityDashboardOpportunity } from './field-agent.types';

@Injectable()
export class FieldAgentService {
  constructor(private readonly prisma: PrismaService) {}

  async getPriorityDashboard(actorId: string, now: Date = new Date()): Promise<PriorityDashboardOpportunity[]> {
    const staff = await this.prisma.staff.findUnique({
      where: { id: actorId },
    });
    if (!staff) {
      throw new NotFoundException(`Staff '${actorId}' not found`);
    }

    const vacancyWhere: Prisma.VacancyWhereInput = {
      status: 'open',
      city: staff.city,
    };

    if (staff.role === 'field_agent') {
      vacancyWhere.business = {
        area: staff.area ?? undefined,
        city: staff.city,
      };
    }

    const openVacancies = await this.prisma.vacancy.findMany({
      where: vacancyWhere,
      include: {
        business: true,
      },
    });

    if (openVacancies.length === 0) {
      return [];
    }

    // Active candidates across the entire city (deliberate exception to area-scoping)
    const activeCandidates = await this.prisma.jobSeeker.findMany({
      where: {
        city: staff.city,
        status: 'active',
      },
    });

    const opportunities: PriorityDashboardOpportunity[] = [];

    for (const vacancy of openVacancies) {
      const potentialFee = calculatePlacementFee(vacancy.offeredSalary);

      const matching = activeCandidates.filter((candidate) => {
        const tradeMatches =
          candidate.tradeSkill.trim().toLowerCase() ===
          vacancy.tradeSkill.trim().toLowerCase();
        const salaryMatches =
          candidate.minSalary <= vacancy.offeredSalary &&
          candidate.maxSalary >= vacancy.offeredSalary;
        return tradeMatches && salaryMatches;
      });

      for (const candidate of matching) {
        const refundDeadline = candidate.paymentReceivedAt
          ? refundGuaranteeDeadline(candidate.paymentReceivedAt)
          : null;

        const daysRemainingOnGuarantee = refundDeadline
          ? Math.max(
              0,
              Math.ceil(
                (refundDeadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
              ),
            )
          : null;

        opportunities.push({
          vacancyId: vacancy.id,
          vacancyCode: vacancy.code,
          tradeSkill: vacancy.tradeSkill,
          offeredSalary: vacancy.offeredSalary,
          businessId: vacancy.business.id,
          businessName: vacancy.business.name,
          businessArea: vacancy.business.area,
          candidateId: candidate.id,
          candidateCode: candidate.code,
          candidateName: candidate.name,
          candidatePhone: candidate.phone,
          potentialFee,
          refundDeadline,
          daysRemainingOnGuarantee,
          vacancy,
          candidate,
        });
      }
    }

    // Sort rules:
    // 1. refund-clock deadline first (candidates closest to their 30-day refund guarantee expiration come first)
    // 2. potential fee value as tiebreak (higher fee value first)
    opportunities.sort((a, b) => {
      const timeA = a.refundDeadline ? a.refundDeadline.getTime() : Infinity;
      const timeB = b.refundDeadline ? b.refundDeadline.getTime() : Infinity;

      if (timeA !== timeB) {
        return timeA - timeB;
      }

      if (b.potentialFee !== a.potentialFee) {
        return b.potentialFee - a.potentialFee;
      }

      return (
        a.candidate.createdAt.getTime() - b.candidate.createdAt.getTime() ||
        a.candidate.id.localeCompare(b.candidate.id)
      );
    });

    return opportunities;
  }
}
