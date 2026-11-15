import { OwnTeam } from '../rbac/own-team';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

/** The Prisma model behind each editable entity, for the column checks below. */
const ENTITY_MODEL: Record<EditableEntityType, string> = {
  job_seeker: 'JobSeeker',
  business: 'Business',
  vacancy: 'Vacancy',
  placement: 'Placement',
  referral: 'Referral',
  call_record: 'CallRecord',
};

/**
 * Keys a client may send next to the editable fields: the edit reason, the OTP
 * request for a new phone number, and echoed identifiers. They are never written.
 */
export const EDIT_CONTROL_KEYS: ReadonlySet<string> = new Set([
  'reason',
  'phoneOtpRequestId',
  'otpRequestId',
  'id',
  'code',
  'createdAt',
  'updatedAt',
]);

/**
 * Security (AC-1): an edit route writes only the scalar columns on its own
 * allowlist. Anything else — a status, a verification or money field, a pause
 * or suspension, a relation (nested create/update/connect) — is refused with
 * 400 before the permission check, so it can never reach a Prisma write.
 * Returns the allowed fields only (control keys and undefined values dropped).
 */
export function pickEditableFields(
  dto: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  entityLabel: string,
): Record<string, unknown> {
  if (!dto || typeof dto !== 'object' || Array.isArray(dto)) {
    throw new BadRequestException('The request body must be an object of fields to change');
  }
  const refused: string[] = [];
  const picked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(dto)) {
    if (EDIT_CONTROL_KEYS.has(key)) continue;
    if (!allowed.has(key)) {
      refused.push(key);
      continue;
    }
    if (value !== undefined) picked[key] = value;
  }
  if (refused.length) {
    throw new BadRequestException(
      `These fields cannot be changed by editing a ${entityLabel}: ${refused.sort().join(', ')}. Use the screen's own action for them.`,
    );
  }
  return picked;
}

interface ColumnInfo {
  kind: string;
  type: string;
  /** Missing from the compact model description of some Prisma client builds. */
  isList?: boolean;
  isRequired?: boolean;
}

function modelColumns(entityType: EditableEntityType): Map<string, ColumnInfo> | null {
  const models = (Prisma as unknown as { dmmf?: { datamodel?: { models?: Array<{ name: string; fields: Array<ColumnInfo & { name: string }> }> } } })
    .dmmf?.datamodel?.models;
  const model = models?.find((m) => m.name === ENTITY_MODEL[entityType]);
  if (!model) return null;
  return new Map(model.fields.map((f) => [f.name, { kind: f.kind, type: f.type, isList: f.isList, isRequired: f.isRequired }]));
}

function isScalarValueFor(column: ColumnInfo, value: unknown): boolean {
  if (column.type === 'Json') return true;
  if (value === null) return !column.isRequired && !column.isList;
  if (column.isList) {
    return Array.isArray(value) && value.every((item) => item !== null && isScalarValueFor({ ...column, isList: false }, item));
  }
  switch (column.type) {
    case 'String':
      return typeof value === 'string';
    case 'Int':
    case 'BigInt':
      return typeof value === 'number' && Number.isSafeInteger(value);
    case 'Float':
    case 'Decimal':
      return typeof value === 'number' && Number.isFinite(value);
    case 'Boolean':
      return typeof value === 'boolean';
    case 'DateTime':
      return value instanceof Date || (typeof value === 'string' && !isNaN(Date.parse(value)));
    default:
      // Enums are sent as their string value.
      return column.kind === 'enum' ? typeof value === 'string' : false;
  }
}

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

  /**
   * Whether a record was self-registered in the customer app, and the staff
   * member assigned to help that sign-up (SignupTracker.assignedStaffId, set by
   * the back office's sign-up tracker).
   */
  private async appSignup(
    entityType: EditableEntityType,
    record: Record<string, unknown>,
    creatorId: string | null,
  ): Promise<{ selfRegistered: boolean; assigneeId: string | null }> {
    let subjectType: string | null = null;
    let subjectId: string | null = null;
    let selfRegistered = Boolean(creatorId?.startsWith('customer:'));
    if (entityType === 'job_seeker' || entityType === 'referral') {
      subjectType = entityType;
      subjectId = record.id as string;
    } else if (entityType === 'vacancy') {
      subjectType = 'business';
      subjectId = record.businessId as string;
      selfRegistered = selfRegistered || record.capturedChannel === 'laboura_app';
    }
    // Unit tests that hand in a partial Prisma double have no tracker table.
    if (!subjectType || !subjectId || typeof this.prisma.signupTracker?.findFirst !== 'function') {
      return { selfRegistered, assigneeId: null };
    }
    const tracker = await this.prisma.signupTracker.findFirst({
      where: { subjectType, subjectId },
      orderBy: { createdAt: 'desc' },
      select: { assignedStaffId: true },
    });
    if (entityType === 'job_seeker' && tracker) selfRegistered = true;
    if (entityType === 'vacancy' && !selfRegistered) return { selfRegistered: false, assigneeId: null };
    return { selfRegistered, assigneeId: tracker?.assignedStaffId ?? null };
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

    if (actor.role === 'team_lead' && entityType === 'business') {
      return this.checkTeamLeadBusinessEdit(actor, record, isMoney);
    }

    if (actor.role === 'team_lead') {
      const creatorId = await this.getCreatorStaffId(entityType, record);
      if (!creatorId || creatorId.startsWith('customer:')) {
        // Self-registered in the customer app: a Team Lead edits it unless a
        // sign-up helper from another team was assigned (security review M2).
        const app = await this.appSignup(entityType, record, creatorId);
        if (app.selfRegistered && app.assigneeId && app.assigneeId !== actor.id) {
          // The helper's team (OwnTeam), not a raw teamLeadId match.
          if (!(await new OwnTeam(this.prisma).includes(actor.id, app.assigneeId))) {
            return { allowed: false, isMoneyInvolved: isMoney, reason: 'Only the Team Lead of the agent helping this app sign-up can edit it' };
          }
        }
        return { allowed: true, isMoneyInvolved: isMoney };
      }
      if (creatorId === actor.id) {
        return { allowed: true, isMoneyInvolved: isMoney };
      }
      // The shared own-team definition (OwnTeam), not a raw teamLeadId match.
      if (await new OwnTeam(this.prisma).includes(actor.id, creatorId)) {
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
        // Master Guide: only the account agent, their Team Lead and management edit a
        // business. The agent who created the lead has no edit right of their own, and a
        // business with no account agent yet is edited by a Team Lead or above.
        if (!record.accountAgentId) {
          return {
            allowed: false,
            isMoneyInvolved: false,
            reason: 'This business has no account agent yet: only a Team Lead or above can edit it',
          };
        }
        if (record.accountAgentId === actor.id) {
          return { allowed: true, isMoneyInvolved: false };
        }
        return {
          allowed: false,
          isMoneyInvolved: false,
          reason: 'Only the account agent of this business, their Team Lead and management can edit it',
        };
      }

      const creatorId = await this.getCreatorStaffId(entityType, record);
      if (!creatorId || creatorId.startsWith('customer:')) {
        // Self-registered in the customer app: no agent created it, so it does
        // not fail open — only the agent assigned to help this sign-up edits it
        // (Team Leads and above as above). Older records with no creator keep
        // the previous rule (security review M2).
        const app = await this.appSignup(entityType, record, creatorId);
        if (app.selfRegistered) {
          return app.assigneeId === actor.id
            ? { allowed: true, isMoneyInvolved: false }
            : { allowed: false, isMoneyInvolved: false, reason: 'Registered in the app: only the agent assigned to this sign-up or a Team Lead can edit it' };
        }
        return { allowed: true, isMoneyInvolved: false };
      }
      if (creatorId === actor.id) {
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

  /**
   * A Team Lead edits a business when the account agent is in their team (or is the Team
   * Lead). With no account agent yet, the Team Lead of the team that created the lead
   * edits it; with no creator either, any Team Lead may.
   */
  private async checkTeamLeadBusinessEdit(
    actor: EditActor,
    record: Record<string, unknown>,
    isMoney: boolean,
  ): Promise<{ allowed: boolean; isMoneyInvolved: boolean; reason?: string }> {
    const accountAgentId = (record.accountAgentId as string | null) ?? null;
    const ownerId = accountAgentId ?? (record.leadCreatedByStaffId as string | null) ?? null;
    if (!ownerId || ownerId === actor.id) {
      return { allowed: true, isMoneyInvolved: isMoney };
    }
    // businessOwners: the account agent, else the lead creator; their team (OwnTeam).
    if (await new OwnTeam(this.prisma).includes(actor.id, ownerId)) {
      return { allowed: true, isMoneyInvolved: isMoney };
    }
    return {
      allowed: false,
      isMoneyInvolved: isMoney,
      reason: accountAgentId
        ? "Only the account agent's Team Lead can edit this business"
        : 'Only the Team Lead of the team that created this lead can edit it',
    };
  }

  /**
   * Compares the requested changes with the saved record. Security (AC-1): every
   * key must be a scalar column of the entity's table (no relation, so no nested
   * create/update/connect) and every value must fit the column (no object or
   * array for a plain column; arrays only for list columns, objects only for
   * JSON columns), otherwise 400. Without an entity type, only keys the saved
   * record already has are accepted, with plain values (fails closed).
   */
  diffAndValidateReason(
    existingRecord: Record<string, unknown>,
    updates: Record<string, unknown>,
    reason?: string,
    entityType?: EditableEntityType,
  ): DiffResult {
    const IGNORED_KEYS = new Set([
      'reason',
      'id',
      'code',
      'createdat',
      'updatedat',
    ]);
    const columns = entityType ? modelColumns(entityType) : null;
    if (entityType && !columns) {
      throw new BadRequestException('This record cannot be edited here');
    }

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

      if (columns) {
        const column = columns.get(rawKey);
        if (!column) throw new BadRequestException(`Unknown field: ${rawKey}`);
        if (column.kind === 'object') {
          throw new BadRequestException(`${rawKey} is a linked record and cannot be changed by an edit`);
        }
        // Without list metadata, a list column is one the saved record holds as an array.
        const known = column.isList === undefined ? { ...column, isList: Array.isArray(existingRecord[rawKey]) } : column;
        if (!isScalarValueFor(known, newVal)) {
          throw new BadRequestException(`${rawKey} has a value of the wrong type`);
        }
      } else {
        if (!Object.prototype.hasOwnProperty.call(existingRecord, rawKey)) {
          throw new BadRequestException(`Unknown field: ${rawKey}`);
        }
        const plain = (v: unknown) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
        const listOk = Array.isArray(existingRecord[rawKey]) && Array.isArray(newVal) && newVal.every(plain);
        if (!plain(newVal) && !listOk && !(newVal instanceof Date)) {
          throw new BadRequestException(`${rawKey} has a value of the wrong type`);
        }
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
      diff = this.diffAndValidateReason(record, updates, reason, entityType);
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
