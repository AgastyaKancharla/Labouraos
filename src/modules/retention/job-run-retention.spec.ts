import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JOB_RUN_RETENTION_DAYS } from './retention.policy';
import { RETENTION_JOB_NAME, RetentionService } from './retention.service';

/**
 * The job run log grows by about 1,800 rows a day. The daily keeping-data job
 * deletes JobRun rows older than 90 days, keeps each job's latest run (System
 * Health and the stale-sweep alerts read it), and records its own run.
 */
describe('Keeping data: the job run log', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let retention: RetentionService;
  const now = new Date('2026-11-16T00:30:00.000Z');
  const day = 24 * 60 * 60 * 1000;
  const tag = `jrr-${Date.now()}`;
  const job = (name: string) => `${tag}-${name}`;

  async function run(jobName: string, daysAgo: number) {
    const at = new Date(now.getTime() - daysAgo * day);
    return prisma.jobRun.create({
      data: { jobName, startedAt: at, finishedAt: at, outcome: 'success', createdAt: at },
    });
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    retention = app.get(RetentionService);
  });

  afterAll(async () => {
    await prisma.jobRun.deleteMany({ where: { jobName: { startsWith: tag } } });
    await app.close();
  });

  it('keeps runs for 90 days', () => {
    expect(JOB_RUN_RETENTION_DAYS).toBe(90);
  });

  it('deletes runs older than 90 days, keeps newer ones and each job’s latest run, and records its own run', async () => {
    const old1 = await run(job('nightly'), 120);
    const old2 = await run(job('nightly'), 91);
    const edge = await run(job('nightly'), 89);
    const recent = await run(job('nightly'), 1);
    // A job that has not run for months: its last run stays so "last ran" is still known.
    const onlyOld = await run(job('monthly'), 200);
    const olderOfMonthly = await run(job('monthly'), 230);

    // A dry run counts without deleting.
    const dry = await retention.runRetentionCleanup({ now, dryRun: true });
    expect(dry.jobRunsDeleted).toBeGreaterThanOrEqual(3);
    expect(await prisma.jobRun.count({ where: { id: { in: [old1.id, old2.id, olderOfMonthly.id] } } })).toBe(3);

    const summary = await retention.runRetentionCleanup({ now, dryRun: false });
    expect(summary.jobRunsDeleted).toBeGreaterThanOrEqual(3);

    const left = await prisma.jobRun.findMany({ where: { jobName: { startsWith: tag } }, select: { id: true } });
    const ids = left.map((r) => r.id).sort();
    expect(ids).toEqual([edge.id, recent.id, onlyOld.id].sort());

    // Its own run is recorded, with the count.
    const own = await prisma.jobRun.findFirstOrThrow({ where: { jobName: RETENTION_JOB_NAME, outcome: 'success' }, orderBy: { createdAt: 'desc' } });
    expect((own.details as { jobRunsDeleted?: number }).jobRunsDeleted).toBe(summary.jobRunsDeleted);
    expect((await retention.getLatestSummary())?.jobRunsDeleted).toBe(summary.jobRunsDeleted);
  });
});
