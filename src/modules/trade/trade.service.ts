import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { PricingService } from '../pricing/pricing.service';

type GuaranteeFloorChange = {
  id: string;
  code: string;
  city: string;
  beforePaise: number | null;
  afterPaise: number | null;
};

export type MinimumWageLevel = 'unskilled' | 'semi_skilled' | 'skilled' | 'highly_skilled';

export interface CreateTradeInput {
  name: string;
  salaryMinPaise: number;
  salaryMaxPaise: number;
  minimumWageLevel?: MinimumWageLevel;
  sortOrder?: number;
}

const MINIMUM_WAGE_LEVELS: MinimumWageLevel[] = ['unskilled', 'semi_skilled', 'skilled', 'highly_skilled'];

export function normalizeTradeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function tradeNameKey(value: string): string {
  return normalizeTradeName(value).toLocaleLowerCase('en-IN');
}

@Injectable()
export class TradeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly pricingService: PricingService,
  ) {}

  async listActive(policy: {
    legalMinimumWageUnskilledPaise: number;
    legalMinimumWageSemiSkilledPaise: number;
    legalMinimumWageSkilledPaise: number;
    legalMinimumWageHighlySkilledPaise: number;
    legalMinimumWageEffectiveFrom: Date;
  }) {
    const wages: Record<MinimumWageLevel, number> = {
      unskilled: policy.legalMinimumWageUnskilledPaise,
      semi_skilled: policy.legalMinimumWageSemiSkilledPaise,
      skilled: policy.legalMinimumWageSkilledPaise,
      highly_skilled: policy.legalMinimumWageHighlySkilledPaise,
    };
    const trades = await this.prisma.trade.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return trades.map((trade) => ({
      id: trade.id,
      name: trade.name,
      salaryMinPaise: trade.salaryMinPaise,
      salaryMaxPaise: trade.salaryMaxPaise,
      minimumWageLevel: trade.minimumWageLevel,
      legalMinimumPaise: wages[trade.minimumWageLevel as MinimumWageLevel],
      effectiveFrom: policy.legalMinimumWageEffectiveFrom,
    }));
  }

  listAll() {
    return this.prisma.trade.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  }

  async listSuggestions(status = 'waiting') {
    return this.prisma.tradeSuggestion.findMany({
      where: status === 'all' ? undefined : { status },
      include: { subjects: true, mappedToTrade: true },
      orderBy: [{ createdAt: 'asc' }, { typedName: 'asc' }],
    });
  }

  async createTrade(input: CreateTradeInput, actorId: string, suggestionId?: string) {
    const data = this.validateTradeInput(input);
    const nameKey = tradeNameKey(data.name);
    const result = await this.prisma.$transaction(async (tx) => {
      let created;
      try {
        created = await tx.trade.create({ data: { ...data, nameKey } });
      } catch (error: unknown) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException(`Trade '${data.name}' already exists`);
        }
        throw error;
      }

      if (suggestionId) {
        const suggestion = await tx.tradeSuggestion.findUnique({ where: { id: suggestionId } });
        if (!suggestion) throw new NotFoundException(`Trade suggestion '${suggestionId}' not found`);
        if (suggestion.status !== 'waiting') throw new BadRequestException('Only a waiting suggestion can be added');
        await tx.tradeSuggestion.update({
          where: { id: suggestion.id },
          data: { status: 'added', mappedToTradeId: created.id, decidedByStaffId: actorId, decidedAt: new Date() },
        });
      }

      const floorChanges = await this.recalculatePrimaryFloors(tx, created.name, created.salaryMaxPaise);
      return { created, floorChanges };
    });
    await this.auditTradeFloorChanges(actorId, result.floorChanges);
    await this.auditService.log({
      actorId,
      action: suggestionId ? 'trade.suggestion_added' : 'trade.created',
      entityType: 'trade',
      entityCode: result.created.id,
      after: result.created as unknown as Record<string, unknown>,
      changedFields: ['name', 'salaryMinPaise', 'salaryMaxPaise', 'minimumWageLevel', 'active'],
      city: 'Bengaluru',
    });
    return result.created;
  }

  async updateTrade(id: string, updates: Partial<CreateTradeInput> & { active?: boolean }, actorId: string) {
    const before = await this.prisma.trade.findUnique({ where: { id } });
    if (!before) throw new NotFoundException(`Trade '${id}' not found`);
    const validated = this.validateTradeInput({
      name: updates.name ?? before.name,
      salaryMinPaise: updates.salaryMinPaise ?? before.salaryMinPaise,
      salaryMaxPaise: updates.salaryMaxPaise ?? before.salaryMaxPaise,
      minimumWageLevel: updates.minimumWageLevel ?? before.minimumWageLevel as MinimumWageLevel,
      sortOrder: updates.sortOrder ?? before.sortOrder,
    });
    const result = await this.prisma.$transaction(async (tx) => {
      const next = await tx.trade.update({
        where: { id },
        data: { ...validated, nameKey: tradeNameKey(validated.name), ...(updates.active === undefined ? {} : { active: updates.active }) },
      });
      if (tradeNameKey(before.name) !== tradeNameKey(next.name)) {
        await tx.jobSeekerTrade.updateMany({
          where: { trade: { equals: before.name, mode: 'insensitive' } },
          data: { trade: next.name },
        });
        await tx.vacancy.updateMany({
          where: { tradeSkill: { equals: before.name, mode: 'insensitive' } },
          data: { tradeSkill: next.name },
        });
      }
      const floorChanges = await this.recalculatePrimaryFloors(
        tx,
        next.name,
        next.active ? next.salaryMaxPaise : null,
      );
      return { next, floorChanges };
    }).catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(`Trade '${validated.name}' already exists`);
      }
      throw error;
    });
    const updated = result.next;
    await this.auditTradeFloorChanges(actorId, result.floorChanges);
    await this.auditService.log({
      actorId,
      action: 'trade.updated',
      entityType: 'trade',
      entityCode: updated.id,
      before: before as unknown as Record<string, unknown>,
      after: updated as unknown as Record<string, unknown>,
      city: 'Bengaluru',
    });
    return updated;
  }

  async deactivate(id: string, actorId: string) {
    return this.updateTrade(id, { active: false }, actorId);
  }

  async addSuggestion(suggestionId: string, input: Omit<CreateTradeInput, 'name'>, actorId: string) {
    const suggestion = await this.prisma.tradeSuggestion.findUnique({ where: { id: suggestionId } });
    if (!suggestion) throw new NotFoundException(`Trade suggestion '${suggestionId}' not found`);
    if (suggestion.status !== 'waiting') throw new BadRequestException('Only a waiting suggestion can be added');
    return this.createTrade({ ...input, name: suggestion.typedName }, actorId, suggestionId);
  }

  async mapSuggestion(suggestionId: string, tradeId: string, actorId: string) {
    const [suggestion, trade] = await Promise.all([
      this.prisma.tradeSuggestion.findUnique({ where: { id: suggestionId } }),
      this.prisma.trade.findUnique({ where: { id: tradeId } }),
    ]);
    if (!suggestion) throw new NotFoundException(`Trade suggestion '${suggestionId}' not found`);
    if (!trade || !trade.active) throw new NotFoundException(`Active trade '${tradeId}' not found`);
    if (suggestion.status !== 'waiting') throw new BadRequestException('Only a waiting suggestion can be mapped');

    const result = await this.prisma.$transaction(async (tx) => {
      const seekerTrades = await tx.jobSeekerTrade.updateMany({
        where: { trade: { equals: suggestion.typedName, mode: 'insensitive' } },
        data: { trade: trade.name },
      });
      const vacancies = await tx.vacancy.updateMany({
        where: { tradeSkill: { equals: suggestion.typedName, mode: 'insensitive' } },
        data: { tradeSkill: trade.name },
      });
      const updated = await tx.tradeSuggestion.update({
        where: { id: suggestion.id },
        data: { status: 'mapped', mappedToTradeId: trade.id, decidedByStaffId: actorId, decidedAt: new Date() },
      });
      const floorChanges = await this.recalculatePrimaryFloors(tx, trade.name, trade.salaryMaxPaise);
      return { suggestion: updated, seekerTradesRewritten: seekerTrades.count, vacanciesRewritten: vacancies.count, floorChanges };
    });

    await this.auditTradeFloorChanges(actorId, result.floorChanges);

    await this.auditService.log({
      actorId,
      action: 'trade.suggestion_mapped',
      entityType: 'trade_suggestion',
      entityCode: suggestion.id,
      before: { status: suggestion.status, typedName: suggestion.typedName },
      after: { status: result.suggestion.status, mappedToTradeId: trade.id, tradeName: trade.name,
        seekerTradesRewritten: result.seekerTradesRewritten, vacanciesRewritten: result.vacanciesRewritten },
      changedFields: ['status', 'mappedToTradeId', 'jobSeekerTrades', 'vacancies'],
      reason: `Mapped '${suggestion.typedName}' to '${trade.name}'`,
      city: 'Bengaluru',
    });
    return {
      suggestion: result.suggestion,
      seekerTradesRewritten: result.seekerTradesRewritten,
      vacanciesRewritten: result.vacanciesRewritten,
    };
  }

  async dismissSuggestion(suggestionId: string, actorId: string) {
    const suggestion = await this.prisma.tradeSuggestion.findUnique({ where: { id: suggestionId } });
    if (!suggestion) throw new NotFoundException(`Trade suggestion '${suggestionId}' not found`);
    if (suggestion.status !== 'waiting') throw new BadRequestException('Only a waiting suggestion can be dismissed');
    const updated = await this.prisma.tradeSuggestion.update({
      where: { id: suggestion.id },
      data: { status: 'dismissed', decidedByStaffId: actorId, decidedAt: new Date() },
    });
    await this.auditService.log({
      actorId, action: 'trade.suggestion_dismissed', entityType: 'trade_suggestion', entityCode: suggestion.id,
      before: { status: suggestion.status }, after: { status: updated.status }, changedFields: ['status'], city: 'Bengaluru',
    });
    return updated;
  }

  async recordSuggestion(
    tx: Prisma.TransactionClient,
    typedName: string,
    typedByStaffId: string | null,
    subjectType: 'job_seeker' | 'vacancy',
    subjectId: string,
  ): Promise<void> {
    const normalizedName = normalizeTradeName(typedName);
    if (!normalizedName) return;
    const nameKey = tradeNameKey(normalizedName);
    const listed = await tx.trade.findUnique({ where: { nameKey } });
    if (listed?.active) return;

    const suggestion = await tx.tradeSuggestion.upsert({
      where: { typedNameKey: nameKey },
      create: {
        typedName: normalizedName,
        typedNameKey: nameKey,
        typedByStaffId,
        subjectType,
        subjectId,
        status: 'waiting',
      },
      update: {},
    });
    await tx.tradeSuggestionSubject.upsert({
      where: { tradeSuggestionId_subjectType_subjectId: { tradeSuggestionId: suggestion.id, subjectType, subjectId } },
      create: { tradeSuggestionId: suggestion.id, subjectType, subjectId },
      update: {},
    });
  }

  private async recalculatePrimaryFloors(
    tx: Prisma.TransactionClient,
    tradeName: string,
    salaryMaxPaise: number | null,
  ): Promise<GuaranteeFloorChange[]> {
    const policy = await this.pricingService.current();
    const seekers = await tx.jobSeeker.findMany({
      where: {
        paymentReceivedAt: null,
        trades: { some: { trade: { equals: tradeName, mode: 'insensitive' }, isPrimary: true } },
      },
      select: { id: true, code: true, city: true, minSalary: true, salaryPeriod: true, guaranteeFloorPaise: true },
    });
    const changes: GuaranteeFloorChange[] = [];
    for (const seeker of seekers) {
      const monthlyMinimum = seeker.salaryPeriod === 'daily'
        ? seeker.minSalary * policy.salaryDaysPerMonth
        : seeker.minSalary;
      if (!Number.isSafeInteger(monthlyMinimum)) {
        throw new BadRequestException(`Monthly salary conversion is outside the supported range for ${seeker.code}`);
      }
      const nextFloor = salaryMaxPaise === null ? null : Math.min(monthlyMinimum, salaryMaxPaise);
      if (seeker.guaranteeFloorPaise === nextFloor) continue;
      await tx.jobSeeker.update({ where: { id: seeker.id }, data: { guaranteeFloorPaise: nextFloor } });
      changes.push({
        id: seeker.id,
        code: seeker.code,
        city: seeker.city,
        beforePaise: seeker.guaranteeFloorPaise,
        afterPaise: nextFloor,
      });
    }
    return changes;
  }

  private async auditTradeFloorChanges(actorId: string, changes: GuaranteeFloorChange[]) {
    for (const change of changes) {
      await this.auditService.log({
        actorId,
        action: 'job_seeker.guarantee_floor_recalculated',
        entityType: 'job_seeker',
        entityCode: change.code,
        before: { guaranteeFloorPaise: change.beforePaise },
        after: { guaranteeFloorPaise: change.afterPaise },
        changedFields: ['guaranteeFloorPaise'],
        city: change.city,
      });
    }
  }

  async listUnlistedReport() {
    const [seekerRows, vacancyRows, trades] = await Promise.all([
      this.prisma.jobSeekerTrade.findMany({ select: { trade: true } }),
      this.prisma.vacancy.findMany({ select: { tradeSkill: true } }),
      this.prisma.trade.findMany({ where: { active: true }, select: { nameKey: true } }),
    ]);
    const listed = new Set(trades.map((trade) => trade.nameKey));
    const counts = new Map<string, { tradeName: string; jobSeekerCount: number; vacancyCount: number }>();
    const add = (name: string, kind: 'jobSeekerCount' | 'vacancyCount') => {
      const normalized = normalizeTradeName(name);
      const key = tradeNameKey(normalized);
      if (!normalized || listed.has(key)) return;
      const row = counts.get(key) ?? { tradeName: normalized, jobSeekerCount: 0, vacancyCount: 0 };
      row[kind] += 1;
      counts.set(key, row);
    };
    seekerRows.forEach(({ trade }) => add(trade, 'jobSeekerCount'));
    vacancyRows.forEach(({ tradeSkill }) => add(tradeSkill, 'vacancyCount'));
    return [...counts.values()].sort((a, b) => a.tradeName.localeCompare(b.tradeName));
  }

  private validateTradeInput(input: CreateTradeInput): {
    name: string; salaryMinPaise: number; salaryMaxPaise: number; minimumWageLevel: MinimumWageLevel; sortOrder: number;
  } {
    const name = normalizeTradeName(input.name ?? '');
    if (!name) throw new BadRequestException('name is required');
    if (!Number.isSafeInteger(input.salaryMinPaise) || input.salaryMinPaise <= 0) {
      throw new BadRequestException('salaryMinPaise must be a positive integer in paise');
    }
    if (!Number.isSafeInteger(input.salaryMaxPaise) || input.salaryMaxPaise < input.salaryMinPaise) {
      throw new BadRequestException('salaryMaxPaise must be an integer at least salaryMinPaise');
    }
    const minimumWageLevel = input.minimumWageLevel ?? 'unskilled';
    if (!MINIMUM_WAGE_LEVELS.includes(minimumWageLevel)) throw new BadRequestException('minimumWageLevel is invalid');
    const sortOrder = input.sortOrder ?? 0;
    if (!Number.isInteger(sortOrder) || sortOrder < 0) throw new BadRequestException('sortOrder must be a non-negative integer');
    return { name, salaryMinPaise: input.salaryMinPaise, salaryMaxPaise: input.salaryMaxPaise, minimumWageLevel, sortOrder };
  }
}
