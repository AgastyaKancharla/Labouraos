import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { StructuredLogger } from './common/observability/structured-logger.service';
import { GlobalExceptionFilter } from './common/observability/global-exception.filter';
import { AlertService } from './common/observability/alert.service';
import { applyTrustProxy } from './common/http/trust-proxy';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    // Webhook signatures are computed over the exact bytes the gateway sent
    rawBody: true,
  });
  const logger = app.get(StructuredLogger);
  app.useLogger(logger);
  applyTrustProxy(app);
  const alertService = app.get(AlertService);
  app.useGlobalFilters(new GlobalExceptionFilter(alertService));

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
}
void bootstrap();
