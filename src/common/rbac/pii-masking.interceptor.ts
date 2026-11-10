import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Request } from 'express';
import { JwtPayload } from '../auth/jwt-payload.interface';

const PII_KEYS = new Set([
  'phone',
  'kycReference',
  'kycDetails',
  'contactPhone',
  'candidatePhone',
]);

const AGENT_PHONE_ROLES = new Set(['call_agent', 'field_agent', 'team_lead']);

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

@Injectable()
export class PiiMaskingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
    const role = request.user?.role;

    return next.handle().pipe(
      map((data: unknown) => {
        if (role === 'finance') {
          return maskPii(data);
        }
        if (role && AGENT_PHONE_ROLES.has(role)) {
          return maskAgentPhones(data);
        }
        omitCallRoutingPhone(data);
        return data;
      }),
    );
  }
}
