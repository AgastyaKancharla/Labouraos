import { buildUrl, createApiClient } from './client';
import { ApiError } from './errors';

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) } as Response;
}

describe('API client', () => {
  it('builds URLs with the base and skips empty query values', () => {
    expect(buildUrl('https://x', '/a', { b: 1, c: '', d: undefined, e: ['x', 'y'] })).toBe('https://x/a?b=1&e=x&e=y');
    expect(() => buildUrl('', 'no-slash')).toThrow();
  });

  it('sends JSON with the staff token and returns the body', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(200, { ok: true }));
    const api = createApiClient({ baseUrl: 'https://api', getToken: () => 'tok', onUnauthorized: jest.fn(), fetchImpl });
    await expect(api.post('/attendance/login', { latitude: 1 })).resolves.toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api/attendance/login');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(init.body).toBe('{"latitude":1}');
  });

  it('does not send the token to login endpoints', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(200, {}));
    const api = createApiClient({ baseUrl: '', getToken: () => 'tok', onUnauthorized: jest.fn(), fetchImpl });
    await api.post('/auth/login', {}, { auth: false });
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('ends the session on a 401 to an authenticated request', async () => {
    const onUnauthorized = jest.fn();
    const api = createApiClient({
      baseUrl: '',
      getToken: () => 'tok',
      onUnauthorized,
      fetchImpl: async () => jsonResponse(401, { statusCode: 401, message: 'Session ended after being idle' }),
    });
    await expect(api.get('/attendance/today')).rejects.toMatchObject({ status: 401, message: 'Session ended after being idle' });
    expect(onUnauthorized).toHaveBeenCalledWith('Session ended after being idle', null);
  });

  it('does not end a session on a 401 from a login attempt (no token sent)', async () => {
    const onUnauthorized = jest.fn();
    const api = createApiClient({
      baseUrl: '',
      getToken: () => null,
      onUnauthorized,
      fetchImpl: async () => jsonResponse(401, { message: 'Invalid staff code or password' }),
    });
    await expect(api.post('/auth/login', {}, { auth: false })).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('turns a failed fetch into a retryable network error', async () => {
    const api = createApiClient({
      baseUrl: '',
      getToken: () => null,
      onUnauthorized: jest.fn(),
      fetchImpl: async () => {
        throw new TypeError('Network request failed');
      },
    });
    const error = (await api.get('/x').catch((e: unknown) => e)) as ApiError;
    expect(error.isNetworkError).toBe(true);
    expect(error.isRetryable).toBe(true);
    expect(error.status).toBe(0);
  });

  it('reads Nest validation messages and keeps 4xx non-retryable', async () => {
    const api = createApiClient({
      baseUrl: '',
      getToken: () => null,
      onUnauthorized: jest.fn(),
      fetchImpl: async () => jsonResponse(400, { message: ['latitude must be a number', 'longitude must be a number'] }),
    });
    const error = (await api.get('/x').catch((e: unknown) => e)) as ApiError;
    expect(error.messages).toHaveLength(2);
    expect(error.message).toBe('latitude must be a number');
    expect(error.isRetryable).toBe(false);
  });
});
