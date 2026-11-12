import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  Optional,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { Request } from 'express';
import { JwtPayload } from '../auth/jwt-payload.interface';
import { AuditService } from '../audit/audit.service';
import { OWN_PAY_ANSWER, seesMoney, stripMoney } from './money-visibility';

const PII_KEYS = new Set([
  'phone',
  'kycReference',
  'kycDetails',
  'contactPhone',
  'candidatePhone',
]);

/**
 * Roles that see only the last 4 digits of a phone number. Only the CEO sees
 * full numbers (Master Guide, People and roles); Finance sees none at all.
 */
const AGENT_PHONE_ROLES = new Set(['call_agent', 'field_agent', 'team_lead', 'manager']);

/** Roles that receive full phone numbers; every such answer is audit-logged. */
const FULL_PHONE_ROLES = new Set(['ceo']);

export const FULL_PHONE_VIEW_ACTION = 'pii.full_phone_viewed';
export const FULL_PHONE_VIEW_ENTITY = 'full_phone_view';
/** Upper bound on record references kept in one audit row. */
const MAX_LOGGED_RECORDS = 5000;
const FULL_PHONE_LOGGED = Symbol('fullPhoneViewLogged');

/** Last 4 digits only, for example `******1234`. */
export function maskPhoneLast4(value: unknown): string {
  const digits = String(value).replace(/\D/g, '');
  return `******${digits.slice(-4)}`;
}

function isAgentPhoneKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (lower === 'callroutingphone') {
    return false;
  }
  return lower === 'phone' || lower.endsWith('phone') || lower === 'virtualnumber';
}

export function maskPii<T>(data: T, seen = new WeakSet<object>()): T {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'object') {
    if (data instanceof Date) {
      return data;
    }
    if (seen.has(data)) {
      return data;
    }
    seen.add(data);
  }

  if (Array.isArray(data)) {
    return data.map((item) => maskPii(item, seen)) as unknown as T;
  }

  if (typeof data === 'object') {
    const masked: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (key === 'callRoutingPhone') {
        continue;
      }
      if (PII_KEYS.has(key) && value !== null && value !== undefined) {
        masked[key] = value === '[changed]' ? value : '********';
      } else if (typeof value === 'object' && value !== null) {
        masked[key] = maskPii(value, seen);
      } else {
        masked[key] = value;
      }
    }
    return masked as unknown as T;
  }

  return data;
}

/** Last-4 phone masking for call agents, field agents and team leads. */
export function maskAgentPhones<T>(data: T, seen = new WeakSet<object>()): T {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'object') {
    if (data instanceof Date) {
      return data;
    }
    if (seen.has(data)) {
      return data;
    }
    seen.add(data);
  }

  if (Array.isArray(data)) {
    return data.map((item) => maskAgentPhones(item, seen)) as unknown as T;
  }

  if (typeof data === 'object') {
    const masked: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (key === 'callRoutingPhone') {
        continue;
      }
      if (isAgentPhoneKey(key) && value !== null && value !== undefined && typeof value !== 'object') {
        masked[key] = value === '[changed]' ? value : maskPhoneLast4(value);
      } else if (typeof value === 'object' && value !== null) {
        masked[key] = maskAgentPhones(value, seen);
      } else {
        masked[key] = value;
      }
    }
    return masked as unknown as T;
  }

  return data;
}

function omitCallRoutingPhone(data: unknown, seen = new WeakSet<object>()): void {
  if (data === null || data === undefined || typeof data !== 'object') {
    return;
  }
  if (data instanceof Date || seen.has(data)) {
    return;
  }
  seen.add(data);
  if (Array.isArray(data)) {
    for (const item of data) {
      omitCallRoutingPhone(item, seen);
    }
    return;
  }
  const record = data as Record<string, unknown>;
  if ('callRoutingPhone' in record) {
    delete record.callRoutingPhone;
  }
  for (const value of Object.values(record)) {
    omitCallRoutingPhone(value, seen);
  }
}

export interface FullPhoneRecordRef {
  id?: string;
  code?: string;
  fields: string[];
}

function isFullPhoneKey(key: string): boolean {
  return isAgentPhoneKey(key) && key.toLowerCase() !== 'virtualnumber';
}

function isFullPhoneValue(value: unknown): boolean {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return false;
  }
  const text = String(value);
  if (text.includes('*') || text === '[changed]') {
    return false;
  }
  return text.replace(/\D/g, '').length >= 7;
}

/**
 * Lists the records in a response that carry a full phone number, by id and
 * code only. Phone numbers themselves never go into the audit log.
 */
export function collectFullPhoneRecords(
  data: unknown,
  found: FullPhoneRecordRef[] = [],
  seen = new WeakSet<object>(),
): FullPhoneRecordRef[] {
  if (data === null || data === undefined || typeof data !== 'object') {
    return found;
  }
  if (data instanceof Date || seen.has(data)) {
    return found;
  }
  seen.add(data);
  if (Array.isArray(data)) {
    for (const item of data) {
      collectFullPhoneRecords(item, found, seen);
    }
    return found;
  }
  const record = data as Record<string, unknown>;
  const fields = Object.entries(record)
    .filter(([key, value]) => isFullPhoneKey(key) && isFullPhoneValue(value))
    .map(([key]) => key);
  if (fields.length > 0) {
    const ref: FullPhoneRecordRef = { fields };
    if (typeof record.id === 'string') ref.id = record.id;
    if (typeof record.code === 'string') ref.code = record.code;
    found.push(ref);
  }
  for (const value of Object.values(record)) {
    if (value && typeof value === 'object') {
      collectFullPhoneRecords(value, found, seen);
    }
  }
  return found;
}

@Injectable()
export class PiiMaskingInterceptor implements NestInterceptor {
  constructor(@Optional() private readonly auditService?: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<
      Request & { user?: JwtPayload; [FULL_PHONE_LOGGED]?: boolean }
    >();
    const role = request.user?.role;

    return next.handle().pipe(
      mergeMap(async (data: unknown) => {
        let out: unknown;
        if (role === 'finance') {
          out = maskPii(data);
        } else if (role && AGENT_PHONE_ROLES.has(role)) {
          out = maskAgentPhones(data);
        } else {
          omitCallRoutingPhone(data);
          out = data;
          if (role && FULL_PHONE_ROLES.has(role)) {
            await this.logFullPhoneView(request, data);
          }
        }
        if (!seesMoney(role) && !(request as unknown as Record<string, unknown>)[OWN_PAY_ANSWER]) {
          out = stripMoney(out);
        }
        return out;
      }),
    );
  }

  /**
   * One audit row per request that hands the CEO full phone numbers, listing
   * which records they came from. The interceptor can run twice on one
   * request (globally and on a controller), so the request is marked.
   */
  private async logFullPhoneView(
    request: Request & { user?: JwtPayload; [FULL_PHONE_LOGGED]?: boolean },
    data: unknown,
  ): Promise<void> {
    if (!this.auditService || !request.user || request[FULL_PHONE_LOGGED]) {
      return;
    }
    const records = collectFullPhoneRecords(data);
    if (records.length === 0) {
      return;
    }
    request[FULL_PHONE_LOGGED] = true;
    const routePath = (request.route as { path?: string } | undefined)?.path ?? request.path;
    await this.auditService.log({
      actorId: request.user.sub,
      action: FULL_PHONE_VIEW_ACTION,
      entityType: FULL_PHONE_VIEW_ENTITY,
      entityCode: request.user.code ?? request.user.sub,
      after: {
        method: request.method,
        route: routePath,
        recordCount: records.length,
        records: records.slice(0, MAX_LOGGED_RECORDS),
        truncated: records.length > MAX_LOGGED_RECORDS,
      },
      changedFields: [],
    });
  }
}
