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
      if (PII_KEYS.has(key) && value !== null && value !== undefined) {
        masked[key] = '********';
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

@Injectable()
export class PiiMaskingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
    const isFinance = request.user?.role === 'finance';

    return next.handle().pipe(
      map((data: unknown) => {
        if (!isFinance) {
          return data;
        }
        return maskPii(data);
      }),
    );
  }
}
