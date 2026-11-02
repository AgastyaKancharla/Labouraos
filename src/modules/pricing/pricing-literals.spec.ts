import * as fs from 'fs';
import * as path from 'path';

describe('Pricing Literals Guard (Phase 9 Task 2)', () => {
  it('ensures no literal 49900, referral 20000, fee percent 50, or gst 18 remains in src/ outside tests', () => {
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

    const srcDir = path.resolve(__dirname, '../../');
    const files = getAllTsFiles(srcDir);
    const nonTestFiles = files.filter(
      (f) => !f.endsWith('.spec.ts') && !f.endsWith('.test.ts'),
    );

    for (const file of nonTestFiles) {
      const content = fs.readFileSync(file, 'utf-8');

      // 1. No literal 49900
      const match49900 = content.match(/\b49900\b/);
      expect(match49900 ? `Found 49900 in ${file}` : null).toBeNull();

      // 2. No referral payout literal 20000
      const matchReferral = content.match(/referralPayout.*20000|REFERRAL_PAYOUT_AMOUNT_PAISE/);
      expect(matchReferral ? `Found referral 20000 in ${file}` : null).toBeNull();

      // 3. No calculatePlacementFee hardcoding 50
      const matchPlacementFee50 = content.match(/Math\.round\(\(monthlySalaryPaise\s*\*\s*50\)\s*\/\s*100\)/);
      expect(matchPlacementFee50 ? `Found fee percent 50 in ${file}` : null).toBeNull();

      // 4. No calculateGst hardcoding 18
      const matchGst18 = content.match(/Math\.round\(\(amountPaise\s*\*\s*18\)\s*\/\s*100\)/);
      expect(matchGst18 ? `Found GST percent 18 in ${file}` : null).toBeNull();
    }
  });
});
