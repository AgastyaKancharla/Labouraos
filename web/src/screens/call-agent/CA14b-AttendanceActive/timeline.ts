import type { TodaySegment } from '../../../attendance/api';

/** One row of "Today so far": a status period, with Available, On call and After-call notes folded together. */
export interface TimelineBlock {
  status: string;
  startedAt: string;
  endedAt: string | null;
  /** Calls answered inside an Available block. */
  calls: number;
  /** System problem waiting for a Team Lead's approval. */
  waitingApproval: boolean;
}

const WORKING = new Set(['available', 'on_call', 'after_call_notes']);

/**
 * The CA14b timeline ("10:25 AM · Available · 14 calls · 40m"). Each call
 * makes an On call and an After-call notes period; they are folded into the
 * Available block around them and counted, so the list stays readable.
 */
export function timelineBlocks(segments: TodaySegment[]): TimelineBlock[] {
  const blocks: TimelineBlock[] = [];
  for (const segment of segments) {
    const group = WORKING.has(segment.status) ? 'available' : segment.status;
    const last = blocks[blocks.length - 1];
    if (last && last.status === group) {
      last.endedAt = segment.endedAt;
      if (segment.status === 'on_call') last.calls += 1;
      if (segment.status === 'system_problem' && segment.approved === false) last.waitingApproval = true;
      continue;
    }
    blocks.push({
      status: group,
      startedAt: segment.startedAt,
      endedAt: segment.endedAt,
      calls: segment.status === 'on_call' ? 1 : 0,
      waitingApproval: segment.status === 'system_problem' && segment.approved === false,
    });
  }
  return blocks;
}

/** Each short break's length, oldest first ("15m + 6m"). */
export function shortBreakSpans(segments: TodaySegment[], nowMs: number): number[] {
  return segments
    .filter((s) => s.status === 'short_break')
    .map((s) => Math.max(0, ((s.endedAt ? Date.parse(s.endedAt) : nowMs) - Date.parse(s.startedAt)) / 1000));
}
