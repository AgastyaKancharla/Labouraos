import { forecast, monthOf, monthWeeks, monthWindow, outOfHundred, outOfTen, previousMonth, roleShort } from './manager-common';

describe('Manager portal helpers', () => {
  const now = new Date('2026-11-09T06:00:00Z'); // 9 Nov, 11:30 IST

  it('monthWindow: November, day 9 of 30, 21 days left (IST)', () => {
    const m = monthWindow(now, now);
    expect(m).toMatchObject({ year: 2026, month: 11, key: '2026-11', daysInMonth: 30, dayOfMonth: 9, daysLeft: 21 });
    expect(m.from.toISOString()).toBe('2026-10-31T18:30:00.000Z');
    expect(m.to.toISOString()).toBe('2026-11-30T18:29:59.999Z');
  });

  it('a past month is all gone, a future month not started', () => {
    expect(monthOf(2026, 10, now)).toMatchObject({ dayOfMonth: 31, daysLeft: 0 });
    expect(monthOf(2026, 12, now)).toMatchObject({ dayOfMonth: 0, daysLeft: 31 });
    expect(() => monthOf(2026, 13, now)).toThrow();
    expect(previousMonth(2026, 1)).toEqual({ year: 2025, month: 12 });
    expect(previousMonth(2026, 11)).toEqual({ year: 2026, month: 10 });
  });

  it('forecast: the guide example — 141 registrations in 9 days ends at 470 by the 30th', () => {
    const m = monthWindow(now, now);
    const f = forecast(141, 400, m);
    expect(f).toMatchObject({ done: 141, target: 400, stillToDo: 259, needPerDay: 12.3, doingPerDay: 15.7, atThisSpeed: 470, extra: 70, verdict: 'yes' });
  });

  it('forecast: short by, and no target', () => {
    const m = monthWindow(now, now);
    expect(forecast(11, 45, m)).toMatchObject({ atThisSpeed: 37, extra: -8, verdict: 'short', needPerDay: 1.6, doingPerDay: 1.2 });
    expect(forecast(14, null, m)).toMatchObject({ target: null, stillToDo: null, needPerDay: null, verdict: 'no_target', atThisSpeed: 47 });
  });

  it('forecast: a limit where fewer is better ("4 or fewer")', () => {
    const m = monthWindow(now, now);
    expect(forecast(1, 4, m, true)).toMatchObject({ atThisSpeed: 3, extra: 1, verdict: 'yes', stillToDo: null, needPerDay: null });
    expect(forecast(3, 4, m, true)).toMatchObject({ atThisSpeed: 10, verdict: 'short' });
  });

  it('out of 10 / out of 100, never NaN', () => {
    expect(outOfTen(92, 141)).toBe(6.5);
    expect(outOfTen(1, 0)).toBeNull();
    expect(outOfHundred(48, 100)).toBe(48);
    expect(outOfHundred(0, 0)).toBeNull();
  });

  it('monthWeeks: weeks that started, the current one "so far"', () => {
    const m = monthWindow(now, now);
    const weeks = monthWeeks(m, now);
    expect(weeks.map((w) => w.label)).toEqual(['Week 1 · 1–7 Nov', 'Week 2 · 8–14 Nov, so far']);
    expect(weeks[1].to).toEqual(now);
  });

  it('roleShort', () => {
    expect(roleShort('call_agent')).toBe('Call');
    expect(roleShort('field_agent', true)).toBe('Field (intern)');
  });
});
