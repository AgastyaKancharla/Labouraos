import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IdService } from '../id/id.service';

export interface CreateAuditLogParams {
  actorId: string;
  action: string;
  entityType: string;
  entityCode: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  city?: string;
}

@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idService: IdService,
  ) {}

  async log(params: CreateAuditLogParams) {
    const code = await this.idService.generateCode('audit_log');
    return this.prisma.auditLog.create({
      data: {
        code,
        actorId: params.actorId,
        action: params.action,
        entityType: params.entityType,
        entityCode: params.entityCode,
        before: params.before ? (params.before as Prisma.InputJsonValue) : Prisma.JsonNull,
        after: params.after ? (params.after as Prisma.InputJsonValue) : Prisma.JsonNull,
        city: params.city ?? 'Bengaluru',
      },
    });
  }

  async getLogs(filter?: { entityType?: string; entityCode?: string; actorId?: string }) {
    return this.prisma.auditLog.findMany({
      where: filter,
      orderBy: { createdAt: 'desc' },
      include: {
        actor: {
          select: { id: true, code: true, name: true, role: true },
        },
      },
    });
  }

  async getLogById(id: string) {
    return this.prisma.auditLog.findUnique({
      where: { id },
      include: {
        actor: {
          select: { id: true, code: true, name: true, role: true },
        },
      },
    });
  }
}
