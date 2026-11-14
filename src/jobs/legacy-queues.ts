import { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { JOB_CATALOG, JobCatalogEntry, schedulerSetKey, SHARED_JOB_QUEUE } from './job-catalog';
import { jobQueue } from './job-queue';

/**
 * Before the shared queue, every job had a queue of its own, with its schedule
 * in it. A Key Value that keeps its data (the paid one, or a free one that has
 * not restarted) still holds those old schedules; nothing reads those queues
 * any more, so they are removed once, and recording copies still waiting in
 * the old `recording-copy` queue are moved to the shared queue.
 *
 * Safe to repeat: it only acts on what is still there. Uses the shared
 * connection; a Queue object on it opens no connection.
 */
export const LEGACY_RECORDING_COPY_QUEUE = 'recording-copy';

export interface LegacyCleanupResult {
  removedSchedules: string[];
  movedRecordingCopies: number;
}

type LegacyReader = Pick<Redis, 'zscore' | 'exists'>;

/**
 * Jobs that no longer exist. Their schedule may still sit in a Key Value that
 * kept its data — in the job's own old queue, or in the shared queue — and a
 * shared-queue schedule with no handler would fire for nothing; both go.
 * - kycRecovery: the outside ID company's outage probe (retired with the
 *   company, PR #135: Aadhaar is checked in-house, other IDs by a Team Lead).
 */
export const RETIRED_SCHEDULES: readonly { key: string; queues: readonly string[]; schedulerId: string }[] = [
  { key: 'kycRecovery', queues: ['kyc-recovery', SHARED_JOB_QUEUE], schedulerId: 'kyc-recovery-scheduler' },
];

/** The retired schedules still present, queue by queue (read only). */
export async function retiredSchedulesPresent(
  reader: Pick<Redis, 'zscore'>,
  retired: typeof RETIRED_SCHEDULES = RETIRED_SCHEDULES,
): Promise<{ key: string; queue: string; schedulerId: string }[]> {
  const found: { key: string; queue: string; schedulerId: string }[] = [];
  for (const entry of retired) {
    for (const queue of entry.queues) {
      const score = await reader.zscore(schedulerSetKey(queue), entry.schedulerId);
      if (score !== null && score !== undefined) found.push({ key: entry.key, queue, schedulerId: entry.schedulerId });
    }
  }
  return found;
}

function legacyQueue(name: string, client: Redis): Queue {
  const queue = new Queue(name, { connection: client });
  queue.on('error', () => undefined);
  return queue;
}

export async function cleanUpLegacyQueues(
  client: Redis,
  catalog: readonly JobCatalogEntry[] = JOB_CATALOG,
  reader: LegacyReader = client,
): Promise<LegacyCleanupResult> {
  const result: LegacyCleanupResult = { removedSchedules: [], movedRecordingCopies: 0 };

  for (const entry of catalog) {
    if (!entry.legacyQueue || entry.legacyQueue === entry.queue) continue;
    const score = await reader.zscore(schedulerSetKey(entry.legacyQueue), entry.schedulerId);
    if (score === null || score === undefined) continue;
    const queue = legacyQueue(entry.legacyQueue, client);
    try {
      await queue.removeJobScheduler(entry.schedulerId);
      result.removedSchedules.push(entry.key);
    } finally {
      await queue.close();
    }
  }

  for (const retired of await retiredSchedulesPresent(reader)) {
    const queue = retired.queue === SHARED_JOB_QUEUE ? jobQueue.queue() : legacyQueue(retired.queue, client);
    try {
      await queue.removeJobScheduler(retired.schedulerId);
      result.removedSchedules.push(`${retired.key} (retired)`);
    } finally {
      if (retired.queue !== SHARED_JOB_QUEUE) await queue.close();
    }
  }

  if (await reader.exists(`bull:${LEGACY_RECORDING_COPY_QUEUE}:id`)) {
    const queue = legacyQueue(LEGACY_RECORDING_COPY_QUEUE, client);
    try {
      const waiting = await queue.getJobs(['waiting', 'delayed', 'prioritized'], 0, 999);
      for (const job of waiting) {
        if (!job?.id) continue;
        await jobQueue.add(job.name, job.data, {
          jobId: job.id,
          attempts: job.opts.attempts,
          backoff: job.opts.backoff,
          removeOnComplete: true,
        });
        await job.remove().catch(() => undefined);
        result.movedRecordingCopies += 1;
      }
    } finally {
      await queue.close();
    }
  }

  return result;
}
