import { QUALITY_CHECKLIST, scoreOf } from './quality';

describe('call quality checklist', () => {
  it('has the six checks from the design and scores out of 100', () => {
    expect(QUALITY_CHECKLIST).toHaveLength(6);
    expect(scoreOf([true, true, true, true, true, false])).toBe(83);
    expect(scoreOf([true, true, true, true, true, true])).toBe(100);
    expect(scoreOf([false, false, false, false, false, false])).toBe(0);
    expect(scoreOf([])).toBe(0);
  });
});
