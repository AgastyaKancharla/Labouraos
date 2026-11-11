import { classifyDay, deductibleShortfall, isWeeklyOff, monthRange } from './day-rules';

const policy = { productionHoursFullDay: 8, halfDayBelowHours: 4.5, dayToleranceMinutes: 10 };
const hm = (hours: number, minutes: number) => hours * 3600 + minutes * 60;

describe('Phase 21 Task 3: day rules', () => {
  it('7h 52m is a full day with no shortfall at 10 minutes tolerance', () => {
    expect(classifyDay(hm(7, 52), policy)).toEqual({
      dayType: 'full',
      shortfallSeconds: 0,
      makeUpSeconds: 0,
    });
  });

  it('exactly 8h minus the tolerance is full, one minute less carries the whole shortfall', () => {
    expect(classifyDay(hm(7, 50), policy).shortfallSeconds).toBe(0);
    expect(classifyDay(hm(7, 49), policy)).toEqual({
      dayType: 'full',
      shortfallSeconds: hm(0, 11),
      makeUpSeconds: 0,
    });
  });

  it('the half-day line is 4.5h minus the tolerance', () => {
    expect(classifyDay(hm(4, 20), policy)).toEqual({
      dayType: 'full',
      shortfallSeconds: hm(3, 40),
      makeUpSeconds: 0,
    });
    expect(classifyDay(hm(4, 19), policy)).toEqual({
      dayType: 'half',
      shortfallSeconds: 0,
      makeUpSeconds: 0,
    });
  });

  it('takes the tolerance from the settings', () => {
    const tight = { ...policy, dayToleranceMinutes: 5 };
    expect(classifyDay(hm(7, 52), tight).shortfallSeconds).toBe(hm(0, 8));
    expect(classifyDay(hm(4, 24), tight).dayType).toBe('half');
    expect(classifyDay(hm(4, 25), tight).dayType).toBe('full');
  });

  it('time above 8h is make-up, not shortfall', () => {
    expect(classifyDay(hm(9, 10), policy)).toEqual({
      dayType: 'full',
      shortfallSeconds: 0,
      makeUpSeconds: hm(1, 10),
    });
  });

  it('a day worked on a weekly day off is all make-up time', () => {
    expect(classifyDay(hm(2, 0), policy, true)).toEqual({
      dayType: 'off',
      shortfallSeconds: 0,
      makeUpSeconds: hm(2, 0),
    });
  });

  it('deductible shortfall never goes below zero', () => {
    expect(deductibleShortfall(600, 200)).toBe(400);
    expect(deductibleShortfall(200, 600)).toBe(0);
  });

  it('reads months and weekdays as IST calendar dates', () => {
    expect(monthRange('2027-02')).toEqual({
      from: new Date('2027-02-01T00:00:00.000Z'),
      to: new Date('2027-02-28T00:00:00.000Z'),
    });
    expect(monthRange('2027-13')).toBeNull();
    expect(monthRange('Feb')).toBeNull();
    expect(isWeeklyOff(new Date('2027-02-07T00:00:00.000Z'), [0])).toBe(true);
    expect(isWeeklyOff(new Date('2027-02-05T00:00:00.000Z'), [0])).toBe(false);
  });
});
