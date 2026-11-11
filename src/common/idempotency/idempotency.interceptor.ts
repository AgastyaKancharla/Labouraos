import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, catchError, from, mergeMap, of } from 'rxjs';
import { JwtPayload } from '../auth/jwt-payload.interface';
import { IDEMPOTENCY_KEY_PATTERN, IdempotencyService } from './idempotency.service';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH']);

/**
 * Server side of the field app's offline queue (field/README.md, "Weak
 * signal"). A signed-in staff write that carries `Idempotency-Key`:
 * - first time: runs, and its answer is saved;
 * - again with the same key: the saved answer comes back and nothing runs
 *   (header `Idempotent-Replay: true`);
 * - again while the first is still running: 429, so the queue tries later;
 * - the same key on a different request: 422.
 * A first try that fails is forgotten, so the retry runs. Requests without
 * the header, reads, and public routes are untouched.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly idempotency: IdempotencyService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
    const res = context.switchToHttp().getResponse<Response>();
    const header = req.headers['idempotency-key'];
    const key = Array.isArray(header) ? header[0] : header;
    const staffId = req.user?.sub;
    if (!key || !staffId || !WRITE_METHODS.has(req.method)) return next.handle();
    if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
      throw new BadRequestException('Idempotency-Key must be 8 to 128 letters, digits, dots, dashes, colons or underscores');
    }
    const path = (req.originalUrl ?? req.url).split('?')[0];

    return from(this.idempotency.begin(staffId, key, req.method, path)).pipe(
      mergeMap((started) => {
        if (started.kind === 'replay') {
          res.status(started.status);
          res.setHeader('Idempotent-Replay', 'true');
          return of(started.body);
        }
        if (started.kind === 'busy') {
          throw new HttpException('The first try of this request is still being saved. Try again shortly.', HttpStatus.TOO_MANY_REQUESTS);
        }
        if (started.kind === 'mismatch') {
          throw new HttpException('This Idempotency-Key was already used for a different request', HttpStatus.UNPROCESSABLE_ENTITY);
        }
        return next.handle().pipe(
          mergeMap(async (body: unknown) => {
            await this.idempotency.complete(started.id, res.statusCode, body);
            return body;
          }),
          catchError(async (error: unknown) => {
            await this.idempotency.abandon(started.id).catch(() => undefined);
            throw error;
          }),
        );
      }),
    );
  }
}
