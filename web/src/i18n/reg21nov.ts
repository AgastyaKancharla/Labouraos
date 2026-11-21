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

  // 3. Payment page: "Or pay with" UPI app buttons (direct UPI, no gateway)
  'pub.upiApps.title': 'Or pay with',
  'pub.upiApps.phonepe': 'PhonePe',
  'pub.upiApps.gpay': 'Google Pay',
  'pub.upiApps.paytm': 'Paytm',
  'pub.upiApps.bhim': 'BHIM',
  'pub.upiApps.other': 'Other UPI app',
  'pub.upiApps.desktopNote': 'Scan the QR code with any UPI app on your phone (PhonePe, Google Pay, Paytm, BHIM…). Or open this link on your phone to pay with one tap.',

  // 4. Unfinished registrations (call agent console)
  'reg.drafts.region': 'Unfinished registrations',
  'reg.drafts.title': 'Unfinished registration',
  'reg.drafts.noName': 'no name yet',
  'reg.drafts.kind.job_seeker': 'Job seeker',
  'reg.drafts.kind.business': 'Business',
  'reg.drafts.kind.referral': 'Referral partner',
  'reg.drafts.resume': 'Resume',
  'reg.drafts.discard': 'Discard',
  'reg.drafts.discardTitle': 'Discard this unfinished registration?',
  'reg.drafts.discardBody': 'Everything typed for {name} will be deleted. This cannot be undone.',
  'reg.drafts.discardYes': 'Yes, discard',

  // 5. "Where they're stuck" on every profile
  'stuck.title': 'Where they’re stuck',
  // 22 Nov: "Stuck registrations" lists (call agent home, Team Lead Work list).
  'stuck.kind.job_seeker': 'Job seeker',
  'stuck.kind.business': 'Business',
  'stuck.kind.referral': 'Referral partner',
  'stuck.list.waiting': "Waiting for the Team Lead's ID check",
  'stuck.list.waitingApproval': "Waiting for the Team Lead's approval",
  'stuck.list.agreement': 'agreement not signed',
  'stuck.list.none': 'No stuck registrations.',
  'stuck.list.agent': 'Agent',
  'stuck.owner': 'Account owner',
  'stuck.noOwner': 'No owner yet',
  'stuck.step': 'Current step',
  'stuck.step.consent': 'Consent',
  'stuck.step.selfie': 'Selfie',
  'stuck.step.id_check': 'ID check',
  'stuck.step.payment': 'Payment',
  'stuck.step.agreement': 'Agreement (signed by OTP)',
  'stuck.step.visit': 'Verification visit',
  'stuck.step.team_lead_check': 'Team Lead’s approval',
  'stuck.step.terms': 'Partner terms',
  'stuck.step.upi': 'UPI / bank details',
  'stuck.step.complete': 'Registration complete',
  'stuck.step.closed': 'Closed',
  'stuck.step.unknown': 'Unknown step',
  'stuck.state.not_started': 'not started',
  'stuck.state.in_progress': 'in progress',
  'stuck.state.stuck': 'stuck',
  'stuck.state.done': 'done',
  'stuck.waitingIdCheck': 'Waiting for the Team Lead’s ID check — nothing to resend.',
  'stuck.waitingApproval': 'Waiting for the Team Lead’s approval — nothing to resend.',
  'stuck.action.registration_link': 'Resend registration link',
  'stuck.action.payment_link': 'Send payment link',
  'stuck.action.someone_else_pays': 'Someone else pays',
  'stuck.action.agreement_link': 'Send agreement link',
  'stuck.action.partner_terms_link': 'Send partner terms link',
  'stuck.otherPhone': 'Payer’s mobile',
  'stuck.otherRelation': 'Who is paying (optional)',
  'stuck.otherSend': 'Send payment-only link',
  'stuck.sent': 'Sent by SMS.',
} as const;
