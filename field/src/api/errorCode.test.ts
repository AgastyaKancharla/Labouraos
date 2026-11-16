import { errorCode } from './endpoints';
import { apiErrorFromBody } from './errors';

/** The server sends a stable code under details.code (docs/api/field-redesign.md); older answers had it at the top. */
describe('errorCode', () => {
  it('reads details.code first', () => {
    expect(errorCode(apiErrorFromBody(502, { statusCode: 502, message: 'x', details: { code: 'AGREEMENT_SMS_FAILED' } }))).toBe('AGREEMENT_SMS_FAILED');
    expect(errorCode(apiErrorFromBody(400, { message: 'x', code: 'OLD', details: { code: 'NEW' } }))).toBe('NEW');
  });

  it('falls back to a top-level code, else null', () => {
    expect(errorCode(apiErrorFromBody(400, { message: 'x', code: 'DRAFT_CHANGED' }))).toBe('DRAFT_CHANGED');
    expect(errorCode(apiErrorFromBody(400, { message: 'x' }))).toBeNull();
    expect(errorCode(new Error('plain'))).toBeNull();
    expect(errorCode(null)).toBeNull();
  });
});
