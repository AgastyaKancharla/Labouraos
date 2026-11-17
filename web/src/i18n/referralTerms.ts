/* The public referral partner terms page (screens/public/P-ReferralTerms).
   Written from the Master Guide's referral rules (what earns, when it is paid,
   payout details) and the partner pause rule already built; no legal terms
   beyond those. Amounts come from Settings through {reward}, {fee}, {hours}. */

export const referralTermsEn = {
  'screen.P-ReferralTerms': 'Referral partner terms',
  'rterms.intro': 'The rules for Laboura referral partners, in plain words. You agree to them with an OTP on your registration link.',
  'rterms.earn.title': 'What earns money',
  'rterms.earn.join': 'You earn {reward} when a job seeker you referred joins a job through Laboura.',
  'rterms.earn.notPay': 'You do not earn when they register or pay their {fee} — only when they join.',
  'rterms.earn.business': 'For now only job seekers who join earn the reward. Payment for referring businesses has not been decided yet.',
  'rterms.earn.self': 'You never earn for referring yourself.',
  'rterms.paid.title': 'When you are paid',
  'rterms.paid.queued': 'The reward is queued on the day the person joins. The CEO or Finance releases it, and payouts are sent every day.',
  'rterms.paid.how': 'It is sent by UPI, or to your bank account, from Laboura’s company account — only to details in your own name, checked against the name on your ID.',
  'rterms.paid.linked': 'Each payout is linked to the exact joining it is for.',
  'rterms.details.title': 'Your payout details',
  'rterms.details.add': 'You add your UPI ID (or bank account) yourself, on your own phone, with an OTP.',
  'rterms.details.change': 'Changing them needs an OTP on your registered phone, then a {hours}-hour wait before the next payout, and Finance is told. This stops anyone quietly putting in their own UPI.',
  'rterms.pause.title': 'Pausing a partner',
  'rterms.pause.who': 'The CEO can pause a partner, with a written reason.',
  'rterms.pause.effect': 'While you are paused, new referrals naming you are not accepted. Money you have already earned is still paid.',
  'rterms.calls.title': 'Calls and your details',
  'rterms.calls.recorded': 'Calls with Laboura are recorded; you agree to this when you sign the terms.',
  'rterms.calls.id': "We check your ID — the Aadhaar QR code is read on your phone. We keep the result, the last 4 digits, your name, date of birth, gender, area and pincode — never your full Aadhaar number or a picture of the card.",
  'rterms.version': 'Terms version {version}. Questions? Ask the Laboura agent who registered you.',
  'rterms.open': 'Open the full referral partner terms',
} as const;

export type ReferralTermsKey = keyof typeof referralTermsEn;

