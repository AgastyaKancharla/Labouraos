import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Owner decision (14 Nov): remove the old outside Aadhaar route (the
 * government document-wallet service) completely. Nothing in the code,
 * screens, translations, settings, jobs, tests, docs or the consent notice may
 * name it any more — only the database migrations (history) may. The word is
 * built from parts here so this test doesn't find itself.
 */
const ROOT = join(__dirname, '..', '..', '..');
const NAME = new RegExp(['digi', 'locker'].join('\\s*'), 'i');
// The Kannada and Hindi spellings used before.
const LOCAL = new RegExp([['ಡಿಜಿ', 'ಲಾಕ'], ['डिजी', 'लॉक'], ['डिजि', 'लॉक']].map((parts) => parts.join('')).join('|'));
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-root', 'coverage', 'migrations', '.expo']);
const TEXT = /\.(ts|tsx|js|mjs|cjs|json|md|yaml|yml|prisma|html|css|sql|txt)$/;

function* files(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) yield* files(path);
    else if (TEXT.test(entry) && stat.size < 2_000_000 && !entry.endsWith('-lock.json')) yield path;
  }
}

describe('the old outside Aadhaar route is gone (guide, 14 Nov)', () => {
  it('is named nowhere outside the database migrations', () => {
    const found: string[] = [];
    for (const top of ['src', 'web/src', 'field/src', 'field/scripts', 'prisma', 'docs', 'specs', 'scripts', 'test']) {
      let start: string;
      try {
        start = join(ROOT, top);
        statSync(start);
      } catch {
        continue;
      }
      for (const file of files(start)) {
        const text = readFileSync(file, 'utf8');
        if (NAME.test(text) || LOCAL.test(text)) found.push(relative(ROOT, file));
      }
    }
    for (const file of ['AGENTS.md', 'DEPLOY.md', 'LESSONS.md', 'render.yaml', 'render.free.yaml', 'package.json']) {
      try {
        const text = readFileSync(join(ROOT, file), 'utf8');
        if (NAME.test(text) || LOCAL.test(text)) found.push(file);
      } catch {
        // not every file exists in every checkout
      }
    }
    expect(found).toEqual([]);
  });
});
