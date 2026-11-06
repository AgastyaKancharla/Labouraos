/** Reads the configured public app address and fails closed when it is invalid. */
export function getPublicAppUrl(): string {
  const value = process.env.PUBLIC_APP_URL?.trim();
  if (!value) {
    throw new Error('PUBLIC_APP_URL environment variable is missing or empty. Server cannot start without a public app address.');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('PUBLIC_APP_URL must be an absolute URL.');
  }

  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new Error('PUBLIC_APP_URL must be an absolute HTTP or HTTPS URL without credentials.');
  }
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('PUBLIC_APP_URL must use HTTPS in production.');
  }

  return url.toString().replace(/\/$/, '');
}

/** Builds an absolute public link, preserving an optional app path prefix. */
export function publicLink(path: string): string {
  const baseUrl = getPublicAppUrl();
  return new URL(path.replace(/^\/+/, ''), `${baseUrl}/`).toString();
}
