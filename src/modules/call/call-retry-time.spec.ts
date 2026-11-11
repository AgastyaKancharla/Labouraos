import { nextDayRetryAt, nextRetryAt } from './call-retry-time';

/** 2026-11-11 in IST; times written as IST and compared as UTC. */
const ist = (hhmm: string, day = '2026-11-11') => new Date(`${day}T${hhmm}:00+05:30`);
const hours = { callingHoursStart: '09:00', callingHoursEnd: '21:00' };

describe('retry time after an unanswered call', () => {
  it('moves a morning miss to this afternoon, so the day has a morning and an evening try', () => {
    expect(nextRetryAt(ist('10:05'), hours).toISOString()).toBe(ist('12:00').toISOString());
  });

  it('waits for the start of his preferred window when it begins after noon', () => {
    expect(
      nextRetryAt(ist('11:42'), { ...hours, personWindowStart: '15:00', personWindowEnd: '18:00' }).toISOString(),
    ).toBe(ist('15:00').toISOString());
  });

  it('moves an afternoon miss to tomorrow at the start of his window', () => {
    expect(
      nextRetryAt(ist('18:40'), { ...hours, personWindowStart: '10:00', personWindowEnd: '19:00' }).toISOString(),
    ).toBe(ist('10:00', '2026-11-12').toISOString());
  });

  it('goes to tomorrow when his window has already closed for today', () => {
    expect(
      nextRetryAt(ist('09:30'), { ...hours, personWindowStart: '09:00', personWindowEnd: '11:00' }).toISOString(),
    ).toBe(ist('09:00', '2026-11-12').toISOString());
  });

  it('never leaves the calling hours, even if his window does', () => {
    expect(
      nextRetryAt(ist('19:00'), { ...hours, personWindowStart: '07:00', personWindowEnd: '23:00' }).toISOString(),
    ).toBe(ist('09:00', '2026-11-12').toISOString());
  });

  it('uses the calling hours when his window does not overlap them', () => {
    expect(
      nextRetryAt(ist('10:00'), { ...hours, personWindowStart: '22:00', personWindowEnd: '23:00' }).toISOString(),
    ).toBe(ist('12:00').toISOString());
  });

  it('handles a miss just after midnight IST (still the same IST day)', () => {
    expect(nextRetryAt(new Date('2026-11-10T18:45:00Z'), hours).toISOString()).toBe(ist('12:00').toISOString());
  });
});

describe('follow-up retry the next day', () => {
  it('goes to tomorrow at the start of his window, whatever time today it was missed', () => {
    expect(
      nextDayRetryAt(ist('10:00'), { ...hours, personWindowStart: '15:00', personWindowEnd: '18:00' }).toISOString(),
    ).toBe(ist('15:00', '2026-11-12').toISOString());
    expect(nextDayRetryAt(ist('20:30'), hours).toISOString()).toBe(ist('09:00', '2026-11-12').toISOString());
  });
});
