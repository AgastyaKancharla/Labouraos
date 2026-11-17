/**
 * How late a login was, everywhere lateness is shown (17 Nov): under an hour
 * in minutes ("47 min"), from an hour in hours and minutes ("1 h 5 min",
 * "2 h" when the minutes are 0). Negative or missing counts as 0.
 */
export function formatLateMinutes(minutes: number | null | undefined): string {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
