/**
 * List downloads. The designs label them "Download (Excel)"; the file is a
 * UTF-8 CSV with a byte-order mark, which Excel opens directly with ₹ and
 * Kannada/Hindi text intact.
 *
 * Only the CEO, Managers and Finance may download lists (guide: "nobody below
 * Manager can download or export lists"). The API enforces it; the UI hides
 * the button through canExportLists().
 */
import type { StaffRole } from '../auth/roles';

export function canExportLists(role: StaffRole | undefined): boolean {
  return role === 'ceo' || role === 'manager' || role === 'finance';
}

export interface CsvColumn<Row> {
  header: string;
  value: (row: Row) => string | number | null | undefined;
}

/** Zero-width characters and the byte-order mark, which spreadsheets skip before a formula. */
const INVISIBLE_LEAD = /^[\s\u200b-\u200f\u2028-\u202f\u205f-\u206f\ufeff\u00ad\u180e]+/u;

/**
 * How a spreadsheet reads the start of a cell (L1): NFKC-normalised (full-width
 * ＝ ＋ ＠ become = + @), leading spaces, zero-width characters and the BOM
 * removed; a tab or carriage return at the very start is kept.
 */
export function formulaLead(value: string): string {
  const normalised = value.normalize('NFKC');
  if (/^[\t\r]/.test(normalised)) return normalised;
  return normalised.replace(INVISIBLE_LEAD, '');
}

/** Cells that start like a formula (= + - @ tab CR, after formulaLead) get a ' so Excel never runs them. */
export function escapeCell(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined) return '';
  let s = String(raw);
  if (/^[=+\-@\t\r]/.test(formulaLead(s))) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv<Row>(rows: readonly Row[], columns: readonly CsvColumn<Row>[]): string {
  const lines = [columns.map((c) => escapeCell(c.header)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => escapeCell(c.value(row))).join(','));
  return lines.join('\r\n');
}

export function downloadTextFile(filename: string, content: string, mime = 'text/csv;charset=utf-8'): void {
  const blob = new Blob(['﻿', content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
