import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Area, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { BENGALURU_AREAS, cityForPincode } from '../screens-call-registration/bengaluru-areas';

export interface AreaActor {
  id: string;
  role: string;
}

export interface AreaInput {
  name?: unknown;
  pincode?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  active?: unknown;
}

/** The answer every registration form reads: name, typical pincode and the pin's starting point. */
export interface AreaOption {
  name: string;
  pincode: string;
  latitude: number;
  longitude: number;
}

/** Lower-case, spaces collapsed: "HSR  layout" and "HSR Layout" are the same area. */
export function areaNameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Bengaluru's rough bounding box; a centre point outside it is a typo. */
const LAT_RANGE = [12.6, 13.4] as const;
const LNG_RANGE = [77.2, 78.0] as const;

/** Tables whose rows carry an area name in `locality`. */
const LOCALITY_TABLES = ['jobSeeker', 'business', 'businessBranch', 'referral', 'vacancy'] as const;

interface Clean {
  name?: string;
  nameKey?: string;
  pincode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  active?: boolean;
}

/**
 * The Areas list (design C-Pricing-Areas). The CEO and Managers add, edit,
 * switch off and merge areas (guide, Forms: "Areas: picked from a list of
 * Bengaluru areas that the CEO and Managers manage in the Command Center").
 * Every registration form reads the active list. Areas are never deleted:
 * merging a duplicate moves every record that names it to the other area and
 * switches it off. Every change is audit-logged.
 */
@Injectable()
export class AreaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Active areas, A–Z, for the forms. Falls back to the starting list only when the table has never been filled. */
  async options(): Promise<AreaOption[]> {
    const rows = await this.prisma.area.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
    if (!rows.length && (await this.prisma.area.count()) === 0) return [...BENGALURU_AREAS];
    return rows.map((row) => ({
      name: row.name,
      pincode: row.pincode ?? '',
      latitude: row.latitude ?? 0,
      longitude: row.longitude ?? 0,
    }));
  }

  /** Every area with how many businesses, job seekers and open vacancies name it. */
  async manage(query: { search?: string; status?: string } = {}) {
    const search = typeof query.search === 'string' ? query.search.trim().toLowerCase() : '';
    const where: Prisma.AreaWhereInput = {
      ...(query.status === 'active' ? { active: true } : {}),
      ...(query.status === 'inactive' ? { active: false } : {}),
      ...(search ? { OR: [{ nameKey: { contains: search } }, { pincode: { contains: search } }] } : {}),
    };
    const [areas, businesses, seekers, vacancies] = await Promise.all([
      this.prisma.area.findMany({ where, orderBy: { name: 'asc' } }),
      this.prisma.business.groupBy({ by: ['locality'], _count: { _all: true } }),
      this.prisma.jobSeeker.groupBy({ by: ['locality'], _count: { _all: true } }),
      this.prisma.vacancy.groupBy({ by: ['locality'], where: { status: 'open' }, _count: { _all: true } }),
    ]);
    const tally = (groups: { locality: string | null; _count: { _all: number } }[]) => {
      const map = new Map<string, number>();
      for (const g of groups) {
        if (!g.locality) continue;
        const key = areaNameKey(g.locality);
        map.set(key, (map.get(key) ?? 0) + g._count._all);
      }
      return map;
    };
    const b = tally(businesses);
    const s = tally(seekers);
    const v = tally(vacancies);
    const byId = new Map(areas.map((a) => [a.id, a.name]));
    const mergedTargets = await this.mergedNames(areas, byId);
    return {
      rows: areas.map((area) => ({
        id: area.id,
        name: area.name,
        pincode: area.pincode,
        latitude: area.latitude,
        longitude: area.longitude,
        active: area.active,
        mergedInto: area.mergedIntoId ? (mergedTargets.get(area.mergedIntoId) ?? null) : null,
        businesses: b.get(area.nameKey) ?? 0,
        jobSeekers: s.get(area.nameKey) ?? 0,
        openVacancies: v.get(area.nameKey) ?? 0,
        updatedAt: area.updatedAt.toISOString(),
      })),
      total: areas.length,
    };
  }

  private async mergedNames(areas: Area[], known: Map<string, string>): Promise<Map<string, string>> {
    const missing = areas.map((a) => a.mergedIntoId).filter((id): id is string => Boolean(id) && !known.has(id as string));
    const out = new Map(known);
    if (missing.length) {
      for (const row of await this.prisma.area.findMany({ where: { id: { in: missing } }, select: { id: true, name: true } })) {
        out.set(row.id, row.name);
      }
    }
    return out;
  }

  async create(actor: AreaActor, input: AreaInput) {
    const clean = this.clean(input, true);
    await this.assertNameFree(clean.nameKey as string);
    const created = await this.prisma.area.create({
      data: {
        name: clean.name as string,
        nameKey: clean.nameKey as string,
        pincode: clean.pincode ?? null,
        latitude: clean.latitude ?? null,
        longitude: clean.longitude ?? null,
        active: clean.active ?? true,
        createdByStaffId: actor.id,
        updatedByStaffId: actor.id,
      },
    });
    await this.audit.log({
      actorId: actor.id,
      action: 'area.created',
      entityType: 'area',
      entityCode: created.id,
      after: { name: created.name, pincode: created.pincode, latitude: created.latitude, longitude: created.longitude },
    });
    return created;
  }

  async update(actor: AreaActor, id: string, input: AreaInput) {
    const before = await this.find(id);
    const clean = this.clean(input, false);
    if (clean.nameKey && clean.nameKey !== before.nameKey) await this.assertNameFree(clean.nameKey, id);
    if (clean.active === true && before.mergedIntoId) {
      throw new BadRequestException('This area was merged into another one and cannot be switched back on');
    }
    const updated = await this.prisma.area.update({
      where: { id },
      data: { ...clean, updatedByStaffId: actor.id },
    });
    if (clean.name && clean.name !== before.name) await this.renameRecords(before.name, updated.name);
    await this.audit.log({
      actorId: actor.id,
      action: 'area.updated',
      entityType: 'area',
      entityCode: id,
      before: { name: before.name, pincode: before.pincode, latitude: before.latitude, longitude: before.longitude, active: before.active },
      after: { name: updated.name, pincode: updated.pincode, latitude: updated.latitude, longitude: updated.longitude, active: updated.active },
    });
    return updated;
  }

  /**
   * Merges a duplicate ("BTM 2nd Stage") into another area ("BTM Layout"):
   * every job seeker, business, branch, referral partner and vacancy that names
   * the duplicate moves to the other area's name, and the duplicate is switched
   * off for good.
   */
  async merge(actor: AreaActor, id: string, body: { intoId?: unknown }) {
    const intoId = typeof body?.intoId === 'string' ? body.intoId : '';
    if (!intoId) throw new BadRequestException('Pick the area to merge into');
    if (intoId === id) throw new BadRequestException('An area cannot be merged into itself');
    const [from, into] = await Promise.all([this.find(id), this.find(intoId)]);
    if (!from.active) throw new BadRequestException(`${from.name} is already switched off`);
    if (!into.active) throw new BadRequestException(`${into.name} is switched off; merge into an active area`);
    const moved = await this.renameRecords(from.name, into.name);
    const updated = await this.prisma.area.update({
      where: { id },
      data: { active: false, mergedIntoId: into.id, updatedByStaffId: actor.id },
    });
    await this.audit.log({
      actorId: actor.id,
      action: 'area.merged',
      entityType: 'area',
      entityCode: id,
      before: { name: from.name, active: true },
      after: { mergedInto: into.name, active: false, moved },
    });
    return { area: updated, into: { id: into.id, name: into.name }, moved };
  }

  /** Moves every record naming `fromName` (any capitalisation) to `toName`. Returns how many moved per table. */
  private async renameRecords(fromName: string, toName: string): Promise<Record<string, number>> {
    const moved: Record<string, number> = {};
    const where = { locality: { equals: fromName, mode: 'insensitive' as const } };
    for (const table of LOCALITY_TABLES) {
      const delegate = this.prisma[table] as unknown as {
        updateMany: (args: { where: typeof where; data: { locality: string } }) => Promise<{ count: number }>;
      };
      moved[table] = (await delegate.updateMany({ where, data: { locality: toName } })).count;
    }
    moved.preferredAreas = await this.prisma.$executeRaw`
      UPDATE "JobSeeker" SET "preferredLocalities" = array_replace("preferredLocalities", ${fromName}, ${toName})
      WHERE ${fromName} = ANY("preferredLocalities")`;
    return moved;
  }

  private async find(id: string): Promise<Area> {
    const area = await this.prisma.area.findUnique({ where: { id } });
    if (!area) throw new NotFoundException('Area not found');
    return area;
  }

  private async assertNameFree(nameKey: string, exceptId?: string) {
    const existing = await this.prisma.area.findUnique({ where: { nameKey } });
    if (existing && existing.id !== exceptId) {
      throw new ConflictException(`"${existing.name}" is already on the list${existing.active ? '' : ' (switched off)'}`);
    }
  }

  private clean(input: AreaInput, creating: boolean): Clean {
    const out: Clean = {};
    if (creating || input.name !== undefined) {
      if (typeof input.name !== 'string' || !input.name.trim()) throw new BadRequestException('Area name is required');
      const name = input.name.trim().replace(/\s+/g, ' ');
      if (name.length < 2 || name.length > 60) throw new BadRequestException('Area name must be 2 to 60 characters');
      out.name = name;
      out.nameKey = areaNameKey(name);
    }
    if (creating || input.pincode !== undefined) {
      if (input.pincode === null || input.pincode === '') {
        if (creating) throw new BadRequestException('Pincode is required');
        out.pincode = null;
      } else {
        const pin = String(input.pincode).trim();
        if (!cityForPincode(pin)) throw new BadRequestException('Pincode must be a Bengaluru pincode (560001–560300)');
        out.pincode = pin;
      }
    }
    for (const [field, range] of [
      ['latitude', LAT_RANGE],
      ['longitude', LNG_RANGE],
    ] as const) {
      const raw = input[field];
      if (raw === undefined) {
        if (creating) throw new BadRequestException(`The centre point (${field}) is required`);
        continue;
      }
      const value = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(value) || value < range[0] || value > range[1]) {
        throw new BadRequestException(`The centre point must be inside Bengaluru (${field} ${range[0]}–${range[1]})`);
      }
      out[field] = value;
    }
    if (input.active !== undefined) {
      if (typeof input.active !== 'boolean') throw new BadRequestException('active must be true or false');
      out.active = input.active;
    }
    if (!creating && !Object.keys(out).length) throw new BadRequestException('Nothing to change');
    return out;
  }
}
