/**
 * English words for the registration fixes of 21 Nov (Master Guide rev 204,
 * "Registration and payment fixes, decided 21 Nov (owner testing)"): the typed
 * date of birth and the map pin from an address, any Google Maps link or
 * coordinates. English only (rev 193).
 */
export const reg21NovEn = {
  // Date of birth typed (DD-MM-YYYY)
  'form.dob.placeholder': 'DD-MM-YYYY',
  'form.dob.calendar': 'Pick the date of birth from a calendar',
  'form.dob.incomplete': 'Type the full date as DD-MM-YYYY, e.g. 22-09-2006.',
  'form.dob.notADate': 'That is not a real date. Type it as DD-MM-YYYY, e.g. 22-09-2006.',
  'form.dob.future': 'The date of birth can’t be in the future.',
  'form.dob.under18': 'Must be 18 or older.',
  'form.dob.tooOld': 'Check the year — that date of birth is too far back.',
  'fa10.dobTypedHint': 'Type the numbers, e.g. 22092006 — the dashes are added. Or tap 📅 for the calendar. Under 18 is refused.',
} as const;
