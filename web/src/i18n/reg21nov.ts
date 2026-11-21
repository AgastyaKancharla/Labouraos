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

  // 2. Map pin from an address, any Google Maps link or coordinates
  'reg.pin.helpAny': 'Type the address (shop number, street, area), paste any Google Maps link they share on WhatsApp (maps.app.goo.gl links too), or type the coordinates. Then check the pin on the map.',
  'reg.pin.findLabel': 'Address, Google Maps link or coordinates',
  'reg.pin.findPlaceholder': '24th Main, JP Nagar · https://maps.app.goo.gl/… · 12.9166, 77.6101',
  'reg.pin.find': 'Find on the map',
  'reg.pin.empty': 'Type an address, paste a Google Maps link or type the coordinates.',
  'reg.pin.isRight': 'Is this the right place?',
  'reg.pin.mapLabel': 'Map showing the pin',
  'reg.pin.useThis': 'Yes, use this pin',
  'reg.pin.searchAgain': 'No, search again',
  'reg.pin.fromAddress': 'Found from the address · {lat}, {lng}',
  'reg.pin.fromLink': 'From the Google Maps link · {lat}, {lng}',
  'reg.pin.fromCoords': 'From the coordinates · {lat}, {lng}',
} as const;
