import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { StructuredLogger } from './common/observability/structured-logger.service';
import { getPublicAppUrl } from './common/public-link';
import { assertDurableUploadStorage } from './common/storage/durable-storage';
import { assertNoMockIdCheck } from './common/process/no-mock-id-check';

export async function bootstrapWorker() {
  getPublicAppUrl();
  assertDurableUploadStorage();
  assertNoMockIdCheck();
  process.env.PROCESS_ROLE = 'worker';

  const logger = new StructuredLogger('WorkerBootstrap');
  logger.log('Starting background worker application context...', 'WorkerBootstrap');

  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: true,
  });

  app.useLogger(logger);
  app.enableShutdownHooks();

  logger.log(
    'Worker application context initialized and running (PROCESS_ROLE=worker)',
    'WorkerBootstrap',
  );

  return app;
}

if (require.main === module) {
  bootstrapWorker().catch((error: unknown) => {
    // Exit so Render shows the worker as failed and restarts it, instead of a
    // process that stays up while running no background job.
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    new StructuredLogger('WorkerBootstrap').error(`Worker failed to start: ${message}`, undefined, 'WorkerBootstrap');
    process.exit(1);
  });
}
