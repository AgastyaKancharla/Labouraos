/**
 * The one way every CSV download writes a cell (IN-3 / INF-6). CSV files are
 * opened in Excel or Google Sheets, where a cell that starts with = + - @, a
 * tab or a carriage return can run as a formula ("=HYPERLINK(...)" that sends
 * data away, "=cmd|..." on old Excel). Such a cell is written as text by
 * putting an apostrophe in front, so it shows exactly what was typed and never
 * runs. A plain number (a negative amount like -8000.00) stays a number.
 *
 * Every CSV builder in src/ must write its cells with csvCell (or toCsv);
 * src/common/csv/csv-formula-guard.spec.ts fails the build otherwise.
 */
export type CsvValue = string | number | null | undefined;

/** Starts like a spreadsheet formula. */
export const CSV_FORMULA_START = /^[=+\-@\t\r]/;

const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (CSV_FORMULA_START.test(text) && !PLAIN_NUMBER.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** One CSV line from its cells. */
export function csvLine(cells: CsvValue[]): string {
  return cells.map(csvCell).join(',');
}
