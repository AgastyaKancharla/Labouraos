import * as fs from 'node:fs';
import * as path from 'node:path';
import { PrismaService } from '../common/prisma/prisma.service';
import { numericSummary, recordJobRun } from './job-run-recorder';

/**
 * Every scheduled or nightly job records a JobRun row (start, finish,
 * success/failed, the error). This file fails when a job is registered with
 * BullMQ's upsertJobScheduler but its worker does not record.
 */
const SRC = path.resolve(__dirname, '..');

/**
 * Jobs that record inside their own run, with their own counts, instead of
 * through recordJobRun. Each must write both a success and a failed row.
 */
const RECORDS_INSIDE_ITS_RUN: Record<string, string> = {
  'jobs/no-pickup-evaluation.job.ts': 'jobs/no-pickup-evaluation.job.ts',
  'jobs/retention-cleanup.job.ts': 'modules/retention/retention.service.ts',
};

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [full] : [];
  });
}

describe('JobRun for every scheduled job', () => {
  const scheduled = sourceFiles(SRC)
    .filter((file) => fs.readFileSync(file, 'utf8').includes('upsertJobScheduler('))
    .map((file) => path.relative(SRC, file).split(path.sep).join('/'));

  it('finds the scheduled jobs (sanity check)', () => {
    expect(scheduled.length).toBeGreaterThanOrEqual(13);
  });

  it.each(scheduled.map((f) => [f]))('%s records a JobRun for every run', (file) => {
    const source = fs.readFileSync(path.join(SRC, file), 'utf8');
    const selfRecording = RECORDS_INSIDE_ITS_RUN[file];
    if (selfRecording) {
      const run = fs.readFileSync(path.join(SRC, selfRecording), 'utf8');
      expect(run).toContain('jobRun.create(');
      expect(run).toMatch(/outcome: 'success'/);
      expect(run).toMatch(/outcome: 'failed'/);
      return;
    }
    // The worker's processor goes through recordJobRun, with PrismaService injected.
    const worker = source.slice(source.indexOf('new Worker('));
    expect(worker.slice(0, 400)).toMatch(/recordJobRun\(this\.prisma, [A-Z_]+, /);
    expect(source).toMatch(/private readonly prisma\??: PrismaService/);
  });
});

describe('recordJobRun', () => {
  function fakePrisma() {
    const rows: Array<Record<string, unknown>> = [];
    const prisma = {
      jobRun: { create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => rows.push(data)) },
    } as unknown as PrismaService;
    return { prisma, rows };
  }

  it('records start, finish, success and the counts the job returned', async () => {
    const { prisma, rows } = fakePrisma();
    const times = [new Date('2026-11-11T18:30:00Z'), new Date('2026-11-11T18:30:07Z')];
    const result = await recordJobRun(prisma, 'daily-claim-overdue', async () => ({ raised: 3, ids: ['a', 'b'], note: 'x' }), () => times.shift()!);
    expect(result).toEqual({ raised: 3, ids: ['a', 'b'], note: 'x' });
    expect(rows).toEqual([
      {
        jobName: 'daily-claim-overdue',
        startedAt: new Date('2026-11-11T18:30:00Z'),
        finishedAt: new Date('2026-11-11T18:30:07Z'),
        outcome: 'success',
        evaluated: 0,
        details: { raised: 3, idsCount: 2 },
      },
    ]);
  });

  it('records a failed run with its error and re-throws so BullMQ retries', async () => {
    const { prisma, rows } = fakePrisma();
    await expect(
      recordJobRun(prisma, 'daily-win-back', async () => {
        throw new Error('database went away');
      }),
    ).rejects.toThrow('database went away');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ jobName: 'daily-win-back', outcome: 'failed', details: { error: 'database went away' } });
    expect(rows[0].finishedAt).toBeInstanceOf(Date);
  });

  it('a JobRun that cannot be written never fails the job', async () => {
    const prisma = { jobRun: { create: jest.fn().mockRejectedValue(new Error('no table')) } } as unknown as PrismaService;
    await expect(recordJobRun(prisma, 'daily-follow-up', async () => ({ created: 1 }))).resolves.toEqual({ created: 1 });
  });

  it('keeps only numbers from the result (never ids or personal data)', () => {
    expect(numericSummary({ evaluated: 4, name: 'Ravi', phones: ['+91…'] })).toEqual({ evaluated: 4, phonesCount: 1 });
    expect(numericSummary(7)).toEqual({ result: 7 });
    expect(numericSummary(undefined)).toEqual({});
  });
});
