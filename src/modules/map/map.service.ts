import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { jobSeekerHasTrade } from '../job-seeker/job-seeker-legacy-read';
import { MapBounds, MapCandidateCell, MapPoints } from './map.types';

type MappableSeeker = {
  id: string;
  latitude: number | null;
  longitude: number | null;
  tradeSkill: string | null;
  trades: Array<{ trade: string; isPrimary: boolean }>;
};

@Injectable()
export class MapService {
  constructor(private readonly prisma: PrismaService) {}

  async points(bboxValue: string | undefined, tradeValue?: string): Promise<MapPoints> {
    const bounds = parseBounds(bboxValue);
    const trade = tradeValue?.trim() || undefined;
    if (trade && (trade.length > 100 || /[<>\u0000-\u001f]/.test(trade))) {
      throw new BadRequestException('trade must be a valid trade name');
    }

    const coordinateFilter = coordinateWhere(bounds);
    const businesses = await this.prisma.business.findMany({
      where: { ...coordinateFilter, erasedAt: null },
      select: {
        id: true,
        code: true,
        name: true,
        latitude: true,
        longitude: true,
        verificationStatus: true,
        accountAgentId: true,
      },
      orderBy: { name: 'asc' },
    });
    const agentIds = [...new Set(businesses.flatMap(({ accountAgentId }) => accountAgentId ? [accountAgentId] : []))];
    const agents = agentIds.length
      ? await this.prisma.staff.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true } })
      : [];
    const agentNames = new Map(agents.map(({ id, name }) => [id, name]));

    const vacancies = await this.prisma.vacancy.findMany({
      where: {
        ...coordinateFilter,
        status: 'open',
        ...(trade ? { tradeSkill: { equals: trade, mode: Prisma.QueryMode.insensitive } } : {}),
      },
      select: {
        id: true,
        code: true,
        latitude: true,
        longitude: true,
        roleTitle: true,
        tradeSkill: true,
        salaryMinPaise: true,
        salaryMaxPaise: true,
      },
      orderBy: { code: 'asc' },
    });

    const activeConsentRows = await this.prisma.consent.findMany({
      where: {
        subjectType: 'job_seeker',
        purpose: 'job_matching',
        granted: true,
        grantedAt: { not: null },
        withdrawnAt: null,
      },
      select: { subjectId: true },
    });
    const consentedIds = [...new Set(activeConsentRows.map(({ subjectId }) => subjectId))];
    const seekers: MappableSeeker[] = consentedIds.length
      ? await this.prisma.jobSeeker.findMany({
        where: { id: { in: consentedIds }, status: 'active', ...coordinateFilter },
        select: { id: true, latitude: true, longitude: true, tradeSkill: true, trades: { select: { trade: true, isPrimary: true } } },
      })
      : [];

    const candidateCells = aggregateCandidateCells(seekers, trade);
    return {
      businesses: businesses.flatMap((business) => {
        if (business.latitude === null || business.longitude === null) return [];
        return [{
          id: business.id,
          code: business.code,
          name: business.name,
          latitude: business.latitude,
          longitude: business.longitude,
          verificationStatus: business.verificationStatus,
          accountAgentName: business.accountAgentId ? agentNames.get(business.accountAgentId) ?? null : null,
        }];
      }),
      vacancies: vacancies.flatMap((vacancy) => {
        if (vacancy.latitude === null || vacancy.longitude === null) return [];
        return [{
          id: vacancy.id,
          code: vacancy.code,
          latitude: vacancy.latitude,
          longitude: vacancy.longitude,
          roleTitle: vacancy.roleTitle,
          trade: vacancy.tradeSkill,
          salaryMinPaise: vacancy.salaryMinPaise,
          salaryMaxPaise: vacancy.salaryMaxPaise,
        }];
      }),
      candidateCells,
    };
  }
}

export function parseBounds(value: string | undefined): MapBounds {
  const parts = value?.split(',').map((part) => Number(part));
  if (!parts || parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    throw new BadRequestException('bbox must be west,south,east,north');
  }
  const [west, south, east, north] = parts;
  if (west < -180 || east > 180 || south < -90 || north > 90 || west > east || south > north) {
    throw new BadRequestException('bbox coordinates are out of range or reversed');
  }
  return { west, south, east, north };
}

function coordinateWhere(bounds: MapBounds): {
  latitude: Prisma.FloatNullableFilter;
  longitude: Prisma.FloatNullableFilter;
} {
  return {
    latitude: { gte: bounds.south, lte: bounds.north },
    longitude: { gte: bounds.west, lte: bounds.east },
  };
}

function aggregateCandidateCells(seekers: MappableSeeker[], tradeFilter?: string): MapCandidateCell[] {
  const cells = new Map<string, MapCandidateCell>();
  for (const seeker of seekers) {
    if (seeker.latitude === null || seeker.longitude === null) continue;
    if (tradeFilter && !jobSeekerHasTrade(seeker, tradeFilter)) continue;

    const latitude = roundCoordinate(seeker.latitude);
    const longitude = roundCoordinate(seeker.longitude);
    const key = `${latitude},${longitude}`;
    const cell = cells.get(key) ?? { latitude, longitude, count: 0, trades: [] };
    cell.count += 1;
    const currentTrades = seeker.trades.length ? seeker.trades.map(({ trade }) => trade) : [seeker.tradeSkill].filter(isNonEmptyString);
    for (const currentTrade of currentTrades) {
      const visibleTrade = tradeFilter
        ? currentTrade.trim().toLowerCase() === tradeFilter.trim().toLowerCase() ? currentTrade.trim() : null
        : currentTrade.trim();
      if (visibleTrade && !cell.trades.some((existing) => existing.toLowerCase() === visibleTrade.toLowerCase())) {
        cell.trades.push(visibleTrade);
      }
    }
    cells.set(key, cell);
  }
  return [...cells.values()].sort((a, b) => a.latitude - b.latitude || a.longitude - b.longitude)
    .map((cell) => ({ ...cell, trades: cell.trades.sort((a, b) => a.localeCompare(b)) }));
}

function roundCoordinate(value: number): number {
  return Number(value.toFixed(2));
}

function isNonEmptyString(value: string | null): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
