import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionStore } from '../../auth/session';
import { apiError, fakeJwt, mockApi, signInAs } from '../../test/utils';
import { api, buildUrl } from './client';
import { ApiError } from './errors';

describe('API client', () => {
  beforeEach(() => sessionStore.clear('logout'));

  it('builds query strings and skips empty values', () => {
    expect(buildUrl('/payments', { type: 'refund', status: undefined, page: 2, ids: ['a', 'b'], q: '' })).toBe(
      '/payments?type=refund&page=2&ids=a&ids=b',
    );
    expect(() => buildUrl('payments')).toThrow();
  });

  it('sends the staff token and JSON body', async () => {
    signInAs('ceo');
    const m = mockApi({ 'POST /things': { ok: true } });
    await expect(api.post('/things', { a: 1 })).resolves.toEqual({ ok: true });
    const init = m.fetch.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${sessionStore.token()}`);
    expect(init.body).toBe('{"a":1}');
  });

  it('turns the GlobalExceptionFilter body into an ApiError', async () => {
    signInAs('ceo');
    mockApi({
      'GET /a': apiError(400, 'Phone number is required'),
      'GET /b': { status: 400, body: { statusCode: 400, message: ['name must be a string', 'phone is required'] } },
      'GET /c': apiError(500, 'Internal server error', 'req-42'),
    });
    const a = await api.get('/a').catch((e: unknown) => e);
    expect(a).toBeInstanceOf(ApiError);
    expect((a as ApiError).message).toBe('Phone number is required');
    expect((a as ApiError).status).toBe(400);

    const b = (await api.get('/b').catch((e: unknown) => e)) as ApiError;
    expect(b.messages).toEqual(['name must be a string', 'phone is required']);

    const c = (await api.get('/c').catch((e: unknown) => e)) as ApiError;
    expect(c.isServerError).toBe(true);
    expect(c.requestId).toBe('req-42');
  });

  it('ends the session on 401 and reports why', async () => {
    signInAs('manager');
    const listener = vi.fn();
    const unsubscribe = sessionStore.subscribe(listener);
    mockApi({ 'GET /x': apiError(401, 'Session ended after being idle') });
    await expect(api.get('/x')).rejects.toBeInstanceOf(ApiError);
    expect(sessionStore.get()).toBeNull();
    expect(listener).toHaveBeenCalledWith(null, 'idle', 'Session ended after being idle');
    unsubscribe();
  });

  it('does not touch the session for a 401 on the login endpoints', async () => {
    signInAs('ceo');
    mockApi({ 'POST /auth/login': apiError(401, 'Invalid staff code or password') });
    await expect(api.post('/auth/login', {}, { auth: false })).rejects.toBeInstanceOf(ApiError);
    expect(sessionStore.get()).not.toBeNull();
  });

  it('reports a network failure as a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const err = (await api.get('/x').catch((e: unknown) => e)) as ApiError;
    expect(err.isNetworkError).toBe(true);
    expect(err.status).toBe(0);
  });

  it('uses an explicit token when given (authenticator set-up)', async () => {
    const m = mockApi({ 'POST /staff/2fa/setup': { secret: 'S', otpauthUrl: 'otpauth://x' } });
    const token = fakeJwt({ scope: 'totp_setup' });
    await api.post('/staff/2fa/setup', {}, { token });
    expect(((m.fetch.mock.calls[0][1] as RequestInit).headers as Record<string, string>).Authorization).toBe(`Bearer ${token}`);
  });
});
