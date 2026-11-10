/** Supplies the Phase 20 required fields to older integration fixtures. */
export function completeJobSeekerRegistration(input: Record<string, unknown>): Record<string, unknown> {
  const fields = { ...input };
  delete fields.preferredCallWindowStart;
  delete fields.preferredCallWindowEnd;
  const {
    tradeSkill,
    yearsExperience,
    ...registrationFields
  } = fields;
  const referredById = registrationFields.referredById;
  const trades = Array.isArray(registrationFields.trades)
    ? registrationFields.trades
    : [{
      trade: typeof tradeSkill === 'string' ? tradeSkill : 'Housekeeping',
      yearsExperience: typeof yearsExperience === 'number' ? yearsExperience : 0,
    }];
  return {
    name: 'Test Job Seeker',
    messageLanguage: 'en',
    bestTimeToCall: '09-21',
    dateOfBirth: '1990-01-02',
    gender: 'other',
    heardFrom: referredById ? 'referral_partner' : 'walk_in',
    locality: 'Indiranagar',
    pincode: '560038',
    latitude: 12.9784,
    longitude: 77.6408,
    travelDistanceKm: 10,
    trades,
    availableFrom: '2026-11-10',
    lookingSince: '2026-11-01',
    salaryPeriod: 'monthly',
    shiftPreference: 'any',
    jobType: 'full_time',
    spokenLanguages: ['Kannada'],
    ...registrationFields,
  };
}
