import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RequestIdMiddleware } from './request-id.middleware';
import { StructuredLogger } from './structured-logger.service';
import { AlertService } from './alert.service';
import { GlobalExceptionFilter } from './global-exception.filter';
import { SystemStatusController } from './system-status.controller';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [SystemStatusController],
  providers: [
    RequestIdMiddleware,
    StructuredLogger,
    AlertService,
    GlobalExceptionFilter,
  ],
  exports: [StructuredLogger, AlertService, RequestIdMiddleware],
})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
