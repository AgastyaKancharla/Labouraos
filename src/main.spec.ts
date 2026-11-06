import { bootstrap } from './main';

describe('HTTP server startup configuration', () => {
  const originalUrl = process.env.PUBLIC_APP_URL;

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.PUBLIC_APP_URL;
    else process.env.PUBLIC_APP_URL = originalUrl;
  });

  it('refuses to start when PUBLIC_APP_URL is missing', async () => {
    delete process.env.PUBLIC_APP_URL;
    await expect(bootstrap()).rejects.toThrow(/PUBLIC_APP_URL environment variable is missing or empty/);
  });
});
