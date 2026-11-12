import { maskCsvPhoneColumns } from '../../common/csv/csv-phone-mask';

/**
 * CSV files for the CA (they open in Excel). A cell that starts like a formula
 * is written as text, so a name like "=SUM(…)" can never run in a spreadsheet.
 */
export type CsvValue = string | number | null | undefined;

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  // A cell that starts like a formula is written as text — except a plain
  // number (a negative amount like -8000.00 must stay a number).
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/**
 * `viewerRole`: who downloads it. A phone column is masked for everyone but the CEO
 * (left out = masked fully), like JSON answers.
 */
export function toCsv(header: string[], rows: CsvValue[][], viewerRole?: string | null): string {
  return `${[header, ...maskCsvPhoneColumns(header, rows, viewerRole)].map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

/** Rupees with two decimals from integer paise, for spreadsheets (never a float in our books). */
export function rupees(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return '';
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
