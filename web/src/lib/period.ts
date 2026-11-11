import { addDaysToKey, formatDayMonthIST, istDateKey, istEndOfDay, istStartOfDay } from './format/date';

/**
 * The date presets every staff screen shows: Today / This week / This month /
 * Custom with a from–to range. Ranges are IST calendar days, inclusive.
 * "This week" is the last 7 days including today and "This month" runs from
 * the 1st — both as the designs label them ("this week (3–9 Nov)" on 9 Nov,
 * "this month (1–9 Nov)").
 */
export type PeriodPreset = 'today' | 'week' | 'month' | 'custom';

export interface Period {
  preset: PeriodPreset;
  /** yyyy-mm-dd, IST, inclusive */
  from: string;
  /** yyyy-mm-dd, IST, inclusive */
  to: string;
}

export function periodFor(preset: Exclude<PeriodPreset, 'custom'>, now: Date): Period {
  const today = istDateKey(now);
  if (preset === 'today') return { preset, from: today, to: today };
  if (preset === 'week') return { preset, from: addDaysToKey(today, -6), to: today };
  return { preset, from: `${today.slice(0, 8)}01`, to: today };
}

export function customPeriod(from: string, to: string): Period {
  return from <= to ? { preset: 'custom', from, to } : { preset: 'custom', from: to, to: from };
}

/** The UTC instants an API query should use for this period. */
export function periodToUtcRange(period: Period): { fromDate: string; toDate: string } {
  return {
    fromDate: istStartOfDay(period.from).toISOString(),
    toDate: istEndOfDay(period.to).toISOString(),
  };
}

/** "1–9 Nov", "9 Nov", "28 Oct – 3 Nov" */
export function periodRangeLabel(period: Period): string {
  const from = istStartOfDay(period.from);
  const to = istStartOfDay(period.to);
  if (period.from === period.to) return formatDayMonthIST(from);
  const [fy, fm] = period.from.split('-');
  const [ty, tm] = period.to.split('-');
  if (fy === ty && fm === tm) return `${Number(period.from.slice(8))}–${formatDayMonthIST(to)}`;
  return `${formatDayMonthIST(from)} – ${formatDayMonthIST(to)}`;
}
