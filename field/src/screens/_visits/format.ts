/** "6 min" style durations and "600 m" / "1.8 km" distances for the visit screens. */
export function minutesOf(seconds: number | null | undefined): number | null {
  if (seconds === null || seconds === undefined) return null;
  return Math.max(0, Math.round(seconds / 60));
}

/** "06:18" timer from milliseconds. */
export function formatTimer(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatDistance(meters: number | null | undefined): string {
  if (meters === null || meters === undefined || !Number.isFinite(meters)) return '';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** IST "YYYY-MM-DD" for a moment. */
export function istDateKey(at: Date | number | string): string {
  const ms = at instanceof Date ? at.getTime() : new Date(at).getTime();
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The next `count` IST dates from today, as keys. */
export function nextDateKeys(from: Date | number, count: number): string[] {
  const start = new Date(`${istDateKey(from)}T00:00:00.000Z`).getTime();
  return Array.from({ length: count }, (_, i) => new Date(start + i * 86_400_000).toISOString().slice(0, 10));
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Mon 16 Nov" for a date key. */
export function formatDateKey(key: string): string {
  const d = new Date(`${key}T00:00:00.000Z`);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "₹14–16k" for a monthly salary range in paise. */
export function salaryRange(minPaise: number | null, maxPaise: number | null): string {
  if (!minPaise) return '';
  const k = (p: number) => {
    const rupees = p / 100;
    return rupees >= 1000 ? `${Math.round(rupees / 100) / 10}k` : String(Math.round(rupees));
  };
  if (!maxPaise || maxPaise === minPaise) return `₹${k(minPaise)}`;
  return `₹${k(minPaise).replace('k', '')}–${k(maxPaise)}`;
}
