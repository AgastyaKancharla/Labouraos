import { candidateAge, interviewResultOpensAt } from './interview-result-window';

describe('interview result window (26 Nov)', () => {
  it('opens an hour after the start for a normal booked slot', () => {
    const start = new Date('2026-11-26T05:30:00.000Z');
    const end = new Date('2026-11-26T06:30:00.000Z');
    expect(interviewResultOpensAt(start, end).toISOString()).toBe('2026-11-26T06:30:00.000Z');
  });

  it('opens at the end of a short slot (30-minute phone or in-shop interview)', () => {
    const start = new Date('2026-11-26T05:30:00.000Z');
    const end = new Date('2026-11-26T06:00:00.000Z');
    expect(interviewResultOpensAt(start, end).toISOString()).toBe('2026-11-26T06:00:00.000Z');
  });

  it('opens an hour in for an all-day walk-in window, not at its end', () => {
    const start = new Date('2026-11-26T04:30:00.000Z');
    const end = new Date('2026-11-26T12:30:00.000Z');
    expect(interviewResultOpensAt(start, end).toISOString()).toBe('2026-11-26T05:30:00.000Z');
  });

  it('counts age on the IST calendar', () => {
    const dob = new Date('2000-11-27T00:00:00.000Z');
    expect(candidateAge(dob, new Date('2026-11-26T19:00:00.000Z'))).toBe(26); // 00:30 on 27 Nov in IST
    expect(candidateAge(dob, new Date('2026-11-26T10:00:00.000Z'))).toBe(25);
  });
});
