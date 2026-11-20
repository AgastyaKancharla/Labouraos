import { translate } from '@/i18n/translate';
import { apiErrorFromBody } from './errors';
import { errorText } from './errorText';

const t = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) => translate('en', key, params);

describe('error words (17 Nov)', () => {
  it('reads the code and fields the live server sends under details', () => {
    // What the live server's exception filter answers for a CustomerApiError.
    const live = apiErrorFromBody(409, {
      statusCode: 409,
      message: 'This business already has a shift with this name',
      details: { statusCode: 409, code: 'VALIDATION_FAILED', message: 'This business already has a shift with this name', field: 'name' },
    });
    expect(live.code).toBe('VALIDATION_FAILED');
    expect(live.field('field')).toBe('name');
    expect(errorText(t, live)).toBe('This business already has a shift with this name');

    const otp = apiErrorFromBody(422, { statusCode: 422, message: 'Wrong code', details: { code: 'OTP_INVALID', attemptsLeft: 2 } });
    expect(otp.code).toBe('OTP_INVALID');
    expect(errorText(t, otp)).toBe(translate('en', 'error.otpInvalidLeft', { left: 2 }));
  });

  it('still reads a code at the top (tests, older answers)', () => {
    const top = apiErrorFromBody(409, { statusCode: 409, code: 'PROFILE_EXISTS', message: 'x', profileId: 'p-1' });
    expect(top.code).toBe('PROFILE_EXISTS');
    expect(top.field('profileId')).toBe('p-1');
  });
});
