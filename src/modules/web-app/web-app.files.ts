import * as fs from 'fs';
import * as path from 'path';

/**
 * Where the built React app (web/dist) is. WEB_DIST_DIR, when set, is the
 * only place looked at (tests, unusual deploys); otherwise the repository's
 * web/dist, found from the working directory (Render runs from the repo
 * root) or from this file (dist/modules/web-app → repo root).
 */
export function resolveWebDistDir(): string | null {
  const candidates = process.env.WEB_DIST_DIR
    ? [process.env.WEB_DIST_DIR]
    : [path.resolve(process.cwd(), 'web', 'dist'), path.resolve(__dirname, '..', '..', '..', 'web', 'dist')];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) return path.resolve(dir);
  }
  return null;
}

export type WebAppFile =
  | { kind: 'file'; absolutePath: string; immutable: boolean }
  | { kind: 'index'; absolutePath: string }
  | { kind: 'missing' };

/**
 * Maps a request path under /app to what should be sent:
 * - an existing file inside web/dist (hashed files under assets/ are cached forever);
 * - a path that looks like a file (has an extension) but does not exist → missing (404),
 *   so a broken script tag never receives HTML;
 * - anything else is a screen of the single-page app → index.html.
 * Paths that escape web/dist (../) are refused.
 */
export function resolveWebAppFile(distDir: string, requestPath: string): WebAppFile {
  let relative: string;
  try {
    relative = decodeURIComponent(requestPath.replace(/^\/app(\/|$)/, ''));
  } catch {
    return { kind: 'missing' };
  }
  if (relative.includes('\0')) return { kind: 'missing' };
  const target = path.resolve(distDir, relative);
  const inside = target === distDir || target.startsWith(distDir + path.sep);
  if (!inside) return { kind: 'missing' };

  if (relative !== '' && fs.existsSync(target) && fs.statSync(target).isFile()) {
    const isIndex = path.basename(target) === 'index.html' && path.dirname(target) === distDir;
    if (isIndex) return { kind: 'index', absolutePath: target };
    return { kind: 'file', absolutePath: target, immutable: relative.startsWith('assets/') };
  }
  if (relative.startsWith('assets/') || path.extname(relative) !== '') return { kind: 'missing' };
  return { kind: 'index', absolutePath: path.join(distDir, 'index.html') };
}
