/**
 * English words for the field agent fixes of 21 Nov (Master Guide rev 202,
 * "Call agent and field agent fixes"): verification job cards, Update the pin,
 * the calling phone, the bell, follow-up tasks, arrival while offered, the
 * similar-shop warning, come-back time and saved-offline messages.
 */
export const fixes21En = {
  // Verification visit job card (item 3)
  'job.verify': 'Verify',
  'job.resume': 'Continue the verification',
  'job.callOwner': 'Call owner',
  'job.openMaps': 'Open in Maps',
  'job.owner': 'Owner: {name}',
  'job.contact': 'Contact: {name}',
  'job.phone': 'Phone ••{last4}',
  'job.noAddress': 'No address saved',
  'job.calling': 'Calling… your phone rings first, then the owner.',
  'job.lastTry': 'Last try {date}: owner not there',
  'job.comeBack': 'Come back {when}',
  'job.signup': 'Signed up in the Laboura app',
  'job.lead': 'Asked for a visit',
  'needs.verification_visit': 'Verification visit',

  // Update the pin (item 3)
  'fa06.updatePin': 'Update the pin',
  'fa06.updatePinHelp': 'Is the map pin wrong? Move it to where you stand now and say why. Your Team Lead can see the change.',
  'fa06.pinReason': 'Why is the pin wrong?',
  'fa06.pinSave': 'Move the pin here',
  'fa06.pinMoved': 'Pin moved here ({meters} m).',
  'fa06.pinMovedNew': 'Pin saved here.',

  // Calling phone (B2)
  'me.callingPhone': 'Your calling phone',
  'me.callingPhoneHelp': 'The calling system rings this phone first when you call an owner or a candidate from the app.',
  'me.callingPhoneSet': 'Set: ••{last4}',
  'me.callingPhoneNotSet': 'Not set yet. Calls from the app need it.',
  'me.callingPhoneLabel': 'Mobile number',
  'me.callingPhoneSave': 'Save calling phone',
  'me.callingPhoneSaved': 'Saved. Calls ring this phone first.',
  'me.callingPhoneChange': 'Change number',

  // The bell (item 14)
  'bell.title': 'Notifications',
  'bell.open': 'Notifications, {count} unread',
  'bell.empty': 'No notifications yet.',
  'bell.markAll': 'Mark all as read',
  'bell.unread': 'New',

  // Follow-up tasks (item 5)
  'fu.title': 'Follow-up',
  'fu.due': 'Due {date}',
  'fu.call': 'Call {name}',
  'fu.callBusiness': 'Call the owner',
  'fu.calling': 'Calling… pick what they said once the call is answered.',
  'fu.notAnswered': 'The phone system has not reported an answer yet. If nobody picked up, try again later: the follow-up stays open.',
  'fu.result': 'What did they say?',
  'fu.answer.needs_more_staff': 'Needs more staff',
  'fu.answer.no_staff_needed_now': 'No staff needed now',
  'fu.answer.working_at_introduced_business': 'Working at the business we introduced',
  'fu.answer.working_elsewhere': 'Working elsewhere',
  'fu.answer.not_working': 'Not working',
  'fu.notes': 'Notes (optional)',
  'fu.done': 'Done',
  'fu.saved': 'Follow-up done.',
  'fu.alreadyDone': 'This follow-up is done.',
  'fu.addVacancy': 'Add the vacancy',
  'fu.openBusiness': 'Open the business',

  // Interview day (item 6)
  'fa16.offeredHint': 'He has not replied to the offer yet. Marking him Arrived counts as accepting the offer.',
  'fa16.ownerDecision': "Owner's decision",

  // Offline (item 9)
  'common.savedOffline': 'Saved — will send when online',

  // Similar shop nearby (item 12)
  'dup.title': 'Is this the same shop?',
  'dup.body': '{name} ({code}) is {meters} m from here and is already in Laboura.',
  'dup.revisit': 'Record as a revisit',
  'dup.different': 'It is a different shop',
  'dup.tl': 'A second record of the same shop goes to your Team Lead to approve.',

  // Come-back time and handed-over work (item 15, item 13)
  'fa06c.revisitTime': 'Come-back time (optional)',
  'needs.coverFor': 'covering for {name}',
  'fa05.covering': 'Covering for a teammate',
  'fa05.comeBackAt': 'Come back at {time}',
} as const;
