import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { ipInCidr, normalizeIp, parseCidr } from './office-network.cidr';

export interface OfficeActor {
  id: string;
  role: string;
}

@Injectable()
export class OfficeNetworkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * True only when the address falls inside an active office range.
   * No ranges, a blank address, or an address that is not an IP: false.
   */
  async isOnOfficeNetwork(ip: string): Promise<boolean> {
    const address = normalizeIp(ip ?? '');
    if (!address) {
      return false;
    }
    const ranges = await this.prisma.officeNetwork.findMany({
      where: { active: true },
      select: { cidr: true },
    });
    if (ranges.length === 0) {
      return false;
    }
    return ranges.some((range) => ipInCidr(address, range.cidr));
  }

  async list(actor: OfficeActor) {
    this.assertManager(actor);
    const rows = await this.prisma.officeNetwork.findMany({
      orderBy: { createdAt: 'asc' },
    });
    await this.auditService.log({
      actorId: actor.id,
      action: 'office_network.listed',
      entityType: 'office_network',
      entityCode: 'list',
      after: { count: rows.length },
    });
    return rows;
  }

  async add(actor: OfficeActor, label: string, cidr: string) {
    this.assertManager(actor);
    const trimmedLabel = label?.trim();
    const trimmedCidr = cidr?.trim();
    if (!trimmedLabel) {
      throw new BadRequestException('label is required');
    }
    if (!trimmedCidr || !parseCidr(trimmedCidr)) {
      throw new BadRequestException('cidr must be an IPv4 or IPv6 range such as 203.0.113.0/24');
    }
    const row = await this.prisma.officeNetwork.create({
      data: {
        label: trimmedLabel,
        cidr: trimmedCidr,
        active: true,
        addedByStaffId: actor.id,
      },
    });
    await this.auditService.log({
      actorId: actor.id,
      action: 'office_network.added',
      entityType: 'office_network',
      entityCode: row.id,
      after: { label: row.label, cidr: row.cidr, active: true },
    });
    return row;
  }

  async deactivate(actor: OfficeActor, id: string) {
    this.assertManager(actor);
    const existing = await this.prisma.officeNetwork.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Office network '${id}' not found`);
    }
    if (!existing.active) {
      return existing;
    }
    const row = await this.prisma.officeNetwork.update({
      where: { id },
      data: { active: false },
    });
    await this.auditService.log({
      actorId: actor.id,
      action: 'office_network.deactivated',
      entityType: 'office_network',
      entityCode: row.id,
      before: { active: true, cidr: existing.cidr },
      after: { active: false, cidr: row.cidr },
    });
    return row;
  }

  async setWorksFromOffice(actor: OfficeActor, staffId: string, worksFromOffice: boolean) {
    this.assertManager(actor);
    if (typeof worksFromOffice !== 'boolean') {
      throw new BadRequestException('worksFromOffice must be true or false');
    }
    const staff = await this.prisma.staff.findUnique({ where: { id: staffId } });
    if (!staff) {
      throw new NotFoundException(`Staff '${staffId}' not found`);
    }
    if (staff.worksFromOffice === worksFromOffice) {
      return { id: staff.id, code: staff.code, worksFromOffice: staff.worksFromOffice };
    }
    const updated = await this.prisma.staff.update({
      where: { id: staffId },
      data: { worksFromOffice },
      select: { id: true, code: true, worksFromOffice: true },
    });
    await this.auditService.log({
      actorId: actor.id,
      action: 'staff.works_from_office_set',
      entityType: 'staff',
      entityCode: updated.code,
      before: { worksFromOffice: staff.worksFromOffice },
      after: { worksFromOffice: updated.worksFromOffice },
    });
    return updated;
  }

  async describeRequest(actor: OfficeActor, ip: string) {
    this.assertManager(actor);
    const onOfficeNetwork = await this.isOnOfficeNetwork(ip);
    await this.auditService.log({
      actorId: actor.id,
      action: 'office_network.checked',
      entityType: 'office_network',
      entityCode: 'check',
      after: { onOfficeNetwork },
    });
    return { onOfficeNetwork };
  }

  /** The address Express already resolved. Never the raw X-Forwarded-For header. */
  requestIp(req: Request): string {
    return req.ip || req.socket?.remoteAddress || '';
  }

  private assertManager(actor: OfficeActor): void {
    if (actor.role !== 'ceo' && actor.role !== 'manager') {
      throw new ForbiddenException('Only the CEO and a Manager can manage office networks');
    }
  }
}
