/**
 * 26 Nov (owner): the business owner gives the interview result in the
 * Laboura app once the interview is over — an hour after it starts, or at
 * the end of its slot if that is sooner (a walk-in window can run all day).
 * The WhatsApp / SMS result link still goes at the end of the slot.
 */
export const INTERVIEW_RESULT_OPENS_AFTER_MINUTES = 60;

export function interviewResultOpensAt(slotStartsAt: Date, slotEndsAt: Date): Date {
  const hourAfterStart = slotStartsAt.getTime() + INTERVIEW_RESULT_OPENS_AFTER_MINUTES * 60_000;
  return new Date(Math.min(hourAfterStart, slotEndsAt.getTime()));
}

const IST_OFFSET_MS = 330 * 60_000;

/** Whole years on the card, counted on the IST calendar as people count age. */
export function candidateAge(dateOfBirth: Date, now: Date): number {
  const today = new Date(now.getTime() + IST_OFFSET_MS);
  let age = today.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const monthDiff = today.getUTCMonth() - dateOfBirth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getUTCDate() < dateOfBirth.getUTCDate())) age -= 1;
  return age;
}
