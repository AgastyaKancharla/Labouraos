import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { StructuredLogger } from './common/observability/structured-logger.service';
import { getPublicAppUrl } from './common/public-link';

export async function bootstrapWorker() {
  getPublicAppUrl();
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
  void bootstrapWorker();
}
