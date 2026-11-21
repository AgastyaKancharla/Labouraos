/**
 * English words for the registration and payment fixes of 21 Nov (Master
 * Guide rev 204, "Registration and payment fixes, decided 21 Nov (owner
 * testing)"): typed date of birth, the map pin from an address or any Google
 * Maps link, the "Or pay with" UPI app buttons, unfinished registrations and
 * the "Where they're stuck" box. English only (rev 193).
 */
export const reg21NovEn = {
  // 1. Date of birth typed
  'form.dob.placeholder': 'DD-MM-YYYY',
  'form.dob.hint': 'Type the numbers, e.g. 22092006 — the dashes are added for you.',
  'form.dob.calendar': 'Pick the date of birth from a calendar',
  'form.dob.calendarPick': 'Date of birth (calendar)',
  'form.dob.incomplete': 'Type the full date as DD-MM-YYYY, e.g. 22-09-2006.',
  'form.dob.notADate': 'That is not a real date. Type it as DD-MM-YYYY, e.g. 22-09-2006.',
  'form.dob.future': 'The date of birth can’t be in the future.',
} as const;
