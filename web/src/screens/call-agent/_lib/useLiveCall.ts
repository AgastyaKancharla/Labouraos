import { useQueryClient } from '@tanstack/react-query';
import { useLiveEvent } from '../../../lib/live/liveChannel';
import { callWorkKeys, useCallState } from './api';

/** The call's state from the calling system: polled, and refreshed at once by the live channel. */
export function useLiveCall(id: string) {
  const qc = useQueryClient();
  const state = useCallState(id);
  useLiveEvent<{ callRecordId?: string }>('call_status', (data) => {
    if (data.callRecordId === id) void qc.invalidateQueries({ queryKey: callWorkKeys.call(id) });
  });
  return state;
}
