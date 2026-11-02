import * as fs from 'fs';
import * as path from 'path';

describe('Pricing Literals Guard (Phase 9 Task 2)', () => {
  function getAllTsFiles(dir: string): string[] {
    let results: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results = results.concat(getAllTsFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        results.push(fullPath);
      }
    }
    return results;
  }

  function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  }

  const srcDir = path.resolve(__dirname, '../../');
  const productionFiles = getAllTsFiles(srcDir).filter((file) => {
    return (
      !file.endsWith('.spec.ts') &&
      !file.endsWith('.test.ts') &&
      !file.includes(`${path.sep}test-support${path.sep}`)
    );
  });

  it('rejects activation-fee literals, including disguised products such as 499 * 100', () => {
    for (const file of productionFiles) {
      const content = stripComments(fs.readFileSync(file, 'utf-8'));
      const match49900 = content.match(/\b49900\b/);
      expect(match49900 ? `Found 49900 in ${file}` : null).toBeNull();
      const disguised = content.match(/499\s*\*\s*100/);
      expect(disguised ? `Found 499 * 100 in ${file}` : null).toBeNull();
      const referral = content.match(/referralPayout.*20000|REFERRAL_PAYOUT_AMOUNT_PAISE/);
      expect(referral ? `Found referral 20000 in ${file}` : null).toBeNull();
      const fee50 = content.match(/Math\.round\(\(monthlySalaryPaise\s*\*\s*50\)\s*\/\s*100\)/);
      expect(fee50 ? `Found fee percent 50 in ${file}` : null).toBeNull();
      const gst18 = content.match(/Math\.round\(\(amountPaise\s*\*\s*18\)\s*\/\s*100\)/);
      expect(gst18 ? `Found GST percent 18 in ${file}` : null).toBeNull();
    }
  });

  it('rejects hard-coded rule numbers in services', () => {
    const serviceFiles = productionFiles.filter(
      (file) => file.endsWith('.service.ts') || file.endsWith('-eligibility.ts'),
    );
    const patterns: Array<[RegExp, string]> = [
      [/499\s*\*\s*100/, '499 * 100'],
      [/\?\?\s*\(?\s*499\s*\*\s*100/, 'activation-fee fallback'],
      [/\?\?\s*30\b/, '?? 30'],
      [/\?\?\s*60\b/, '?? 60'],
      [/\?\?\s*15\b/, '?? 15'],
      [/\?\?\s*3\b/, '?? 3'],
      [/\?\?\s*50\b/, '?? 50'],
      [/\?\?\s*18\b/, '?? 18'],
      [/return\s+20000\b/, 'return 20000'],
      [/jobSeekerGuaranteeDays\s*:\s*30\b/, 'guarantee days 30'],
      [/replacementWindowDays\s*:\s*60\b/, 'replacement window 60'],
      [/replacementSearchDays\s*:\s*15\b/, 'search days 15'],
      [/maxHits\s*:\s*3\b/, 'max hits 3'],
      [/placementFeePercent\s*:\s*50\b/, 'fee percent 50'],
      [/gstPercent\s*:\s*18\b/, 'gst 18'],
      [/guaranteeDays\s*=\s*30\b/, 'guaranteeDays = 30'],
      [/searchDays\s*=\s*15\b/, 'searchDays = 15'],
      [/windowDays\s*=\s*60\b/, 'windowDays = 60'],
      [/\b(?:30|60|15)\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000\b/, 'hard-coded day window'],
      [/REFUND_GUARANTEE_WINDOW/, 'refund window constant'],
      [/REPLACEMENT_GUARANTEE_WINDOW/, 'replacement window constant'],
      [/REPLACEMENT_SEARCH_WINDOW/, 'search window constant'],
    ];

    for (const file of serviceFiles) {
      const content = stripComments(fs.readFileSync(file, 'utf-8'));
      for (const [pattern, label] of patterns) {
        const match = content.match(pattern);
        expect(match ? `Found ${label} in ${file}` : null).toBeNull();
      }
    }
  });
});
