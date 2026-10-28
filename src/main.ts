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
  // StructuredLogger is never actually DI-resolved anywhere else in this
  // codebase (every call site, including its own tests, does
  // `new StructuredLogger(name)` directly) — its constructor takes a plain
  // `context?: string`, which isn't a valid DI token, so asking Nest's
  // container to build one (via get() or resolve()) always fails. Construct
  // it directly here too, consistent with the rest of the app.
  const logger = new StructuredLogger('Bootstrap');
  app.useLogger(logger);
  applyTrustProxy(app);
  const alertService = app.get(AlertService);
  app.useGlobalFilters(new GlobalExceptionFilter(alertService));

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
}
void bootstrap();
