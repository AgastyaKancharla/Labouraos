import { BadRequestException } from '@nestjs/common';
import { emptyPlan, parseValues, splitDifference, sumOrNull, valuesOf } from './company-plan.service';

describe('Company plan helpers', () => {
  it('parses whole numbers, empty as "not set", and leaves out what was not sent', () => {
    expect(parseValues({ paid: 320, placed: '45', registered: '', vacancies: null, unknown: 3 })).toEqual({ paid: 320, placed: 45, registered: null, vacancies: null });
    expect(parseValues({})).toEqual({});
  });

  it.each([[-1], [1.5], ['abc'], [100001], [true]])('refuses %p', (value) => {
    expect(() => parseValues({ paid: value })).toThrow(BadRequestException);
  });

  it('says per metric whether the split adds up to the plan', () => {
    const plan = { ...emptyPlan(), paid: 320, placed: 45, registered: 400 };
    const split = { ...emptyPlan(), paid: 320, placed: 40, vacancies: 90 };
    const diff = splitDifference(plan, split);
    expect(diff.paid).toBe(0);
    expect(diff.placed).toBe(-5);
    expect(diff.registered).toBe(-400);
    // The CEO set no vacancies number: nothing to add up to.
    expect(diff.vacancies).toBeNull();
    expect(splitDifference(null, split).paid).toBeNull();
  });

  it('sums only the numbers that are set', () => {
    expect(sumOrNull([null, undefined])).toBeNull();
    expect(sumOrNull([2, null, 3])).toBe(5);
    expect(valuesOf({ paid: 3, placed: null }).paid).toBe(3);
    expect(valuesOf(null)).toEqual(emptyPlan());
  });
});
