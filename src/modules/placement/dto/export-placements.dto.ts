import { maskCsvPhoneColumns } from '../../../common/csv/csv-phone-mask';

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

  const escapeCsv = (val: string | number | null | undefined): string => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines = [headers.join(',')];
  const body = rows.map((row) => [
      escapeCsv(row.placementCode),
      escapeCsv(row.joinedDate),
      escapeCsv(row.dropoutDate),
      escapeCsv(row.tradeSkill),
      escapeCsv(row.candidateCode),
      escapeCsv(row.employerCode),
      escapeCsv(row.employerName),
      escapeCsv(row.monthlySalaryINR),
      ...(includeMoney ? [escapeCsv(row.placementFeeINR)] : []),
      escapeCsv(row.status),
      escapeCsv(row.locality),
      escapeCsv(row.city),
    ]);
  for (const cells of maskCsvPhoneColumns(headers, body, options.viewerRole)) {
    lines.push(cells.join(','));
  }
  return lines.join('\n');
}
