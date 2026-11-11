import { gpsSuspicions, isShortVisit, noOnboardingPattern, travelCheck } from './visit-fraud';

const at = (minutes: number) => new Date(Date.UTC(2026, 10, 11, 6, minutes));
const here = { latitude: 12.9116, longitude: 77.6101, accuracyMeters: 8 };

describe('Team Lead checks on shop visits (guide: field agent app, decided 9 Nov)', () => {
  it('very short visit: under the setting only', () => {
    expect(isShortVisit(120, 3)).toBe(true);
    expect(isShortVisit(180, 3)).toBe(false);
    expect(isShortVisit(null, 3)).toBe(false);
  });

  it('two shops too far apart for the time between them', () => {
    const policy = { maxKmh: 60, sameSpotMeters: 100 };
    const far = { latitude: 13.0016, longitude: 77.6101, accuracyMeters: 8 }; // ~10 km north
    expect(travelCheck({ ...here, at: at(0) }, { ...far, at: at(5) }, policy).tooFar).toBe(true);
    expect(travelCheck({ ...here, at: at(0) }, { ...far, at: at(30) }, policy).tooFar).toBe(false);
    expect(travelCheck({ ...here, at: at(0) }, { ...here, at: at(0) }, policy)).toMatchObject({ tooFar: false, kmh: null });
  });

  it('GPS that looks faked: no accuracy, photo stamped elsewhere, identical readings minutes apart', () => {
    expect(gpsSuspicions({ ...here, accuracyMeters: null, at: at(0) }, { sameSpotMeters: 100 })).toEqual(['no_accuracy']);
    expect(gpsSuspicions({ ...here, accuracyMeters: 0, at: at(0) }, { sameSpotMeters: 100 })).toEqual(['no_accuracy']);
    expect(gpsSuspicions({ ...here, at: at(0) }, { stamp: { latitude: 12.95, longitude: 77.61 }, sameSpotMeters: 100 })).toEqual([
      'photo_stamp_elsewhere',
    ]);
    expect(gpsSuspicions({ ...here, at: at(10) }, { earlier: { ...here, at: at(0) }, sameSpotMeters: 100 })).toEqual(['identical_readings']);
    expect(
      gpsSuspicions({ ...here, latitude: 12.91161, at: at(10) }, { earlier: { ...here, at: at(0) }, sameSpotMeters: 100 }),
    ).toEqual([]);
  });

  it('many visits with no onboarding', () => {
    expect(noOnboardingPattern(Array(15).fill('not_interested'), 15)).toBe(true);
    expect(noOnboardingPattern([...Array(14).fill('not_interested'), 'onboarded'], 15)).toBe(false);
    expect(noOnboardingPattern(Array(14).fill('owner_not_there'), 15)).toBe(false);
  });
});
