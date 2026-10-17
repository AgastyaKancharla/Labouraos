import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { Request } from 'express';
import { AUDIT_METADATA_KEY, AuditMetadata } from './audit.constants';
import { AuditService } from './audit.service';
import { JwtPayload } from '../auth/jwt-payload.interface';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const metadata = this.reflector.getAllAndOverride<AuditMetadata>(
      AUDIT_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!metadata) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request & { user?: JwtPayload; auditBefore?: Record<string, unknown> }>();
    const actorId = request.user?.sub ?? 'system';
    const before = request.auditBefore ?? (request.body?.before as Record<string, unknown> | undefined) ?? null;

    return next.handle().pipe(
      mergeMap(async (response: unknown) => {
        try {
          const resObj = (typeof response === 'object' && response !== null) ? (response as Record<string, unknown>) : {};
          const field = metadata.entityCodeField ?? 'code';
          const entityCode =
            (resObj[field] as string | undefined) ??
            (resObj.code as string | undefined) ??
            (request.params?.code as string | undefined) ??
            (request.params?.id as string | undefined) ??
            (resObj.id as string | undefined) ??
            'UNKNOWN';

          await this.auditService.log({
            actorId,
            action: metadata.action,
            entityType: metadata.entityType,
            entityCode,
            before,
            after: resObj,
          });
        } catch (err: unknown) {
          // Log audit failure to console, never crash the primary write request
          console.error('Failed to write audit log in AuditInterceptor:', err);
        }
        return response;
      }),
    );
  }
}
