import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { refundGuaranteeDeadline } from '../../common/money/money';
import {
  PriorityCandidateRow,
  PriorityTradeRow,
  PriorityVacancyRow,
  UrgencyBand,
} from './priority.types';

@Injectable()
export class PriorityService {
  constructor(private readonly prisma: PrismaService) {}

  async getPriorityCandidates(
    actorId: string,
    now: Date = new Date(),
  ): Promise<PriorityCandidateRow[]> {
    const staff = await this.prisma.staff.findUnique({
      where: { id: actorId },
    });
    if (!staff) {
      throw new NotFoundException(`Staff '${actorId}' not found`);
    }

    // Deliberate exception: /priority/candidates is city-wide for field agents
    const candidates = await this.prisma.jobSeeker.findMany({
      where: {
        city: staff.city,
        status: 'active',
      },
    });

    const rows: PriorityCandidateRow[] = candidates.map((candidate) => {
      let daysRemaining = 30;
      let deadline: Date | null = null;

      if (candidate.paymentReceivedAt) {
        deadline = refundGuaranteeDeadline(candidate.paymentReceivedAt);
        const msRemaining = deadline.getTime() - now.getTime();
        daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));
      }

      let band: UrgencyBand = 'normal';
      if (daysRemaining <= 7) {
        band = 'critical';
      } else if (daysRemaining <= 15) {
        band = 'high';
      } else if (daysRemaining <= 23) {
        band = 'medium';
      } else {
        band = 'normal';
      }

      const twoHitFlag = candidate.hitCount === 2;

      return {
        candidate,
        id: candidate.id,
        code: candidate.code,
        name: candidate.name,
        tradeSkill: candidate.tradeSkill,
        minSalary: candidate.minSalary,
        maxSalary: candidate.maxSalary,
        daysRemaining,
        refundDeadline: deadline,
        band,
        twoHitFlag,
      };
    });

    // Sort: days remaining soonest first; within the same urgency band, tiebreak by stated salary descending
    const bandOrder: Record<UrgencyBand, number> = {
      critical: 1,
      high: 2,
      medium: 3,
      normal: 4,
    };

    rows.sort((a, b) => {
      if (bandOrder[a.band] !== bandOrder[b.band]) {
        return bandOrder[a.band] - bandOrder[b.band];
      }
      if (a.daysRemaining !== b.daysRemaining) {
        return a.daysRemaining - b.daysRemaining;
      }
      if (b.maxSalary !== a.maxSalary) {
        return b.maxSalary - a.maxSalary; // Higher expected salary first
      }
      return a.id.localeCompare(b.id);
    });

    return rows;
  }

  async getPriorityVacancies(
    actorId: string,
    now: Date = new Date(),
  ): Promise<PriorityVacancyRow[]> {
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

    const vacancies = await this.prisma.vacancy.findMany({
      where: vacancyWhere,
      include: { business: true },
    });

    const rows: PriorityVacancyRow[] = vacancies.map((vacancy) => {
      const msOpen = now.getTime() - vacancy.createdAt.getTime();
      const daysOpen = Math.max(0, Math.floor(msOpen / (1000 * 60 * 60 * 24)));
      const isReplacement = Boolean(vacancy.replacementForPlacementId);
      const isInReplacementWindow = isReplacement && daysOpen <= 15;
      const feeValue = vacancy.headcount * vacancy.offeredSalary;

      return {
        vacancy,
        id: vacancy.id,
        code: vacancy.code,
        tradeSkill: vacancy.tradeSkill,
        offeredSalary: vacancy.offeredSalary,
        headcount: vacancy.headcount,
        businessId: vacancy.business.id,
        businessName: vacancy.business.name,
        businessArea: vacancy.business.area,
        daysOpen,
        isReplacement,
        isInReplacementWindow,
        feeValue,
      };
    });

    // Sort: replacement vacancies still inside 15-day window to top, then days-open descending, then headcount * offeredSalary descending
    rows.sort((a, b) => {
      if (a.isInReplacementWindow !== b.isInReplacementWindow) {
        return a.isInReplacementWindow ? -1 : 1;
      }
      if (b.daysOpen !== a.daysOpen) {
        return b.daysOpen - a.daysOpen;
      }
      if (b.feeValue !== a.feeValue) {
        return b.feeValue - a.feeValue;
      }
      return a.id.localeCompare(b.id);
    });

    return rows;
  }

  async getPriorityTrades(actorId: string): Promise<PriorityTradeRow[]> {
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
    });

    const activeCandidates = await this.prisma.jobSeeker.findMany({
      where: {
        city: staff.city,
        status: 'active',
      },
    });

    const tradeMap = new Map<
      string,
      { trade: string; activeCandidatesCount: number; openVacancyHeadcount: number }
    >();

    for (const c of activeCandidates) {
      const key = c.tradeSkill.trim().toLowerCase();
      const existing = tradeMap.get(key) ?? {
        trade: c.tradeSkill.trim(),
        activeCandidatesCount: 0,
        openVacancyHeadcount: 0,
      };
      existing.activeCandidatesCount += 1;
      tradeMap.set(key, existing);
    }

    for (const v of openVacancies) {
      const key = v.tradeSkill.trim().toLowerCase();
      const existing = tradeMap.get(key) ?? {
        trade: v.tradeSkill.trim(),
        activeCandidatesCount: 0,
        openVacancyHeadcount: 0,
      };
      existing.openVacancyHeadcount += v.headcount;
      tradeMap.set(key, existing);
    }

    const rows: PriorityTradeRow[] = Array.from(tradeMap.values()).map((item) => {
      let status: 'candidate_surplus' | 'vacancy_surplus' | 'balanced' = 'balanced';
      if (item.activeCandidatesCount > item.openVacancyHeadcount) {
        status = 'candidate_surplus';
      } else if (item.openVacancyHeadcount > item.activeCandidatesCount) {
        status = 'vacancy_surplus';
      }

      return {
        trade: item.trade,
        tradeSkill: item.trade,
        activeCandidatesCount: item.activeCandidatesCount,
        openVacancyHeadcount: item.openVacancyHeadcount,
        status,
        surplusType: status,
      };
    });

    rows.sort((a, b) => a.trade.localeCompare(b.trade));
    return rows;
  }
}
