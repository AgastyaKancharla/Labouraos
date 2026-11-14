import { AuthThrottlerGuard } from './auth-throttler.guard';

/** Which bucket a request counts against (Fable L-3). */
describe('AuthThrottlerGuard buckets', () => {
  const guard = Object.create(AuthThrottlerGuard.prototype) as {
    getTracker(req: Record<string, unknown>): Promise<string>;
  };

  it('counts a signed-in request (revoking a session) against the staff member, whatever the connection', async () => {
    const one = await guard.getTracker({ ip: '198.51.100.1', path: '/staff/sessions/s1/revoke', user: { sub: 'staff-1' }, body: {} });
    const two = await guard.getTracker({ ip: '203.0.113.9', path: '/staff/sessions/s2/revoke', user: { sub: 'staff-1' }, body: {} });
    const other = await guard.getTracker({ ip: '198.51.100.1', path: '/staff/sessions/s3/revoke', user: { sub: 'staff-2' }, body: {} });
    expect(one).toBe('staff:staff-1');
    expect(two).toBe(one);
    expect(other).not.toBe(one);
  });

  it('keeps login routes on the staff code and the connection', async () => {
    const tracker = await guard.getTracker({ ip: '198.51.100.1', path: '/auth/login', body: { staffCode: 'CA-1' } });
    expect(tracker).toBe('CA-1:198.51.100.1');
  });
});
