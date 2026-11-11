/**
 * Uploaded files (candidate selfies, shop photos, signed agreements, call
 * recordings) go to Supabase Storage only when each of these settings is
 * `supabase`. Any other value keeps the file in the server's memory, where it
 * is lost on every deploy or restart. That is fine on a laptop and in tests,
 * never in production.
 */
export const UPLOAD_STORAGE_MODE_SETTINGS = [
  'CANDIDATE_PHOTO_STORAGE_MODE',
  'BUSINESS_PHOTO_STORAGE_MODE',
  'AGREEMENT_STORAGE_MODE',
  'RECORDING_STORAGE_MODE',
] as const;

export const SUPABASE_STORAGE_SETTINGS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;

/**
 * Refuses to start a production process (web or worker) whose uploads would
 * be kept in memory, or that is told to use Supabase without the keys to
 * reach it. Does nothing outside production.
 */
export function assertDurableUploadStorage(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') return;

  const inMemory = UPLOAD_STORAGE_MODE_SETTINGS.filter(
    (name) => env[name]?.trim() !== 'supabase',
  );
  if (inMemory.length > 0) {
    const detail = inMemory
      .map((name) => `${name}=${env[name]?.trim() ? env[name]?.trim() : '(not set)'}`)
      .join(', ');
    throw new Error(
      `Refusing to start in production: uploaded files would be kept in memory and lost on every restart (${detail}). ` +
        `Set ${inMemory.join(', ')} to "supabase" on both the web service and the worker in the Render dashboard.`,
    );
  }

  const missing = SUPABASE_STORAGE_SETTINGS.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Refusing to start in production: file storage is set to Supabase but ${missing.join(' and ')} ` +
        `${missing.length === 1 ? 'is' : 'are'} empty. Copy them from Supabase (Project Settings > API) into the Render dashboard.`,
    );
  }
}
