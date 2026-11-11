import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';

/**
 * Every scheduled job leaves a JobRun row for each run: when it started, when
 * it finished, whether it succeeded, and the error when it failed. Same
 * pattern as the no-pickup sweep and the retention cleanup (which record
 * inside their own run, with their own counts).
 *
 * Only the numbers a job returns are kept in `details` (counts like
 * `{ raised: 3 }`), never ids or personal data. A failed write is logged and
 * never fails the job itself; the job's own error is always re-thrown so
 * BullMQ retries it.
 *
 * `job-run-recording.spec.ts` fails when a scheduled job is added without it.
 */
const logger = new Logger('JobRunRecorder');

export function numericSummary(result: unknown): Record<string, number> {
  if (typeof result === 'number') return { result };
  if (!result || typeof result !== 'object' || Array.isArray(result)) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(result as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (Array.isArray(value)) out[`${key}Count`] = value.length;
  }
  return out;
}

async function write(prisma: PrismaService | undefined, data: Prisma.JobRunCreateInput): Promise<void> {
  if (!prisma?.jobRun) return;
  try {
    await prisma.jobRun.create({ data });
  } catch (err: unknown) {
    logger.error(`Could not record JobRun for ${data.jobName}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function recordJobRun<T>(
  prisma: PrismaService | undefined,
  jobName: string,
  run: () => Promise<T>,
  clock: () => Date = () => new Date(),
): Promise<T> {
  const startedAt = clock();
  let result: T;
  try {
    result = await run();
  } catch (err: unknown) {
    await write(prisma, {
      jobName,
      startedAt,
      finishedAt: clock(),
      outcome: 'failed',
      details: { error: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
  const summary = numericSummary(result);
  await write(prisma, {
    jobName,
    startedAt,
    finishedAt: clock(),
    outcome: 'success',
    evaluated: summary.evaluated ?? 0,
    details: summary,
  });
  return result;
}
