import { tenDigits } from './inbound-call-router.service';

describe('inbound caller number matching', () => {
  it.each(['9876543210', '+919876543210', '+91 98765 43210', '919876543210', '09876543210'])(
    'reads the caller %j as the 10 digits of the saved +919876543210',
    (from) => {
      expect(tenDigits(from)).toBe('9876543210');
    },
  );

  it('keeps the last 10 digits of a number that is not an Indian mobile', () => {
    expect(tenDigits('08041234567')).toBe('8041234567');
    expect(tenDigits('18001234567')).toBe('8001234567');
  });
});
