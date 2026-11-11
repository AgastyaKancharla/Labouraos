/** Month helpers for the monthly screens (salaries, targets). Keys look like "2026-11". */
export function monthKeyOf(dateKey: string): string {
  return dateKey.slice(0, 7);
}

export function shiftMonth(monthKey: string, by: number): string {
  const [y, m] = monthKey.split('-').map(Number);
  const idx = y * 12 + (m - 1) + by;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

export function previousMonthKey(dateKey: string): string {
  return shiftMonth(monthKeyOf(dateKey), -1);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-11" → "November 2026"; short → "November". */
export function monthName(monthKey: string, withYear = true): string {
  const [y, m] = monthKey.split('-').map(Number);
  return withYear ? `${MONTHS[m - 1]} ${y}` : MONTHS[m - 1];
}

export function MonthPicker({ value, onChange, label = 'Month', max, min }: { value: string; onChange: (v: string) => void; label?: string; max?: string; min?: string }) {
  return (
    <label className="field" style={{ minWidth: 150 }}>
      {label}
      <input type="month" value={value} max={max} min={min} onChange={(e) => e.target.value && onChange(e.target.value)} />
    </label>
  );
}
