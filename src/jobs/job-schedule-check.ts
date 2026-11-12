import type Redis from 'ioredis';
import { JOB_CATALOG, JobCatalogEntry, schedulerSetKey } from './job-catalog';

/** The one Redis command the check needs, so tests can pass a fake. */
export type ScheduleReader = Pick<Redis, 'zscore'>;

/**
 * Which repeating jobs have no scheduler in Redis right now. Reads only
 * (ZSCORE on each queue's scheduler set); never creates anything.
 */
export async function missingSchedules(
  client: ScheduleReader,
  catalog: readonly JobCatalogEntry[] = JOB_CATALOG,
): Promise<JobCatalogEntry[]> {
  const scores = await Promise.all(
    catalog.map((entry) => client.zscore(schedulerSetKey(entry.queue), entry.schedulerId)),
  );
  return catalog.filter((_, index) => scores[index] === null || scores[index] === undefined);
}
