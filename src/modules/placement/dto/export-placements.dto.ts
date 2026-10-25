export interface ExportPlacementsQueryDto {
  from?: string;
  to?: string;
  status?: string;
  area?: string;
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
  area: string;
  city: string;
}

export function formatPlacementsCsv(rows: RegulatoryPlacementExportRow[]): string {
  const headers = [
    'Placement Code',
    'Joined Date',
    'Dropout Date',
    'Trade Skill',
    'Candidate Code',
    'Employer Code',
    'Employer Name',
    'Monthly Salary (INR)',
    'Placement Fee (INR)',
    'Status',
    'Area',
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
  for (const row of rows) {
    lines.push([
      escapeCsv(row.placementCode),
      escapeCsv(row.joinedDate),
      escapeCsv(row.dropoutDate),
      escapeCsv(row.tradeSkill),
      escapeCsv(row.candidateCode),
      escapeCsv(row.employerCode),
      escapeCsv(row.employerName),
      escapeCsv(row.monthlySalaryINR),
      escapeCsv(row.placementFeeINR),
      escapeCsv(row.status),
      escapeCsv(row.area),
      escapeCsv(row.city),
    ].join(','));
  }
  return lines.join('\n');
}
