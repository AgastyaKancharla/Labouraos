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
  reason?: string | null;
  changedFields?: string[];
  city?: string;
}

const PERSONAL_FIELDS = new Set([
  'name',
  'ownername',
  'contactname',
  'candidatename',
  'phone',
  'whatsappphone',
  'contactphone',
  'candidatephone',
  'callroutingphone',
  'email',
  'address',
  'kycreference',
  'kycdetails',
  'dateofbirth',
  'dob',
  'additionalcontactname',
  'additionalcontactphone',
  'billingname',
  'billingaddress',
  'photostoragepath',
  'cvstoragepath',
  'lastemployer',
  'upiid',
  'bankaccount',
  'ifsc',
  'verifiedname',
  'upiidencrypted',
  'bankaccountencrypted',
  'locality',
  'pincode',
  'latitude',
  'longitude',
  'language',
  'individualrole',
  'partnerbusinesstype',
  'partnerbusinessname',
  'heardfrom',
  'phototakenat',
  'last4',
  'namematches',
  'isadult',
  'vendorreference',
]);

export function isPersonalField(key: string): boolean {
  const lower = key.toLowerCase();
  if (PERSONAL_FIELDS.has(lower)) {
    return true;
  }
  if (lower.startsWith('aadhaar')) {
    return true;
  }
  return false;
}

export function redactValue(val: unknown, changedFields: Set<string>): unknown {
  if (val === null || val === undefined) {
    return val;
  }
  if (Array.isArray(val)) {
    return val.map((item) => redactValue(item, changedFields));
  }
  if (typeof val === 'object') {
    const res: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(val as Record<string, unknown>)) {
      if (isPersonalField(key)) {
        res[key] = '[changed]';
        changedFields.add(key);
      } else if (typeof value === 'object' && value !== null) {
        res[key] = redactValue(value, changedFields);
      } else {
        res[key] = value;
      }
    }
    return res;
  }
  return val;
}

@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idService: IdService,
  ) {}

  async log(params: CreateAuditLogParams) {
    const code = await this.idService.generateCode('audit_log');
    const changedFieldsSet = new Set<string>(params.changedFields ?? []);

    const redactedBefore = params.before
      ? (redactValue(params.before, changedFieldsSet) as Prisma.InputJsonValue)
      : Prisma.JsonNull;
    const redactedAfter = params.after
      ? (redactValue(params.after, changedFieldsSet) as Prisma.InputJsonValue)
      : Prisma.JsonNull;

    if (!params.changedFields && params.before && params.after) {
      if (typeof params.before === 'object' && typeof params.after === 'object') {
        const allKeys = new Set([
          ...Object.keys(params.before as Record<string, unknown>),
          ...Object.keys(params.after as Record<string, unknown>),
        ]);
        for (const key of allKeys) {
          const bVal = (params.before as Record<string, unknown>)[key];
          const aVal = (params.after as Record<string, unknown>)[key];
          if (JSON.stringify(bVal) !== JSON.stringify(aVal)) {
            changedFieldsSet.add(key);
          }
        }
      }
    }

    return this.prisma.auditLog.create({
      data: {
        code,
        actorId: params.actorId,
        action: params.action,
        entityType: params.entityType,
        entityCode: params.entityCode,
        before: redactedBefore,
        after: redactedAfter,
        reason: params.reason ?? null,
        changedFields: Array.from(changedFieldsSet),
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
