import * as fs from 'fs';
import * as path from 'path';

/**
 * Where the built Laboura Field web app (field/dist, from
 * `expo export --platform web`) is. FIELD_DIST_DIR, when set, is the only
 * place looked at (tests, unusual deploys); otherwise the repository's
 * field/dist, found from the working directory (Render runs from the repo
 * root) or from this file (dist/modules/field-app → repo root).
 */
export function resolveFieldDistDir(): string | null {
  const candidates = process.env.FIELD_DIST_DIR
    ? [process.env.FIELD_DIST_DIR]
    : [path.resolve(process.cwd(), 'field', 'dist'), path.resolve(__dirname, '..', '..', '..', 'field', 'dist')];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) return path.resolve(dir);
  }
  return null;
}

/** Files that must always be re-checked: the app shell, the service worker and the manifest. */
const ALWAYS_FRESH = new Set(['sw.js', 'register-sw.js', 'manifest.webmanifest']);

export type FieldAppFile =
  | { kind: 'file'; absolutePath: string; cache: 'immutable' | 'fresh' | 'hour'; serviceWorker: boolean }
  | { kind: 'index'; absolutePath: string }
  | { kind: 'missing' };

/**
 * Maps a request path under /field to what should be sent:
 * - an existing file inside field/dist (hashed bundles under _expo/static/
 *   and assets/ are cached forever; sw.js, register-sw.js and the manifest
 *   never);
 * - a path that looks like a file (has an extension) but does not exist → 404,
 *   so a broken script tag never receives HTML;
 * - anything else is a screen of the app → index.html.
 * Paths that escape field/dist (../) are refused.
 */
export function resolveFieldAppFile(distDir: string, requestPath: string): FieldAppFile {
  let relative: string;
  try {
    relative = decodeURIComponent(requestPath.replace(/^\/field(\/|$)/, ''));
  } catch {
    return { kind: 'missing' };
  }
  if (relative.includes('\0')) return { kind: 'missing' };
  const target = path.resolve(distDir, relative);
  const inside = target === distDir || target.startsWith(distDir + path.sep);
  if (!inside) return { kind: 'missing' };

  if (relative !== '' && fs.existsSync(target) && fs.statSync(target).isFile()) {
    if (path.basename(target) === 'index.html' && path.dirname(target) === distDir) {
      return { kind: 'index', absolutePath: target };
    }
    const immutable = relative.startsWith('_expo/static/') || relative.startsWith('assets/');
    return {
      kind: 'file',
      absolutePath: target,
      cache: ALWAYS_FRESH.has(relative) ? 'fresh' : immutable ? 'immutable' : 'hour',
      serviceWorker: relative === 'sw.js',
    };
  }
  if (relative.startsWith('_expo/') || relative.startsWith('assets/') || path.extname(relative) !== '') {
    return { kind: 'missing' };
  }
  return { kind: 'index', absolutePath: path.join(distDir, 'index.html') };
}
