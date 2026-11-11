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

/** Cells starting with = + - @ are prefixed with ' so Excel never runs them as formulas. */
function escapeCell(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined) return '';
  let s = String(raw);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
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
