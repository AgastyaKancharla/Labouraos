import * as fs from 'fs';
import * as path from 'path';
import { maskCsvPhoneColumns } from './csv-phone-mask';
import { toCsv } from '../../modules/finance/finance-csv';
import { formatPlacementsCsv } from '../../modules/placement/dto/export-placements.dto';

/**
 * Downloads follow the JSON phone rule: full numbers for the CEO only, last 4 digits
 * for agents, Team Leads and Managers, none for Finance or an unknown downloader.
 * No export has a phone column today; this is the guard for later.
 */
describe('CSV downloads mask phone columns like JSON answers', () => {
  const header = ['Code', 'Name', 'Mobile number', 'WhatsApp', 'Amount (Rs)'];
  const rows = [['JS-00042', 'Ravi', '+919845012345', '9845099999', '499.00']];

  it('keeps full numbers for the CEO only', () => {
    expect(maskCsvPhoneColumns(header, rows, 'ceo')).toEqual(rows);
  });

  it('gives Finance, and a download that does not say who, no digit of a phone', () => {
    for (const role of ['finance', undefined, null, 'someone_new']) {
      expect(maskCsvPhoneColumns(header, rows, role)).toEqual([['JS-00042', 'Ravi', '********', '********', '499.00']]);
    }
  });

  it('gives agents, Team Leads and Managers the last 4 digits', () => {
    for (const role of ['call_agent', 'field_agent', 'team_lead', 'manager']) {
      expect(maskCsvPhoneColumns(header, rows, role)).toEqual([['JS-00042', 'Ravi', '******2345', '******9999', '499.00']]);
    }
  });

  it('applies through the shared toCsv helper', () => {
    expect(toCsv(header, rows, 'finance')).toBe('Code,Name,Mobile number,WhatsApp,Amount (Rs)\nJS-00042,Ravi,********,********,499.00\n');
    expect(toCsv(header, rows, 'ceo')).toContain('+919845012345');
  });

  it('changes nothing in an export with no phone column', () => {
    const row = {
      placementCode: 'PL-00001', joinedDate: '2026-11-01', dropoutDate: '', tradeSkill: 'cook', candidateCode: 'JS-00001', employerCode: 'BZ-00001',
      employerName: 'Hotel', monthlySalaryINR: 20000, placementFeeINR: 10000, status: 'active', locality: 'BTM', city: 'Bengaluru',
    };
    expect(formatPlacementsCsv([row], { viewerRole: 'finance' })).toBe(formatPlacementsCsv([row], { viewerRole: 'ceo' }));
  });

  it('is used by every file that builds CSV cells itself (the guard for later exports)', () => {
    const root = path.join(__dirname, '..', '..');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') && !full.includes(`${path.sep}templates${path.sep}`)) files.push(full);
      }
    };
    walk(root);
    // A cell escaper is the mark of a hand-built CSV: csvCell / escapeCsv / csvEscape.
    const builder = /(function\s+(csvCell|escapeCsv|csvEscape)\s*\(|private\s+(csvCell|escapeCsv|csvEscape)\s*\(|const\s+(csvCell|escapeCsv|csvEscape)\s*=)/;
    const builders = files.filter((f) => builder.test(fs.readFileSync(f, 'utf8')));
    expect(builders.length).toBeGreaterThanOrEqual(4);
    const unguarded = builders.filter((f) => !fs.readFileSync(f, 'utf8').includes('maskCsvPhoneColumns')).map((f) => path.relative(root, f));
    expect(unguarded).toEqual([]);
  });
});
