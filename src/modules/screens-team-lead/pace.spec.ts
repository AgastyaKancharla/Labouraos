import { paceRow } from './pace';

describe('the plain month format (target, per day, at this speed, will we make it?)', () => {
  it('matches the design: 7 of 25 placed on day 9 of 30 ends at 23 — short by 2', () => {
    expect(paceRow(25, 7, 9, 30)).toMatchObject({ stillToDo: 18, needPerDay: 0.9, doingPerDay: 0.8, daysLeft: 21, projection: 23, verdict: 'Short by 2', onTrack: false });
  });

  it('says how many extra when ahead, and "right on target" when exactly there', () => {
    expect(paceRow(180, 58, 9, 30)).toMatchObject({ projection: 193, verdict: 'Yes · 13 extra', onTrack: true });
    expect(paceRow(90, 27, 9, 30)).toMatchObject({ projection: 90, verdict: 'Yes · right on target' });
  });

  it('has no verdict without a target, and never divides by zero on the 1st or the last day', () => {
    expect(paceRow(null, 5, 9, 30)).toMatchObject({ target: null, verdict: null, onTrack: null, projection: 17 });
    expect(paceRow(10, 0, 0, 30).projection).toBe(0);
    expect(paceRow(10, 12, 30, 30)).toMatchObject({ daysLeft: 0, needPerDay: 0, verdict: 'Yes · 2 extra' });
  });
});
