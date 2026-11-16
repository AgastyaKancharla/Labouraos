import { useCallback } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';

/** Every list and page of the redesign (Today, Visits, My businesses, My job seekers, the business page) is under this key. */
export const FIELD_WORK_KEY = ['field-work'] as const;

/**
 * After any save or send in the redesign (job seeker, referral partner,
 * vacancy, visit result, changed result, agreement link…): mark Today,
 * Visits, My businesses, My job seekers and the business pages out of date,
 * so the next screen shows the new record without a reload (fix list A1).
 * Pass other keys the step changed too (e.g. ['selling']).
 */
export function useAfterSave() {
  const client = useQueryClient();
  return useCallback(
    (...more: QueryKey[]) => {
      void client.invalidateQueries({ queryKey: FIELD_WORK_KEY });
      for (const key of more) void client.invalidateQueries({ queryKey: key });
    },
    [client],
  );
}
