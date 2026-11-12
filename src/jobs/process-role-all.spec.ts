import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import * as request from 'supertest';
import { AppModule } from '../app.module';
import { JOB_CATALOG } from './job-catalog';
import { missingSchedules } from './job-schedule-check';
import { JobScheduleKeeper } from './job-schedule-keeper.service';

/**
 * B1: Render's free tier has no Background Worker, so the single free web
 * service runs with PROCESS_ROLE=all: it serves the API AND registers every
 * job schedule and queue worker. This boots the whole app that way and checks
 * both halves.
 */
async function wipeJobQueues(redis: Redis): Promise<void> {
  for (const entry of JOB_CATALOG) {
    const keys = await redis.keys(`bull:${entry.queue}:*`);
    if (keys.length) await redis.del(...keys);
  }
}

describe('B1: one free web service with PROCESS_ROLE=all serves the API and runs every job', () => {
  const original = { role: process.env.PROCESS_ROLE, check: process.env.WORKER_HEARTBEAT_CHECK };
  const connection = { host: process.env.REDIS_HOST || 'localhost', port: Number(process.env.REDIS_PORT) || 6379 };
  let app: INestApplication | undefined;
  let redis: Redis;

  beforeAll(async () => {
    redis = new Redis({ ...connection, maxRetriesPerRequest: 1 });
    redis.on('error', () => undefined);
    // Start from an empty queue state, as on a fresh free Key Value.
    await wipeJobQueues(redis);
    process.env.PROCESS_ROLE = 'all';
    process.env.WORKER_HEARTBEAT_CHECK = 'true';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await wipeJobQueues(redis);
    redis.disconnect();
    if (original.role === undefined) delete process.env.PROCESS_ROLE;
    else process.env.PROCESS_ROLE = original.role;
    if (original.check === undefined) delete process.env.WORKER_HEARTBEAT_CHECK;
    else process.env.WORKER_HEARTBEAT_CHECK = original.check;
  }, 60_000);

  it('serves the API: /health answers ok', async () => {
    const res = await request(app!.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('registered every job schedule in Redis at start', async () => {
    expect(await missingSchedules(redis)).toEqual([]);
  });

  it('started the job workers in the same process (a scheduled run is picked up)', async () => {
    // interviewReply repeats every minute and its first run is due at once:
    // a worker in this process picks it up and leaves a JobRun row.
    const keeper = app!.get(JobScheduleKeeper);
    expect(keeper.keys()).toHaveLength(JOB_CATALOG.length);
    const queue = new Queue('interview-reply-deadlines', { connection });
    try {
      const workers = await queue.getWorkers();
      expect(workers.length).toBeGreaterThan(0);
    } finally {
      await queue.close();
    }
  });

  it('/health/ready reports the job schedules as present', async () => {
    const res = await request(app!.getHttpServer()).get('/health/ready');
    // The heartbeat is written at start in a job-running process; both checks pass.
    expect(res.body.schedules ?? res.body).toEqual(expect.objectContaining({ status: 'ok', missing: [] }));
  });
});
