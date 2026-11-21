/**
 * Date of birth typed as numbers (Master Guide rev 204, 21 Nov): the agent
 * types 22092006 and the field shows 22-09-2006 (DD-MM-YYYY), the dashes added
 * as the digits come. The value saved is the same ISO day as before
 * ('yyyy-mm-dd'). Pure helpers, shared by the field and its tests.
 */

/** Digits only, at most 8, with a dash after the day and the month: "22092006" → "22-09-2006". */
export function maskDobDigits(input: string): string {
  const d = (input ?? '').replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}-${d.slice(2)}`;
  return `${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4)}`;
}

/** "22-09-2006" → "2006-09-22" when it is a real calendar day (no 31-02, no 29-02 outside leap years); otherwise null. */
export function dobTextToKey(text: string): string | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(text ?? '');
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (year < 1900 || month < 1 || month > 12 || day < 1) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** "2006-09-22" → "22-09-2006" ('' for anything else). */
export function keyToDobText(key: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key ?? '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

export type DobTextProblem = 'incomplete' | 'not_a_date' | 'future' | null;

/** Why the typed text is not a usable date of birth (null when it is, or when nothing is typed). */
export function dobTextProblem(text: string, todayKey: string): DobTextProblem {
  if (!text) return null;
  if (text.length < 10) return 'incomplete';
  const key = dobTextToKey(text);
  if (!key) return 'not_a_date';
  if (key > todayKey) return 'future';
  return null;
}
