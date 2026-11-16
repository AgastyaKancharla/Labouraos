import { translate } from '@/i18n';
import { duplicateMessage, readOtpSend } from './otp-send';

const t = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) => translate('en', key, params);

describe('readOtpSend (POST /otp/send answers)', () => {
  it('reads a request', () => {
    expect(readOtpSend({ success: true, requestId: 'r1', resendAvailableAt: '2026-11-16T10:00:30Z' })).toEqual({ kind: 'sent', requestId: 'r1', resendAvailableAt: '2026-11-16T10:00:30Z' });
  });

  it('reads "already registered" with the API field `code` (and the older `existingCode`)', () => {
    expect(readOtpSend({ alreadyRegistered: true, type: 'business', code: 'BZ-00001' })).toEqual({ kind: 'duplicate', type: 'business', code: 'BZ-00001' });
    expect(readOtpSend({ alreadyRegistered: true, existingCode: 'JS-00002' })).toEqual({ kind: 'duplicate', type: null, code: 'JS-00002' });
    expect(readOtpSend({ alreadyRegistered: true })).toEqual({ kind: 'duplicate', type: null, code: null });
  });

  it('anything else is an empty answer', () => {
    expect(readOtpSend({ success: true })).toEqual({ kind: 'empty' });
    expect(readOtpSend(undefined)).toEqual({ kind: 'empty' });
    expect(readOtpSend('')).toEqual({ kind: 'empty' });
  });

  it('names the kind of record', () => {
    expect(duplicateMessage({ type: 'job_seeker', code: 'JS-1' }, t)).toBe('This number is already registered as a job seeker (JS-1).');
    expect(duplicateMessage({ type: 'business', code: 'BZ-1' }, t)).toBe('This number is already registered as a business (BZ-1).');
    expect(duplicateMessage({ type: 'referral', code: 'RF-1' }, t)).toBe('This number is already registered as a referral partner (RF-1).');
    expect(duplicateMessage({ type: null, code: 'XX-1' }, t)).toBe('This number is already registered (XX-1).');
    expect(duplicateMessage({ type: 'business', code: null }, t)).toMatch(/already registered in Laboura/);
  });
});
