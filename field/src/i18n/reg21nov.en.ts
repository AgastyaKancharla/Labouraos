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

  // Map pin from an address, any Google Maps link or coordinates
  'pin.label': 'Address, Google Maps link or coordinates',
  'pin.placeholder': '24th Main, JP Nagar · maps.app.goo.gl/… · 12.9166, 77.6101',
  'pin.hint': 'Type the address, paste the Google Maps link they shared (short links too), or type the coordinates. Check the pin on the map.',
  'pin.find': 'Find on the map',
  'pin.finding': 'Finding…',
  'pin.isRight': 'Is this the right place?',
  'pin.useThis': 'Yes, use this pin',
  'pin.searchAgain': 'No, search again',
  'pin.fromAddress': 'Found from the address · {where}',
  'pin.fromLink': 'From the Google Maps link · {where}',
  'pin.fromCoords': 'From the coordinates · {where}',
  'pin.err.MAPS_TEXT_EMPTY': 'Type an address, paste a Google Maps link or type the coordinates.',
  'pin.err.MAPS_LINK_INVALID': 'This is not a Google Maps link. Copy the link from Google Maps → Share, or type the address.',
  'pin.err.MAPS_LINK_NO_LOCATION': 'Couldn’t find a place in this link. In Google Maps, long-press to drop a pin and share that, or type the address.',
  'pin.err.MAPS_LINK_UNREACHABLE': 'The link could not be opened. Check your signal and try again, or type the address.',
  'pin.err.MAPS_ADDRESS_NOT_FOUND': 'Couldn’t find that address. Add the area and city (e.g. "24th Main, JP Nagar, Bengaluru"), or paste a Google Maps link.',
  'pin.err.MAPS_LOOKUP_UNAVAILABLE': 'The map lookup is not answering right now. Try again in a minute, or use Pin here (GPS).',
  'pin.err.TOO_MANY': 'Too many look-ups in a short time. Wait a minute and try again.',
  'fa10.pinOrFind': 'Or set the pin from an address, a Google Maps link or coordinates:',
  'fa10.pinFrom': '📍 Pin set · {where}',
  'fa07.pinFinder': 'Shop address, Google Maps link or coordinates (optional)',
} as const;
