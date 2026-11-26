/**
 * English words for the fixes of 17 Nov (Master Guide rev 193, "Decisions of
 * 17 Nov"): Log in / Log out, All visits, vacancies to fill, the camera's
 * permission message, the Google Maps link on the business form and the
 * business's own shifts. English only (the software is English only from 17
 * Nov), so kn/hi have no copy of these keys: English shows.
 */
export const fixes17En = {
  // Log in / Log out (item 1): once a day, Log out ends the day.
  'day.login': 'Log in',
  'day.loggingIn': 'Getting location…',
  'day.logout': 'Log out',
  'day.logoutTitle': 'Log out for today?',
  'day.logoutBody': 'Log out ends your working day, saves your logout time and signs you out of Laboura Field. Logged out by mistake? Sign in again and press Resume my day.',
  'day.loggedIn': 'Logged in at {time}',
  'day.ended': 'Logged in {start} · logged out {end}',
  'day.endedNote': 'Your working day has ended. You can log in again tomorrow.',
  'day.subtitle.open': 'logged in',
  'day.subtitle.ended': 'logged out',
  'day.subtitle.notStarted': 'not logged in',
  'day.logoutFailed': 'Could not log you out. Try again.',
  'day.statusNeedsLogin': 'Log in first to change your status.',

  // All visits (item 2)
  'visits.allVisits': 'All visits',
  'visits.allTitle': 'All visits',
  'visits.searchLabel': 'Search my visits',
  'visits.searchPlaceholder': 'Shop name, area or BZ- code',
  'visits.from': 'From',
  'visits.to': 'To',
  'visits.clearDates': 'Clear dates',
  'visits.none': 'No visits match.',
  'visits.noneYet': 'No visits yet.',
  'visits.loadMore': 'Show more',
  'visits.count': '{count} visits',

  // Vacancies on the business timeline and "vacancies to fill" (item 3)
  'needs.vacancies_to_fill.one': '1 vacancy to fill',
  'needs.vacancies_to_fill.other': '{count} vacancies to fill',
  'fa08.history': 'History',
  'fa08.noHistory': 'Nothing yet.',
  'history.vacancy.added': 'Vacancy added · {trade}',
  'history.vacancy.sent': 'Vacancy sent to the owner · {trade}',
  'history.vacancy.confirmed': 'Vacancy confirmed by the owner · {trade}',
  'history.vacancy.filled': 'Vacancy filled · {trade}',
  'history.vacancy.closed': 'Vacancy closed · {trade}',
  'history.visit': 'Visit',

  // Camera (item 4)
  'device.camera.permissionDenied': 'Laboura Field is not allowed to use the camera. Allow the camera for this site (tap the lock or ⓘ next to the address, then Permissions → Camera → Allow) and try again.',
  'device.camera.noCamera': 'No camera was found on this phone.',
  'device.camera.captureFailed': 'The photo could not be taken. Tap Take photo again.',
  'device.camera.insecure': 'The camera works only on the secure https address of Laboura Field.',

  // Address from a Google Maps link (item 5)
  'fa07.mapsLink': 'Paste Google Maps link (optional)',
  'fa07.mapsLinkHint': 'Open the shop in Google Maps, tap Share, copy the link and paste it here. The address and pin fill in; you can correct them.',
  'fa07.mapsLinkUse': 'Fill address',
  'fa07.mapsLinkLoading': 'Reading the link…',
  'fa07.mapsLinkFilledFields': 'Pin and {fields} filled from the link. Check them and correct anything wrong.',
  'fa07.mapsField.shopNumber': 'shop number',
  'fa07.mapsField.street': 'street',
  'fa07.mapsField.area': 'area',
  'fa07.mapsField.pincode': 'PIN code',
  'fa07.mapsField.city': 'city',
  'fa07.mapsField.landmark': 'landmark',
  'fa07.cityLabel': 'City',
  'fa07.cityHint': 'Filled from the Maps link; it sets the legal minimum wage area. Correct it if wrong.',
  'fa07.mapsLinkPinOnly': 'The pin is filled from the link, but no address was found for it. Type the address.',
  'fa07.mapsLink.err.MAPS_LINK_INVALID': 'This is not a Google Maps link. Copy the link from Google Maps → Share.',
  'fa07.mapsLink.err.MAPS_LINK_NO_LOCATION': 'This link has no map pin. In Google Maps, long-press to drop a pin, then share that.',
  'fa07.mapsLink.err.MAPS_LINK_UNREACHABLE': 'The link could not be opened. Check your signal and try again, or type the address.',
  'fa07.mapsLink.err.TOO_MANY': 'Too many links in a short time. Wait a minute and try again.',
  'fa07.mapsPin': 'Pin: {lat}, {lng}',

  // Shifts per business (item 9)
  'shifts.title': 'Shifts',
  'shifts.none': 'No shifts yet. Add the shifts this business works, e.g. Morning 07:00 – 15:00.',
  'shifts.add': '+ Add shift',
  'shifts.name': 'Shift name',
  'shifts.namePlaceholder': 'e.g. Morning',
  /** 26 Nov: quick picks and clock pickers. */
  'shifts.quickPick': 'Tap a usual shift, or pick the times below',
  'shifts.nameHint': 'Optional: left empty, it is named from the start time',
  'shifts.start': 'Starts',
  'shifts.end': 'Ends',
  'shifts.save': 'Save shift',
  'shifts.delete': 'Remove',
  'shifts.removeConfirm': 'Remove {shift}? Vacancies that already use it keep their shift.',
  'shifts.saved': 'Shift saved.',
  'shifts.err.invalid': 'Pick a start and an end time (they must be different).',
  'shifts.err.duplicate': 'This business already has a shift with this name.',
  'shifts.err.generic': 'Could not save the shift. Try again.',
  'shifts.pick': 'Shift',
  'shifts.pickHint': 'Pick one of this business’s shifts, or add one.',
  'shifts.addForBusiness': 'Add a shift for this business',
  'shifts.oldValue': 'Shift written earlier: {shift}',
  // 26 Nov (owner testing): the mobile is checked at the end, just before saving.
  'fa10.checkMobile': 'Check the mobile number',
  'fa10.checkMobileHint': 'Do this last, just before you save: the code is good for 5 minutes.',
  'fa10.mobileCheckedBelow': 'You check this number with a code at the end of the form.',
  'fa10.missing': 'Still needed: {fields}',
  'fa10.needMobile': 'Type a 10-digit mobile number at the top first.',
  'fa10.verifyBelow': 'Check the mobile number with a code (just above) before saving.',
  'fa10.codeRanOut': 'The code ran out (it is good for 5 minutes). Send a new code, check it, then save.',
  'fa10.missing.pin': 'Map pin',
  'lists.sort': 'Sort:',
  'lists.sort.action': 'Needs action first',
  'lists.sort.newest': 'Newest',
  'lists.sort.oldest': 'Oldest',
  'lists.sort.az': 'A–Z',
} as const;
