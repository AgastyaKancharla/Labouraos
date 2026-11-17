import { normaliseTime, readShiftInput, shiftCategory, shiftLabel, vacancyShiftCategory } from './business-shift';

describe('business shifts (17 Nov): times, day / night, label', () => {
  it('reads times as HH:MM (24-hour, IST)', () => {
    expect(normaliseTime('7:00')).toBe('07:00');
    expect(normaliseTime('7')).toBe('07:00');
    expect(normaliseTime('23:59')).toBe('23:59');
    expect(normaliseTime('7 AM')).toBe('07:00');
    expect(normaliseTime('7:30 pm')).toBe('19:30');
    expect(normaliseTime('12 am')).toBe('00:00');
    expect(normaliseTime('12pm')).toBe('12:00');
    for (const bad of ['24:00', '7:60', '13 pm', '0 am', 'seven', '', null, 7]) expect(normaliseTime(bad)).toBeNull();
  });

  it('checks a shift from a form: a name, a start and an end that differ', () => {
    expect(readShiftInput({ name: '  Morning  shift ', startTime: '7:00', endTime: '15:00' })).toEqual({ value: { name: 'Morning shift', startTime: '07:00', endTime: '15:00' }, errors: [] });
    expect(readShiftInput({ name: '', startTime: '25:00', endTime: '9' }).errors).toEqual(['name', 'startTime']);
    expect(readShiftInput({ name: 'Same', startTime: '09:00', endTime: '09:00' }).errors).toEqual(['endTime']);
    expect(readShiftInput({ name: 'x'.repeat(41), startTime: '09:00', endTime: '17:00' }).errors).toEqual(['name']);
    expect(readShiftInput({ endTime: '18:00' }, true)).toEqual({ value: { endTime: '18:00' }, errors: [] });
  });

  it('is night when at least half of it falls between 22:00 and 06:00 (a shift may run past midnight)', () => {
    expect(shiftCategory('07:00', '15:00')).toBe('day');
    expect(shiftCategory('09:30', '18:30')).toBe('day');
    expect(shiftCategory('14:00', '22:00')).toBe('day');
    expect(shiftCategory('22:00', '06:00')).toBe('night');
    expect(shiftCategory('20:00', '04:00')).toBe('night');
    expect(shiftCategory('18:00', '02:00')).toBe('night');
    expect(shiftCategory('16:00', '00:00')).toBe('day');
  });

  it('labels a shift and gives matching its day / night (older vacancies keep their word)', () => {
    expect(shiftLabel({ name: 'Morning', startTime: '07:00', endTime: '15:00' })).toBe('Morning 07:00–15:00');
    expect(vacancyShiftCategory({ shift: 'Night guard 22:00–06:00', shiftStartTime: '22:00', shiftEndTime: '06:00' })).toBe('night');
    expect(vacancyShiftCategory({ shift: 'Rotational' })).toBe('rotational');
    expect(vacancyShiftCategory({ shift: null })).toBeNull();
  });
});
