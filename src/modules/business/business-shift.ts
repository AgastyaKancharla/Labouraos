/**
 * Shifts per business (17 Nov, Master Guide rev 193) — pure helpers.
 * A shift is a name and an IST start / end time ("HH:MM", 24-hour); an end
 * before the start runs past midnight.
 */

export const MAX_SHIFTS_PER_BUSINESS = 12;
export const MAX_SHIFT_NAME = 40;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export interface ShiftInput {
  name: string;
  startTime: string;
  endTime: string;
}

/** "7:00", "07:00", "7" → "07:00"; anything else → null. */
export function normaliseTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = value.trim().match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!m) return null;
  const text = `${m[1].padStart(2, '0')}:${m[2] ?? '00'}`;
  return HHMM.test(text) ? text : null;
}

/** Checks a shift from a form; returns the clean values or the list of wrong fields. */
export function readShiftInput(body: unknown, partial = false): { value: Partial<ShiftInput>; errors: string[] } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const value: Partial<ShiftInput> = {};
  const errors: string[] = [];
  if (!partial || b.name !== undefined) {
    const name = typeof b.name === 'string' ? b.name.replace(/\s+/g, ' ').trim() : '';
    if (!name || name.length > MAX_SHIFT_NAME) errors.push('name');
    else value.name = name;
  }
  for (const key of ['startTime', 'endTime'] as const) {
    if (partial && b[key] === undefined) continue;
    const t = normaliseTime(b[key]);
    if (!t) errors.push(key);
    else value[key] = t;
  }
  if (value.startTime && value.endTime && value.startTime === value.endTime) errors.push('endTime');
  return { value, errors };
}

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Night hours for the day/night reading: 22:00 to 06:00. */
const NIGHT_START = 22 * 60;
const NIGHT_END = 6 * 60;

/**
 * Day or night, from the times (matching compares it with the job seeker's
 * shift preference day / night / rotational / any): a shift is "night" when
 * at least half of it falls between 22:00 and 06:00.
 */
export function shiftCategory(startTime: string, endTime: string): 'day' | 'night' {
  const start = minutes(startTime);
  let end = minutes(endTime);
  if (end <= start) end += 24 * 60;
  let night = 0;
  for (let m = start; m < end; m += 1) {
    const clock = m % (24 * 60);
    if (clock >= NIGHT_START || clock < NIGHT_END) night += 1;
  }
  return night * 2 >= end - start ? 'night' : 'day';
}

/** "Morning 07:00–15:00": what the vacancy shows and keeps in its `shift`. */
export function shiftLabel(shift: ShiftInput): string {
  return `${shift.name} ${shift.startTime}–${shift.endTime}`;
}

/**
 * What matching compares with the job seeker's preference: day/night from
 * the picked shift's times, else the vacancy's own `shift` word (older
 * vacancies: day, night, rotational or free text).
 */
export function vacancyShiftCategory(vacancy: { shift: string | null; shiftStartTime?: string | null; shiftEndTime?: string | null }): string | null {
  if (vacancy.shiftStartTime && vacancy.shiftEndTime && normaliseTime(vacancy.shiftStartTime) && normaliseTime(vacancy.shiftEndTime)) {
    return shiftCategory(vacancy.shiftStartTime, vacancy.shiftEndTime);
  }
  return vacancy.shift ? vacancy.shift.toLowerCase() : null;
}
