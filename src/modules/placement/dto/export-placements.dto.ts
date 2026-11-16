import { maskCsvPhoneColumns } from '../../../common/csv/csv-phone-mask';
import { csvCell, csvLine } from '../../../common/csv/csv-cell';

export interface ExportPlacementsQueryDto {
  from?: string;
  to?: string;
  status?: string;
  locality?: string;
}

export interface RegulatoryPlacementExportRow {
  placementCode: string;
  joinedDate: string;
  dropoutDate: string;
  tradeSkill: string;
  candidateCode: string;
  employerCode: string;
  employerName: string;
  monthlySalaryINR: number;
  placementFeeINR: number;
  status: string;
  locality: string | null;
  city: string;
}

export function formatPlacementsCsv(
  rows: RegulatoryPlacementExportRow[],
  options: { includeMoney?: boolean; viewerRole?: string | null } = {},
): string {
  const includeMoney = options.includeMoney !== false;
  const headers = [
    'Placement Code',
    'Joined Date',
    'Dropout Date',
    'Trade Skill',
    'Candidate Code',
    'Employer Code',
    'Employer Name',
    // The employee's salary is a job detail every role may see; the fee is company money.
    'Monthly Salary (INR)',
    ...(includeMoney ? ['Placement Fee (INR)'] : []),
    'Status',
    'Locality',
    'City',
  ];

  // IN-3: every cell goes through the shared csvCell, so a business name or
  // locality typed as "=HYPERLINK(...)" opens as text, never as a formula.
  const lines = [csvLine(headers)];
  const body = rows.map((row) => [
      row.placementCode,
      row.joinedDate,
      row.dropoutDate,
      row.tradeSkill,
      row.candidateCode,
      row.employerCode,
      row.employerName,
      row.monthlySalaryINR,
      ...(includeMoney ? [row.placementFeeINR] : []),
      row.status,
      row.locality,
      row.city,
    ]);
  for (const cells of maskCsvPhoneColumns(headers, body, options.viewerRole)) {
    lines.push(cells.map(csvCell).join(','));
  }
  return lines.join('\n');
}
