import { describe, expect, it } from 'vitest';
import { fakeJwt, TEST_STAFF } from '../test/utils';
import { decodeJwt, reasonFromMessage, sessionFromToken, sessionStore, STAFF_KEY, TOKEN_KEY } from './session';

describe('staff session', () => {
  it('reads the JWT expiry and set-up scope', () => {
    const token = fakeJwt({ role: 'ceo', scope: 'totp_setup' }, 60);
    expect(decodeJwt(token)?.role).toBe('ceo');
    const s = sessionFromToken(token, TEST_STAFF.ceo);
    expect(s?.totpSetupOnly).toBe(true);
    expect(s!.expiresAt).toBeGreaterThan(Date.now());
    expect(decodeJwt('not-a-jwt')).toBeNull();
  });

  it('keeps the session in sessionStorage so closing the browser signs out', () => {
    const s = sessionFromToken(fakeJwt({ role: 'finance' }), TEST_STAFF.finance)!;
    sessionStore.set(s);
    expect(sessionStorage.getItem(TOKEN_KEY)).toBe(s.token);
    expect(JSON.parse(sessionStorage.getItem(STAFF_KEY)!).role).toBe('finance');
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    sessionStore.reloadForTests();
    expect(sessionStore.get()?.staff.code).toBe('FIN-0001');
    sessionStore.clear('logout');
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('ignores an expired stored token', () => {
    sessionStorage.setItem(TOKEN_KEY, fakeJwt({}, -10));
    sessionStorage.setItem(STAFF_KEY, JSON.stringify(TEST_STAFF.ceo));
    sessionStore.reloadForTests();
    expect(sessionStore.get()).toBeNull();
  });

  it('takes the role from the token, not from the stored staff details', () => {
    // Someone edits laboura_staff in sessionStorage to say "ceo": the shell
    // still follows the token, which the API signed for a call agent.
    sessionStorage.setItem(TOKEN_KEY, fakeJwt({ sub: TEST_STAFF.call_agent.id, role: 'call_agent' }));
    sessionStorage.setItem(STAFF_KEY, JSON.stringify({ ...TEST_STAFF.call_agent, role: 'ceo' }));
    sessionStore.reloadForTests();
    expect(sessionStore.get()?.staff.role).toBe('call_agent');
    expect(sessionStore.get()?.staff.code).toBe('CA-0042');
    sessionStore.clear('logout');
  });

  it('gives no session for a token without a staff role', () => {
    expect(sessionFromToken(fakeJwt({ sub: 'x' }), TEST_STAFF.ceo)).toBeNull();
    expect(sessionFromToken(fakeJwt({ role: 'owner' }), TEST_STAFF.ceo)).toBeNull();
    sessionStorage.setItem(TOKEN_KEY, fakeJwt({ sub: 'x' }));
    sessionStorage.setItem(STAFF_KEY, JSON.stringify(TEST_STAFF.ceo));
    sessionStore.reloadForTests();
    expect(sessionStore.get()).toBeNull();
  });

  it('a token for another role than the sign-in answer wins', () => {
    const s = sessionFromToken(fakeJwt({ role: 'manager' }), TEST_STAFF.ceo)!;
    expect(s.staff.role).toBe('manager');
  });

  it('maps API messages to sign-out reasons', () => {
    expect(reasonFromMessage('Session ended after being idle')).toBe('idle');
    expect(reasonFromMessage('Session has reached its maximum length')).toBe('max_length');
    expect(reasonFromMessage('Session has been revoked')).toBe('revoked');
    expect(reasonFromMessage('Invalid or expired token')).toBe('expired');
    expect(reasonFromMessage('Unauthorized')).toBe('unauthorized');
  });
});
