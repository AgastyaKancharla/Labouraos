import { jobQueue } from '../jobs/job-queue';
import { closeSharedRedis } from '../common/redis/redis-connections';

// The shared Redis connection and the shared job worker live for the whole
// process (src/common/redis/redis-connections.ts). Close them after each spec
// file so Jest can exit and the next file starts with fresh ones.
afterAll(async () => {
  await jobQueue.close(0);
  await closeSharedRedis(500);
});
