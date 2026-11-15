/** "15 Nov 2026, 14:05 IST" — timestamps are stored in UTC and shown in IST (UTC+05:30). */
export function formatIstDateTime(at: Date): string {
  const ist = new Date(at.getTime() + 330 * 60 * 1000);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${ist.getUTCDate()} ${months[ist.getUTCMonth()]} ${ist.getUTCFullYear()}, ${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())} IST`;
}
