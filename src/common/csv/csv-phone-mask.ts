import { isPhoneLikeKey, maskPhoneLast4 } from '../rbac/pii-masking.interceptor';

/**
 * Downloads follow the same phone rule as JSON answers (pii-masking.interceptor.ts):
 * only the CEO sees full numbers; agents, Team Leads and Managers the last 4 digits;
 * Finance and anyone else (or a caller that does not say who is downloading) none.
 * A column is a phone column when its header reads like one (phone, mobile,
 * WhatsApp, contact number…). No export has one today: this is the guard for later,
 * and every CSV builder runs its rows through it (csv-phone-mask.spec.ts checks).
 */
const LAST4_ROLES = new Set(['call_agent', 'field_agent', 'team_lead', 'manager']);

export type CsvCellValue = string | number | null | undefined;

export function maskCsvPhoneColumns<T extends CsvCellValue>(header: readonly string[], rows: T[][], viewerRole: string | null | undefined): T[][] {
  if (viewerRole === 'ceo') return rows;
  const phoneColumns = header.map((h, i) => (isPhoneLikeKey(h) ? i : -1)).filter((i) => i >= 0);
  if (!phoneColumns.length) return rows;
  return rows.map((row) =>
    row.map((cell, i) => {
      if (!phoneColumns.includes(i) || cell === null || cell === undefined || !/\d/.test(String(cell))) return cell;
      if (viewerRole && LAST4_ROLES.has(viewerRole)) {
        return (String(cell).replace(/\D/g, '').length > 4 ? maskPhoneLast4(cell) : cell) as T;
      }
      return '********' as T;
    }),
  );
}
