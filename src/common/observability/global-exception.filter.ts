import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AlertService } from './alert.service';
import { getRequestId } from './request-context';

/**
 * The matched route pattern (`/registration/:token/id-check`), or, when no
 * route matched, the path without its query and with every long id-like
 * segment replaced by `:value`.
 */
export function safeRoutePath(request: { route?: { path?: unknown }; baseUrl?: string; path?: string; url?: string }): string {
  const pattern = request.route?.path;
  if (typeof pattern === 'string' && pattern) return `${request.baseUrl ?? ''}${pattern}`;
  const raw = request.path ?? (request.url ?? '').split('?')[0];
  return raw.replace(/[A-Za-z0-9_-]{16,}/g, ':value');
}

@Injectable()
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  constructor(private readonly alertService: AlertService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const requestId = getRequestId() || (request.headers['x-request-id'] as string) || undefined;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errorDetails: unknown = undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const resObj = res as Record<string, unknown>;
        message = (resObj.message as string) || exception.message;
        errorDetails = resObj;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    if (status >= 500) {
      // L2: the route pattern, never the full address: public addresses carry
      // link tokens, and this line goes to the log and the alert webhook.
      const where = safeRoutePath(request);
      this.logger.error(
        `Unhandled error on ${request.method} ${where}: ${message}`,
        exception instanceof Error ? exception.stack : undefined,
      );

      // Trigger error tracking / alert
      void this.alertService.notifyException(exception, {
        method: request.method,
        path: where,
      });

      // Avoid leaking server internals in 500 responses
      response.status(status).json({
        statusCode: status,
        message: 'Internal server error',
        requestId,
        timestamp: new Date().toISOString(),
      });
    } else {
      response.status(status).json({
        statusCode: status,
        message,
        details: errorDetails,
        requestId,
        timestamp: new Date().toISOString(),
      });
    }
  }
}
