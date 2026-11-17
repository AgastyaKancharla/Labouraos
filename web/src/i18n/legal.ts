/* Legal documents v1.1 (Master Guide rev 176): the words around the legal
   texts — "In short", "Read the full terms", the re-consent screen, the footer.
   The legal texts themselves come from the server (GET /legal/documents/:key). */

export const legalEn = {
  'screen.P-Reconsent': 'Updated terms',
  'screen.P-PartnerReconsent': 'Updated terms',
  'legal.inShort': 'In short',
  'legal.readFull': 'Read the full terms',
  'legal.version': 'Version {version}',
  'legal.loading': 'Loading the terms…',
  'legal.footer.grievance': 'Grievance Officer: {contact}',
  'legal.footer.company': '{name} · CIN {cin}',
  'legal.updated.title': 'We’ve updated our terms',
  'legal.updated.intro': 'You accepted version {old}. Please read version {version} and accept it to carry on. A guarantee you already paid for keeps the terms you paid under.',
  'legal.updated.introNew': 'Please read version {version} of our terms and accept it to carry on.',
  'legal.updated.ticks': 'Tick each permission',
  'legal.updated.needAll': 'Tick every required box to accept.',
  'legal.updated.accept': 'Accept the updated terms',
  'legal.updated.done': 'Thank you — you accepted version {version}.',
  'legal.agree.authority': 'I have authority to agree on the business’s behalf (as owner, manager, HR or an authorised person)',
  'legal.partner.idCheck': 'I consent to Laboura checking my ID (Aadhaar Secure QR or another ID) and taking a live selfie, keeping only what clause 9.2 lists',
  'legal.fee.joining': 'Joining date',
  'legal.fee.fullName': 'Candidate',
  'legal.fee.phoneHidden': 'Their phone number stays hidden until the joining day; calls go through Laboura’s number.',
};

export type LegalKey = keyof typeof legalEn;

