import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown, OnModuleDestroy } from '@nestjs/common';
import { runsJobs } from '../common/process/process-role';
import { closeSharedRedis, redisClientStats, redisConnectionBudget } from '../common/redis/redis-connections';
import { jobQueue, LABOURA_JOBS_QUEUE } from './job-queue';

/**
 * Starts and stops the shared job worker and the shared Redis connection.
 *
 * Start: in a process that runs jobs, the one Worker starts even when Redis is
 * down (BullMQ connects and reconnects in the background), so jobs run as soon
 * as Redis answers. Nothing here waits for Redis.
 *
 * Shutdown (SIGTERM during a Render deploy, or app.close()): the Worker stops
 * first, waiting at most JOB_SHUTDOWN_GRACE_MS for running jobs, then every
 * Redis connection is closed, so the old instance gives its connections back
 * straight away and the new one has room.
 */
@Injectable()
export class JobQueueLifecycle implements OnApplicationBootstrap, OnModuleDestroy, OnApplicationShutdown {
  private readonly logger = new Logger(JobQueueLifecycle.name);

  onApplicationBootstrap(): void {
    if (!runsJobs()) return;
    jobQueue.start();
    const stats = redisClientStats();
    this.logger.log(
      `Job worker started on queue ${LABOURA_JOBS_QUEUE} for ${jobQueue.handlerNames().length} job(s); ` +
        `Redis connections opened by this process: ${stats.open} (budget ${redisConnectionBudget()})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await jobQueue.close();
  }

  async onApplicationShutdown(): Promise<void> {
    await jobQueue.close(0);
    await closeSharedRedis();
  }
}
