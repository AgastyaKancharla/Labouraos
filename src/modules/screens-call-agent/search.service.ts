import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { maskPhoneLast4 } from '../../common/rbac/pii-masking.interceptor';
import { ALL_STAFF_ROLES } from '../../common/rbac/rbac.types';

export type SearchType = 'job_seeker' | 'business' | 'referral' | 'vacancy' | 'placement';
export const SEARCH_TYPES: readonly SearchType[] = ['job_seeker', 'business', 'referral', 'vacancy', 'placement'];

const PREFIX_TYPE: Record<string, SearchType> = {
  JS: 'job_seeker',
  BZ: 'business',
  RF: 'referral',
  VC: 'vacancy',
  PL: 'placement',
};

export interface ParsedQuery {
  kind: 'id' | 'phone' | 'name';
  /** For an ID: the type it names, and the code text to look for. */
  idType?: SearchType;
  code?: string;
  /** For a phone: the digits to match at the end of the stored number. */
  digits?: string;
  name?: string;
}

/**
 * Reads what was typed into the search bar (Master Guide, "Search on every
 * screen"): an ID (JS-, BZ-, RF-, VC-, PL-, with or without the zero
 * padding), a mobile number (full, with or without +91, or the last 4
 * digits), or a name.
 */
export function parseSearchQuery(raw: string): ParsedQuery | null {
  const q = raw.trim().replace(/\s+/g, ' ');
  if (!q) return null;
  const id = /^(JS|BZ|RF|VC|PL)[-\s]?(\d*)$/i.exec(q);
  if (id) {
    const prefix = id[1]!.toUpperCase();
    const number = id[2] ?? '';
    const code = number.length > 0 && number.length < 5 ? `${prefix}-${number.padStart(5, '0')}` : `${prefix}-${number}`;
    return { kind: 'id', idType: PREFIX_TYPE[prefix], code };
  }
  const digitsOnly = q.replace(/[\s()+-]/g, '');
  if (/^\d+$/.test(digitsOnly)) {
    if (digitsOnly.length < 4) return null;
    return { kind: 'phone', digits: digitsOnly.length > 10 ? digitsOnly.slice(-10) : digitsOnly };
  }
  if (q.length < 2) return null;
  return { kind: 'name', name: q };
}

export interface SearchRow {
  type: SearchType;
  id: string;
  code: string;
  name: string;
  maskedPhone: string | null;
  status: string | null;
  trade: string | null;
  locality: string | null;
  /** Where to open it: the person's or business's code. */
  openRef: string;
  extra: Record<string, string | number | null>;
}

const PER_TYPE = 10;
const ONE_TYPE_LIMIT = 50;

/**
 * One search across job seekers, businesses, referral partners, vacancies
 * and placements, scoped to what the role may see (AGENTS.md §7): a Team Lead
 * sees their own team's records, everyone else city-wide. Phone numbers are
 * always returned as the last 4 digits. No money fields.
 */
@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  private async teamIds(user: JwtPayload): Promise<string[] | null> {
    if (user.role !== 'team_lead') return null;
    const team = await this.prisma.staff.findMany({
      where: { OR: [{ id: user.sub }, { teamLeadId: user.sub }, { reportsToId: user.sub }] },
      select: { id: true },
    });
    return team.map((t) => t.id);
  }

  async search(user: JwtPayload, raw: string, onlyType?: string) {
    if (!(ALL_STAFF_ROLES as readonly string[]).includes(user.role)) {
      throw new BadRequestException('Unknown role');
    }
    if (onlyType && !(SEARCH_TYPES as readonly string[]).includes(onlyType)) {
      throw new BadRequestException(`type must be one of ${SEARCH_TYPES.join(', ')}`);
    }
    const parsed = parseSearchQuery(raw ?? '');
    const empty = { query: raw ?? '', kind: null, counts: zeroCounts(), results: [] as SearchRow[] };
    if (!parsed) return empty;
    const team = await this.teamIds(user);
    const types = (onlyType ? [onlyType] : SEARCH_TYPES) as SearchType[];
    const wanted = types.filter((t) => parsed.kind !== 'id' || parsed.idType === t);
    const limit = onlyType ? ONE_TYPE_LIMIT : PER_TYPE;

    const results: SearchRow[] = [];
    const counts = zeroCounts();
    await Promise.all(
      wanted.map(async (type) => {
        const { rows, total } = await this.searchType(type, parsed, team, limit);
        counts[type] = total;
        results.push(...rows);
      }),
    );
    counts.all = SEARCH_TYPES.reduce((sum, t) => sum + counts[t], 0);
    const order = new Map(SEARCH_TYPES.map((t, i) => [t, i]));
    results.sort((a, b) => order.get(a.type)! - order.get(b.type)! || a.name.localeCompare(b.name));
    return { query: raw, kind: parsed.kind, counts, results };
  }

  private async searchType(type: SearchType, q: ParsedQuery, team: string[] | null, limit: number) {
    switch (type) {
      case 'job_seeker':
        return this.jobSeekers(q, team, limit);
      case 'business':
        return this.businesses(q, team, limit);
      case 'referral':
        return this.referrals(q, team, limit);
      case 'vacancy':
        return this.vacancies(q, team, limit);
      default:
        return this.placements(q, team, limit);
    }
  }

  private codeWhere(q: ParsedQuery) {
    return q.code!.endsWith('-') ? { startsWith: q.code! } : { equals: q.code! };
  }

  private async jobSeekers(q: ParsedQuery, team: string[] | null, limit: number) {
    const match: Prisma.JobSeekerWhereInput =
      q.kind === 'id'
        ? { code: this.codeWhere(q) }
        : q.kind === 'phone'
          ? { phone: { endsWith: q.digits! } }
          : { name: { contains: q.name!, mode: 'insensitive' } };
    const where: Prisma.JobSeekerWhereInput = {
      AND: [match, { anonymisedAt: null }, ...(team ? [{ registeredByStaffId: { in: team } }] : [])],
    };
    const [rows, total] = await Promise.all([
      this.prisma.jobSeeker.findMany({
        where,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          code: true,
          name: true,
          phone: true,
          status: true,
          locality: true,
          paymentReceivedAt: true,
          trades: { select: { trade: true, isPrimary: true } },
        },
      }),
      this.prisma.jobSeeker.count({ where }),
    ]);
    return {
      total,
      rows: rows.map(
        (r): SearchRow => ({
          type: 'job_seeker',
          id: r.id,
          code: r.code,
          name: r.name,
          maskedPhone: maskPhoneLast4(r.phone),
          status: r.status,
          trade: r.trades.find((t) => t.isPrimary)?.trade ?? r.trades[0]?.trade ?? null,
          locality: r.locality,
          openRef: r.code,
          extra: { paidAt: r.paymentReceivedAt?.toISOString() ?? null },
        }),
      ),
    };
  }

  private async businesses(q: ParsedQuery, team: string[] | null, limit: number) {
    const match: Prisma.BusinessWhereInput =
      q.kind === 'id'
        ? { code: this.codeWhere(q) }
        : q.kind === 'phone'
          ? { phone: { endsWith: q.digits! } }
          : {
              OR: [
                { name: { contains: q.name!, mode: 'insensitive' } },
                { ownerName: { contains: q.name!, mode: 'insensitive' } },
              ],
            };
    const where: Prisma.BusinessWhereInput = {
      AND: [
        match,
        { anonymisedAt: null },
        ...(team ? [{ OR: [{ accountAgentId: { in: team } }, { leadCreatedByStaffId: { in: team } }] }] : []),
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.business.findMany({
        where,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          code: true,
          name: true,
          phone: true,
          verificationStatus: true,
          locality: true,
          businessType: true,
          _count: { select: { vacancies: { where: { status: 'open' } } } },
        },
      }),
      this.prisma.business.count({ where }),
    ]);
    return {
      total,
      rows: rows.map(
        (r): SearchRow => ({
          type: 'business',
          id: r.id,
          code: r.code,
          name: r.name,
          maskedPhone: maskPhoneLast4(r.phone),
          status: r.verificationStatus,
          trade: r.businessType,
          locality: r.locality,
          openRef: r.code,
          extra: { openVacancies: r._count.vacancies },
        }),
      ),
    };
  }

  private async referrals(q: ParsedQuery, team: string[] | null, limit: number) {
    const match: Prisma.ReferralWhereInput =
      q.kind === 'id'
        ? { code: this.codeWhere(q) }
        : q.kind === 'phone'
          ? { phone: { endsWith: q.digits! } }
          : { name: { contains: q.name!, mode: 'insensitive' } };
    // A Team Lead's referral partners: those whose referred job seekers the team registered.
    const where: Prisma.ReferralWhereInput = {
      AND: [match, { anonymisedAt: null }, ...(team ? [{ jobSeekers: { some: { registeredByStaffId: { in: team } } } }] : [])],
    };
    const [rows, total] = await Promise.all([
      this.prisma.referral.findMany({
        where,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          code: true,
          name: true,
          phone: true,
          type: true,
          locality: true,
          individualRole: true,
          partnerBusinessType: true,
          jobSeekers: { select: { status: true } },
        },
      }),
      this.prisma.referral.count({ where }),
    ]);
    return {
      total,
      rows: rows.map(
        (r): SearchRow => ({
          type: 'referral',
          id: r.id,
          code: r.code,
          name: r.name,
          maskedPhone: maskPhoneLast4(r.phone),
          status: r.type,
          trade: r.individualRole ?? r.partnerBusinessType,
          locality: r.locality,
          openRef: r.code,
          extra: { referred: r.jobSeekers.length, joined: r.jobSeekers.filter((j) => j.status === 'placed').length },
        }),
      ),
    };
  }

  private async vacancies(q: ParsedQuery, team: string[] | null, limit: number) {
    if (q.kind === 'phone') return { total: 0, rows: [] as SearchRow[] };
    const match: Prisma.VacancyWhereInput =
      q.kind === 'id'
        ? { code: this.codeWhere(q) }
        : {
            OR: [
              { tradeSkill: { contains: q.name!, mode: 'insensitive' } },
              { roleTitle: { contains: q.name!, mode: 'insensitive' } },
              { business: { name: { contains: q.name!, mode: 'insensitive' } } },
            ],
          };
    const where: Prisma.VacancyWhereInput = {
      AND: [
        match,
        ...(team ? [{ OR: [{ capturedByStaffId: { in: team } }, { business: { accountAgentId: { in: team } } }] }] : []),
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.vacancy.findMany({
        where,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          code: true,
          tradeSkill: true,
          roleTitle: true,
          status: true,
          locality: true,
          headcount: true,
          business: { select: { code: true, name: true } },
        },
      }),
      this.prisma.vacancy.count({ where }),
    ]);
    return {
      total,
      rows: rows.map(
        (r): SearchRow => ({
          type: 'vacancy',
          id: r.id,
          code: r.code,
          name: `${r.roleTitle ?? r.tradeSkill} · ${r.business.name}`,
          maskedPhone: null,
          status: r.status,
          trade: r.tradeSkill,
          locality: r.locality,
          openRef: r.business.code,
          extra: { headcount: r.headcount, businessCode: r.business.code },
        }),
      ),
    };
  }

  private async placements(q: ParsedQuery, team: string[] | null, limit: number) {
    if (q.kind === 'phone') return { total: 0, rows: [] as SearchRow[] };
    const match: Prisma.PlacementWhereInput =
      q.kind === 'id'
        ? { code: this.codeWhere(q) }
        : {
            OR: [
              { jobSeeker: { name: { contains: q.name!, mode: 'insensitive' } } },
              { business: { name: { contains: q.name!, mode: 'insensitive' } } },
            ],
          };
    const where: Prisma.PlacementWhereInput = {
      AND: [match, ...(team ? [{ createdByStaffId: { in: team } }] : [])],
    };
    const [rows, total] = await Promise.all([
      this.prisma.placement.findMany({
        where,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          code: true,
          status: true,
          joinedDate: true,
          jobSeeker: { select: { code: true, name: true } },
          business: { select: { code: true, name: true } },
          vacancy: { select: { tradeSkill: true } },
        },
      }),
      this.prisma.placement.count({ where }),
    ]);
    return {
      total,
      rows: rows.map(
        (r): SearchRow => ({
          type: 'placement',
          id: r.id,
          code: r.code,
          name: `${r.jobSeeker.name} · ${r.business.name}`,
          maskedPhone: null,
          status: r.status,
          trade: r.vacancy.tradeSkill,
          locality: null,
          openRef: r.jobSeeker.code,
          extra: { joinedDate: r.joinedDate?.toISOString() ?? null, businessCode: r.business.code },
        }),
      ),
    };
  }
}

function zeroCounts(): Record<'all' | SearchType, number> {
  return { all: 0, job_seeker: 0, business: 0, referral: 0, vacancy: 0, placement: 0 };
}
