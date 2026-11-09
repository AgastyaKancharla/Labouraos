import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export type EditableEntityType =
  | 'job_seeker'
  | 'business'
  | 'vacancy'
  | 'placement'
  | 'referral'
  | 'call_record';

export interface EditActor {
  id: string;
  role: string;
  teamLeadId?: string | null;
}

export interface DiffResult {
  hasChange: boolean;
  requiresReason: boolean;
  changedFields: string[];
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

export interface AssertCanEditParams {
  actor: EditActor;
  entityType: EditableEntityType;
  entityId: string;
  updates?: Record<string, unknown>;
  reason?: string;
}

export const CONFIRMED_PLACEMENT_STATUSES = [
  'confirmed',
  'active',
  'dropped_out',
  'replaced',
  'completed',
  'guarantee_ended',
];

const CALL_PROVIDER_FIELDS = new Set([
  'provider',
  'providercallid',
  'providerstatus',
  'recordingstoragepath',
  'recordingdeletedat',
  'durationsec',
  'answered',
  'startedat',
  'answeredat',
  'endedat',
  'direction',
  'announcementplayed',
]);

@Injectable()
export class EditPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async loadEntity(
    entityType: EditableEntityType,
    id: string,
  ): Promise<Record<string, unknown>> {
    let record: Record<string, unknown> | null = null;
    switch (entityType) {
      case 'job_seeker':
        record = (await this.prisma.jobSeeker.findUnique({
          where: { id },
        })) as Record<string, unknown> | null;
        if (!record) {
          record = (await this.prisma.jobSeeker.findUnique({
            where: { code: id },
          })) as Record<string, unknown> | null;
        }
        break;
      case 'business':
        record = (await this.prisma.business.findUnique({
          where: { id },
        })) as Record<string, unknown> | null;
        if (!record) {
          record = (await this.prisma.business.findUnique({
            where: { code: id },
          })) as Record<string, unknown> | null;
        }
        break;
      case 'vacancy':
        record = (await this.prisma.vacancy.findUnique({
          where: { id },
          include: { business: true },
        })) as Record<string, unknown> | null;
        if (!record) {
          record = (await this.prisma.vacancy.findUnique({
            where: { code: id },
            include: { business: true },
          })) as Record<string, unknown> | null;
        }
        break;
      case 'placement':
        record = (await this.prisma.placement.findUnique({
          where: { id },
        })) as Record<string, unknown> | null;
        if (!record) {
          record = (await this.prisma.placement.findUnique({
            where: { code: id },
          })) as Record<string, unknown> | null;
        }
        break;
      case 'referral':
        record = (await this.prisma.referral.findUnique({
          where: { id },
        })) as Record<string, unknown> | null;
        if (!record) {
          record = (await this.prisma.referral.findUnique({
            where: { code: id },
          })) as Record<string, unknown> | null;
        }
        break;
      case 'call_record':
        record = (await this.prisma.callRecord.findUnique({
          where: { id },
        })) as Record<string, unknown> | null;
        if (!record) {
          record = (await this.prisma.callRecord.findUnique({
            where: { code: id },
          })) as Record<string, unknown> | null;
        }
        break;
    }

    if (!record) {
      throw new NotFoundException(`${entityType} '${id}' not found`);
    }
    return record;
  }

  async isMoneyInvolved(
    entityType: EditableEntityType,
    record: Record<string, unknown>,
  ): Promise<boolean> {
    switch (entityType) {
      case 'job_seeker': {
        if (record.paymentReceivedAt !== null && record.paymentReceivedAt !== undefined) {
          return true;
        }
        const succeededPayment = await this.prisma.payment.findFirst({
          where: { jobSeekerId: record.id as string, status: 'succeeded' },
        });
        return !!succeededPayment;
      }

      case 'placement': {
        if (record.paidAt !== null && record.paidAt !== undefined) {
          return true;
        }
        return CONFIRMED_PLACEMENT_STATUSES.includes(record.status as string);
      }

      case 'business': {
        const placement = await this.prisma.placement.findFirst({
          where: {
            businessId: record.id as string,
            status: { in: CONFIRMED_PLACEMENT_STATUSES },
          },
        });
        return !!placement;
      }

      case 'vacancy': {
        const placement = await this.prisma.placement.findFirst({
          where: {
            vacancyId: record.id as string,
            status: { in: CONFIRMED_PLACEMENT_STATUSES },
          },
        });
        return !!placement;
      }

      case 'referral': {
        const payout = await this.prisma.payment.findFirst({
          where: {
            referralId: record.id as string,
            status: { in: ['approved', 'succeeded', 'completed'] },
          },
        });
        return !!payout;
      }

      case 'call_record': {
        if (record.subjectType && record.subjectId) {
          try {
            const subject = await this.loadEntity(
              record.subjectType as EditableEntityType,
              record.subjectId as string,
            );
            if (
              subject &&
              (await this.isMoneyInvolved(record.subjectType as EditableEntityType, subject))
            ) {
              return true;
            }
          } catch {
            // subject not found or invalid
          }
        }
        if (record.relatedType === 'placement' && record.relatedId) {
          try {
            const placement = await this.loadEntity('placement', record.relatedId as string);
            if (placement && (await this.isMoneyInvolved('placement', placement))) {
              return true;
            }
          } catch {
            // placement not found
          }
        }
        return false;
      }
    }
  }

  async getCreatorStaffId(
    entityType: EditableEntityType,
    record: Record<string, unknown>,
  ): Promise<string | null> {
    switch (entityType) {
      case 'job_seeker':
        return (record.registeredByStaffId as string | null) ?? null;
      case 'business':
        return (
          (record.accountAgentId as string | null) ??
          (record.leadCreatedByStaffId as string | null) ??
          (record.verifiedByStaffId as string | null) ??
          null
        );
      case 'vacancy':
        return (record.capturedByStaffId as string | null) ?? null;
      case 'placement':
        return (record.createdByStaffId as string | null) ?? null;
      case 'referral': {
        const log = await this.prisma.auditLog.findFirst({
          where: {
            entityType: 'referral',
            entityCode: record.code as string,
            action: 'referral.create',
          },
          orderBy: { createdAt: 'asc' },
        });
        return log?.actorId ?? null;
      }
      case 'call_record':
        return (record.staffId as string | null) ?? null;
    }
  }

  async checkEditPermission(
    actor: EditActor,
    entityType: EditableEntityType,
    record: Record<string, unknown>,
  ): Promise<{ allowed: boolean; isMoneyInvolved: boolean; reason?: string }> {
    const isMoney = await this.isMoneyInvolved(entityType, record);

    if (['ceo', 'manager'].includes(actor.role)) {
      return { allowed: true, isMoneyInvolved: isMoney };
    }

    if (actor.role === 'team_lead') {
      const creatorId = await this.getCreatorStaffId(entityType, record);
      if (!creatorId || creatorId === actor.id) {
        return { allowed: true, isMoneyInvolved: isMoney };
      }
      const creator = await this.prisma.staff.findUnique({
        where: { id: creatorId },
        select: { teamLeadId: true },
      });
      if (creator?.teamLeadId === actor.id) {
        return { allowed: true, isMoneyInvolved: isMoney };
      }
      return {
        allowed: false,
        isMoneyInvolved: isMoney,
        reason: 'Only the team lead of the team that created this record can edit it',
      };
    }

    if (['call_agent', 'field_agent'].includes(actor.role)) {
      if (isMoney) {
        return {
          allowed: false,
          isMoneyInvolved: true,
          reason: 'Locked — money involved, ask your Team Lead',
        };
      }

      if (entityType === 'business') {
        const hasAccountOrCreator =
          !!record.accountAgentId ||
          !!record.leadCreatedByStaffId ||
          !!record.verifiedByStaffId;
        if (!hasAccountOrCreator) {
          return { allowed: true, isMoneyInvolved: false };
        }
        const isAccountOrCreator =
          record.accountAgentId === actor.id ||
          record.leadCreatedByStaffId === actor.id ||
          record.verifiedByStaffId === actor.id;
        if (isAccountOrCreator) {
          return { allowed: true, isMoneyInvolved: false };
        }
        return {
          allowed: false,
          isMoneyInvolved: false,
          reason: 'Only the account agent or creator of this business can edit it',
        };
      }

      const creatorId = await this.getCreatorStaffId(entityType, record);
      if (!creatorId || creatorId === actor.id) {
        return { allowed: true, isMoneyInvolved: false };
      }
      return {
        allowed: false,
        isMoneyInvolved: false,
        reason: 'Only the staff member who created this record can edit it',
      };
    }

    return {
      allowed: false,
      isMoneyInvolved: isMoney,
      reason: 'This role is not allowed to edit records',
    };
  }

  diffAndValidateReason(
    existingRecord: Record<string, unknown>,
    updates: Record<string, unknown>,
    reason?: string,
  ): DiffResult {
    const IGNORED_KEYS = new Set([
      'reason',
      'id',
      'code',
      'createdat',
      'updatedat',
    ]);

    let requiresReason = false;
    const changedFields: string[] = [];
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};

    for (const [rawKey, newVal] of Object.entries(updates)) {
      const lowerKey = rawKey.toLowerCase();
      if (IGNORED_KEYS.has(lowerKey) || newVal === undefined) {
        continue;
      }

      // Check if trying to edit prohibited call provider fields
      if (CALL_PROVIDER_FIELDS.has(lowerKey)) {
        throw new BadRequestException(
          'Call provider fields and recordings are never editable',
        );
      }

      const oldVal = existingRecord[rawKey];

      let isDifferent = false;
      if (
        oldVal instanceof Date ||
        (typeof oldVal === 'string' &&
          !isNaN(Date.parse(oldVal)) &&
          typeof newVal === 'string')
      ) {
        const oldTime =
          oldVal instanceof Date
            ? oldVal.getTime()
            : new Date(oldVal as string).getTime();
        const newTime =
          newVal instanceof Date
            ? newVal.getTime()
            : new Date(newVal as string).getTime();
        if (!isNaN(oldTime) && !isNaN(newTime)) {
          isDifferent = oldTime !== newTime;
        } else {
          isDifferent = oldVal !== newVal;
        }
      } else if (Array.isArray(oldVal) || Array.isArray(newVal)) {
        isDifferent =
          JSON.stringify(oldVal ?? []) !== JSON.stringify(newVal ?? []);
      } else if (
        typeof oldVal === 'object' &&
        oldVal !== null &&
        typeof newVal === 'object' &&
        newVal !== null
      ) {
        isDifferent = JSON.stringify(oldVal) !== JSON.stringify(newVal);
      } else {
        isDifferent = oldVal !== newVal;
      }

      if (isDifferent) {
        changedFields.push(rawKey);
        before[rawKey] = oldVal ?? null;
        after[rawKey] = newVal ?? null;

        const wasSaved =
          oldVal !== null &&
          oldVal !== undefined &&
          oldVal !== '' &&
          !(Array.isArray(oldVal) && oldVal.length === 0);

        if (wasSaved) {
          requiresReason = true;
        }
      }
    }

    if (requiresReason) {
      if (!reason || typeof reason !== 'string' || !reason.trim()) {
        throw new BadRequestException(
          'A reason is required when changing an existing saved value',
        );
      }
    }

    return {
      hasChange: changedFields.length > 0,
      requiresReason,
      changedFields,
      before,
      after,
    };
  }

  async assertCanEdit(params: AssertCanEditParams): Promise<{
    record: Record<string, unknown>;
    isMoneyInvolved: boolean;
    diff: DiffResult | null;
  }> {
    const { actor, entityType, entityId, updates, reason } = params;
    const record = await this.loadEntity(entityType, entityId);
    const perm = await this.checkEditPermission(actor, entityType, record);
    if (!perm.allowed) {
      throw new ForbiddenException(perm.reason ?? 'Edit not allowed');
    }

    let diff: DiffResult | null = null;
    if (updates) {
      diff = this.diffAndValidateReason(record, updates, reason);
    }

    return { record, isMoneyInvolved: perm.isMoneyInvolved, diff };
  }

  async logEdit(params: {
    actorId: string;
    entityType: EditableEntityType;
    entityCode: string;
    diff: DiffResult;
    reason?: string | null;
    city?: string;
  }) {
    if (!params.diff.hasChange) {
      return;
    }
    return this.auditService.log({
      actorId: params.actorId,
      action: `${params.entityType}.update`,
      entityType: params.entityType,
      entityCode: params.entityCode,
      before: params.diff.before,
      after: params.diff.after,
      reason: params.reason ?? (params.diff.requiresReason ? 'Updated' : null),
      changedFields: params.diff.changedFields,
      city: params.city ?? 'Bengaluru',
    });
  }
}
