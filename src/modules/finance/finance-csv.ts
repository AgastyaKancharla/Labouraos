import { maskCsvPhoneColumns } from '../../common/csv/csv-phone-mask';
import { csvCell, type CsvValue } from '../../common/csv/csv-cell';

/**
 * CSV files for the CA (they open in Excel). Cells go through the shared
 * csvCell (src/common/csv/csv-cell.ts): a cell that starts like a formula is
 * written as text, so a name like "=SUM(…)" can never run in a spreadsheet.
 */
export { csvCell, type CsvValue };

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
