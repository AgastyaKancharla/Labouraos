import { hhmm, SHIFT_PRESETS, shiftNameFor } from './Shifts';

describe('add shift (26 Nov: clock pickers and quick picks)', () => {
  it('names an unnamed shift from its start time', () => {
    expect(shiftNameFor('07:00')).toBe('Morning');
    expect(shiftNameFor('12:00')).toBe('Day');
    expect(shiftNameFor('16:30')).toBe('Evening');
    expect(shiftNameFor('22:00')).toBe('Night');
    expect(shiftNameFor('02:00')).toBe('Night');
  });

  it('every quick pick is a valid shift the clock picker can show (half hours)', () => {
    for (const p of SHIFT_PRESETS) {
      expect(hhmm(p.startTime)).toBe(p.startTime);
      expect(hhmm(p.endTime)).toBe(p.endTime);
      expect(p.startTime).not.toBe(p.endTime);
      expect(Number(p.startTime.slice(3)) % 30).toBe(0);
    }
  });
});
