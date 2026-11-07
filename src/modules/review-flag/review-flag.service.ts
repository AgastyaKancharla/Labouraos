import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { AuditService } from '../../common/audit/audit.service';
import {
  REVIEW_FLAG_KINDS,
  ReviewFlagKind,
} from './review-flag.constants';

export interface RaiseReviewFlagParams {
  kind: ReviewFlagKind;
  subjectType: string;
  subjectId: string;
  raisedForStaffId?: string | null;
  details?: Record<string, unknown> | null;
}

export interface ListReviewFlagsQuery {
  status?: string;
  kind?: string;
}

export interface ResolveReviewFlagDto {
  status?: 'resolved' | 'dismissed';
  resolution: string;
}

@Injectable()
export class ReviewFlagService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idService: IdService,
    private readonly auditService: AuditService,
  ) {}

  async raise(params: RaiseReviewFlagParams) {
    if (!REVIEW_FLAG_KINDS.includes(params.kind)) {
      throw new BadRequestException(`Invalid review flag kind: '${params.kind}'`);
    }

    const code = await this.idService.generateCode('review_flag');

    return this.prisma.reviewFlag.create({
      data: {
        code,
        kind: params.kind,
        subjectType: params.subjectType,
        subjectId: params.subjectId,
        raisedForStaffId: params.raisedForStaffId ?? null,
        details: (params.details ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        status: 'open',
      },
    });
  }

  async list(actor: { id: string; role: string }, query?: ListReviewFlagsQuery) {
    const where: Prisma.ReviewFlagWhereInput = {};

    if (query?.status) {
      where.status = query.status;
    }
    if (query?.kind) {
      where.kind = query.kind;
    }

    if (actor.role === 'ceo' || actor.role === 'manager' || actor.role === 'finance') {
      // CEO, Manager, and Finance see all flags
    } else if (actor.role === 'team_lead') {
      // Team Lead only sees flags whose raisedForStaffId is one of their team members
      const teamMembers = await this.prisma.staff.findMany({
        where: { teamLeadId: actor.id },
        select: { id: true },
      });
      const memberIds = teamMembers.map((m) => m.id);
      where.raisedForStaffId = { in: memberIds };
    } else if (actor.role === 'field_agent') {
      where.raisedForStaffId = actor.id;
    } else {
      throw new ForbiddenException(
        'Review flags can only be viewed by Team Leads, Managers, or CEO',
      );
    }

    return this.prisma.reviewFlag.findMany({
      where,
      orderBy: { raisedAt: 'desc' },
      include: {
        raisedForStaff: {
          select: { id: true, code: true, name: true, role: true },
        },
        resolvedByStaff: {
          select: { id: true, code: true, name: true, role: true },
        },
      },
    });
  }

  async resolve(
    id: string,
    actor: { id: string; role: string },
    dto: ResolveReviewFlagDto,
  ) {
    if (!dto || !dto.resolution || !dto.resolution.trim()) {
      throw new BadRequestException(
        'A written resolution is required to resolve or dismiss a review flag',
      );
    }

    const targetStatus = (dto.status ?? 'resolved') as string;
    if (targetStatus !== 'resolved' && targetStatus !== 'dismissed') {
      throw new BadRequestException(
        "Status must be either 'resolved' or 'dismissed'",
      );
    }

    const flag = await this.prisma.reviewFlag.findUnique({
      where: { id },
    });
    if (!flag) {
      throw new NotFoundException(`Review flag '${id}' not found`);
    }

    if (actor.role === 'ceo' || actor.role === 'manager' || actor.role === 'finance') {
      // CEO, Manager, and Finance may resolve any flag
    } else if (actor.role === 'team_lead') {
      if (!flag.raisedForStaffId) {
        throw new ForbiddenException(
          'Team leads can only resolve review flags raised for their own team members',
        );
      }
      const member = await this.prisma.staff.findFirst({
        where: {
          id: flag.raisedForStaffId,
          teamLeadId: actor.id,
        },
      });
      if (!member) {
        throw new ForbiddenException(
          'Team leads can only resolve review flags raised for their own team members',
        );
      }
    } else {
      throw new ForbiddenException(
        'Only Team Leads, Managers, or CEO may resolve review flags',
      );
    }

    const updated = await this.prisma.reviewFlag.update({
      where: { id },
      data: {
        status: targetStatus,
        resolution: dto.resolution.trim(),
        resolvedAt: new Date(),
        resolvedByStaffId: actor.id,
      },
      include: {
        raisedForStaff: {
          select: { id: true, code: true, name: true, role: true },
        },
        resolvedByStaff: {
          select: { id: true, code: true, name: true, role: true },
        },
      },
    });

    await this.auditService.log({
      actorId: actor.id,
      action: 'review_flag.resolved',
      entityType: 'review_flag',
      entityCode: flag.code,
      before: {
        status: flag.status,
        resolution: flag.resolution,
      },
      after: {
        status: updated.status,
        resolution: updated.resolution,
      },
    });

    return updated;
  }
}
