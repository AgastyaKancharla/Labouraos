/**
 * WhatsApp message templates (Master Guide rev 202, 21 Nov; rev 211, 25 Nov), as config.
 *
 * WhatsApp only lets a business start a conversation (or write after the
 * 24-hour reply window has closed) with a template Meta approved beforehand.
 * Each entry here is the English text submitted for approval: the name must
 * match the approved template in WhatsApp Manager, and `variables` are the
 * named parameters in the order they appear in the text. The same name is used
 * for the SMS backup (its DLT template id comes from SMS_DLT_TEMPLATE_IDS).
 *
 * Meta's rules (rev 211; checked by whatsapp-templates.spec.ts):
 * - variables are written here in camelCase (`{{firstName}}`) and go to Meta
 *   as lowercase with underscores (`first_name`, metaParameterName), both in
 *   the send payload and in the submission sheet (docs/whatsapp-templates.md,
 *   `npm run whatsapp:sheet`);
 * - no text starts or ends with a variable (a full stop after a variable still
 *   counts as ending with it): a link is followed by a short sentence;
 * - at most one variable for every three words (Meta refuses a template with
 *   "too many variables for its length"), at most 1024 characters;
 * - language English (`en`), category Utility; login and confirmation codes
 *   use an Authentication template, whose body Meta writes itself.
 *
 * English only (rev 193). Changing a text here means submitting it to Meta
 * again (and regenerating the sheet) before the real provider can send it.
 *
 * Other builders add their templates in their own clearly marked section at
 * the END of WHATSAPP_TEMPLATES.
 */
export type WhatsAppTemplateCategory = 'utility' | 'authentication';

export interface WhatsAppTemplateDef {
  name: string;
  /** What it is for, for people (the agent's template picker and the submission sheet show it). */
  label: string;
  /** The approved text. `{{camelCase}}` marks a variable. */
  text: string;
  /** The variables, in the order they appear in the text. */
  variables: readonly string[];
  /** Utility unless set. Authentication: a login or confirmation code with a copy-code button. */
  category?: WhatsAppTemplateCategory;
  /** An agent may pick it in the WhatsApp tab (after the 24-hour window). */
  agentPickable?: boolean;
  /** Example values for the submission sheet, where the shared SAMPLE_VALUES do not fit. */
  samples?: Record<string, string>;
  /** Anything the person submitting it in WhatsApp Manager should know. */
  notes?: string;
}

export const WHATSAPP_TEMPLATES = {
  // ---- Automatic event messages (SMS as backup) ----
  registration_done: {
    name: 'registration_done',
    label: 'Registration done',
    // Retired for job seekers (rev 211): the payment and the ID check send payment_received_id_left /
    // guarantee_started instead. Kept so an SMS fallback of an older message can still be rebuilt.
    text: 'Hi {{firstName}}, thank you! Your payment for Laboura registration {{code}} has arrived. Our team will call you about suitable jobs. Save this number to reach us on WhatsApp.',
    variables: ['firstName', 'code'],
  },
  partner_registration_done: {
    name: 'partner_registration_done',
    label: 'Referral partner registration done',
    text: 'Hi {{firstName}}, you are now a Laboura referral partner ({{code}}). Share your personal link with people looking for a job or staff: {{link}} Thank you for working with Laboura.',
    variables: ['firstName', 'code', 'link'],
    samples: { link: 'https://app.laboura.com/r/ravi-k7m4' },
  },
  business_registration_done: {
    name: 'business_registration_done',
    label: 'Business verified',
    text: 'Hi {{firstName}}, {{businessName}} is now verified on Laboura ({{code}}). Our team will share matching candidates for your vacancies.',
    variables: ['firstName', 'businessName', 'code'],
    samples: { code: 'BZ-00042' },
  },
  registration_stopped: {
    name: 'registration_stopped',
    label: 'Registration stopped part-way',
    text: 'Hi {{firstName}}, your Laboura registration is waiting at the {{step}} step. Continue where you stopped: {{link}} Reply here if you need help.',
    variables: ['firstName', 'step', 'link'],
  },
  payment_stuck: {
    name: 'payment_stuck',
    label: 'Stuck at payment',
    text: 'Hi {{firstName}}, only the payment is left to finish your Laboura registration. Pay safely by UPI here: {{link}} Reply here if the payment did not go through.',
    variables: ['firstName', 'link'],
  },
  // ---- Links an agent sends ("Send on WhatsApp", with "Send by SMS" beside it) ----
  consent_link: {
    name: 'consent_link',
    label: 'Registration link',
    text: 'Your Laboura registration link: {{link}} It continues from the step you stopped at.',
    variables: ['link'],
  },
  agreement_link: {
    name: 'agreement_link',
    label: 'Business agreement link',
    text: 'Please read and sign the Laboura business agreement here: {{link}} You sign it with a code sent to this phone.',
    variables: ['link'],
    samples: { link: 'https://app.laboura.com/p/agreement/k7m4q2px' },
  },
  referral_terms_link: {
    name: 'referral_terms_link',
    label: 'Referral partner terms link',
    text: 'Your Laboura referral partner ID is {{referralCode}}. Finish your registration here: {{link}} Reply here if you need help.',
    variables: ['referralCode', 'link'],
    samples: { link: 'https://app.laboura.com/p/partner/k7m4q2px' },
  },
  // ---- Inbound conversations ----
  whatsapp_off_shift_reply: {
    name: 'whatsapp_off_shift_reply',
    label: 'Automatic reply when nobody is on shift',
    text: 'Thanks for your message! Our team is away right now. An agent will call you when our next shift starts.',
    variables: [],
  },
  whatsapp_follow_up: {
    name: 'whatsapp_follow_up',
    label: 'Continue the conversation (after 24 hours)',
    text: 'Hi {{firstName}}, this is Laboura replying to your WhatsApp message. Reply to this message and we will continue here, or tell us a good time to call you.',
    variables: ['firstName'],
    agentPickable: true,
  },
  whatsapp_missed_you: {
    name: 'whatsapp_missed_you',
    label: 'We tried to call you (WhatsApp conversation)',
    text: 'Hi {{firstName}}, we tried to call you about your message to Laboura. Reply here with a good time to call you back.',
    variables: ['firstName'],
    agentPickable: true,
  },
  referral_lead_received: {
    name: 'referral_lead_received',
    label: 'Partner: lead received',
    text: 'Thanks {{firstName}}! We received the lead you sent ({{leadFirstName}}). Our team will call them soon.',
    variables: ['firstName', 'leadFirstName'],
  },

  // ---- Builder C (25 Nov, rev 211): every other message the software sends ----
  // Login and confirmation codes (Authentication: Meta writes the body; copy-code button).
  verification_code: {
    name: 'verification_code',
    label: 'Login or confirmation code',
    text: '{{code}} is your verification code. For your security, do not share this code.',
    variables: ['code'],
    category: 'authentication',
    notes:
      'Category Authentication, language English. Meta writes this body itself: tick "Add security recommendation", set the code to expire in 5 minutes, and add a "Copy code" button. It goes with the code as its only parameter.',
  },
  // Exceptions (always both WhatsApp and SMS, guide rev 211): the hit rule needs proof of the call and both messages.
  call_attempt_notice: {
    name: 'call_attempt_notice',
    label: 'We tried to call you (job seeker)',
    text: 'Hi {{candidateName}}, Laboura tried to call you today about {{trade}} jobs and could not reach you. Please call us back, or reply here with a good time to call.',
    variables: ['candidateName', 'trade'],
    notes: 'Always sent on WhatsApp and by SMS together (the "we tried to call you" notice counted by the hit rule).',
  },
  interview_offer: {
    name: 'interview_offer',
    label: 'Interview offer',
    text: 'Laboura job offer: an interview for {{jobType}} in {{area}}, salary {{salaryRange}}, {{shift}} shift, on {{interviewDay}} at {{interviewTime}}. Accept or decline here: {{link}} Please reply within 48 hours.',
    variables: ['jobType', 'area', 'salaryRange', 'shift', 'interviewDay', 'interviewTime', 'link'],
    notes: 'Always sent on WhatsApp and by SMS together (an offer is one of the three ways of reaching him that the hit rule counts).',
  },
  // Interviews and joining.
  interview_booked: {
    name: 'interview_booked',
    label: 'Interview confirmed (to the job seeker)',
    text: 'Your Laboura interview is confirmed: {{businessName}}, {{address}}, {{area}}, on {{interviewTime}}. Ask for {{contactPerson}} when you arrive. Please keep this message.',
    variables: ['businessName', 'address', 'area', 'interviewTime', 'contactPerson'],
  },
  interview_candidate_for_owner: {
    name: 'interview_candidate_for_owner',
    label: 'Candidate coming for an interview (to the owner)',
    text: 'Laboura candidate for your interview: {{firstName}} will come on {{interviewTime}}. Photo: {{photoLink}} Please record the result with Laboura after the interview.',
    variables: ['firstName', 'interviewTime', 'photoLink'],
    samples: { photoLink: 'https://app.laboura.com/photo/k7m4q2px' },
  },
  interview_result_request: {
    name: 'interview_result_request',
    label: 'Record the interview result (to the owner)',
    text: 'Laboura: please record the result of the interview on {{interviewTime}} here: {{link}} The page asks for a code sent to this phone.',
    variables: ['interviewTime', 'link'],
  },
  candidate_offer_check: {
    name: 'candidate_offer_check',
    label: 'Were you offered the job? (to the job seeker)',
    text: 'Laboura: were you offered the job at your interview today? Tell us here: {{link}} It takes one tap.',
    variables: ['link'],
  },
  interview_result_confirm_details: {
    name: 'interview_result_confirm_details',
    label: 'Interview result being confirmed by code (to the owner)',
    text: 'Laboura: you are confirming the interview result for {{candidateFirstName}}: {{result}}. Share the code we sent only if this is right.',
    variables: ['candidateFirstName', 'result'],
    samples: { result: 'selected, salary ₹15,000, joining 1 Dec 2026' },
  },
  interview_cancelled: {
    name: 'interview_cancelled',
    label: 'Interview cancelled (business suspended)',
    text: 'Laboura: your interview is cancelled because the business is not taking interviews right now. We will keep looking for other jobs for you.',
    variables: [],
  },
  joining_confirmed: {
    name: 'joining_confirmed',
    label: 'Joining date confirmed (to the job seeker)',
    text: 'Hi {{candidateName}}, your joining at {{businessName}} is confirmed for {{joiningDate}}. Please reach on time, and call Laboura if anything changes.',
    variables: ['candidateName', 'businessName', 'joiningDate'],
  },
  joining_date_moved: {
    name: 'joining_date_moved',
    label: 'Joining date moved (to the owner)',
    text: 'Laboura: the joining date for {{candidateFirstName}} is now {{joiningDate}}, as you told us on the call. Call Laboura if this is not right.',
    variables: ['candidateFirstName', 'joiningDate'],
  },
  selection_cancelled: {
    name: 'selection_cancelled',
    label: 'Selection cancelled (to the job seeker)',
    text: 'Laboura: the job you were selected for was cancelled. We will keep looking for other jobs for you.',
    variables: [],
  },
  replacement_upgrade_cancelled: {
    name: 'replacement_upgrade_cancelled',
    label: 'Replacement cancelled: salary difference not paid (to the owner)',
    text: 'Laboura: the replacement for {{businessName}} was cancelled because the salary difference was not paid in time. Call us if you still need staff.',
    variables: ['businessName'],
  },
  // Vacancies and candidates.
  vacancy_confirm_details: {
    name: 'vacancy_confirm_details',
    label: 'Vacancy being confirmed by code (to the owner)',
    text: 'Laboura: please check the vacancy at {{business}}: {{headcount}} x {{trade}}, salary {{salary}}, {{shift}} shift, starting {{startDate}}. Share the code we sent only if these details are right.',
    variables: ['business', 'headcount', 'trade', 'salary', 'shift', 'startDate'],
  },
  vacancy_confirm_link: {
    name: 'vacancy_confirm_link',
    label: 'Vacancy confirm link (to the owner)',
    text: 'Laboura: please confirm the vacancy at {{business}} ({{headcount}} x {{trade}}, salary {{salary}}) here: {{link}} The link works for 48 hours.',
    variables: ['business', 'headcount', 'trade', 'salary', 'link'],
    samples: { link: 'https://app.laboura.com/p/vacancy/k7m4q2px' },
  },
  candidates_shared: {
    name: 'candidates_shared',
    label: 'Candidates shortlisted (to the owner)',
    text: 'Laboura has shortlisted candidates for your vacancy. See them here: {{link}} Call us to book the interviews.',
    variables: ['link'],
    samples: { link: 'https://app.laboura.com/candidate-introductions/k7m4q2px' },
  },
  // Money.
  payment_request: {
    name: 'payment_request',
    label: 'Payment link',
    text: 'Laboura payment request: Rs {{amount}} to {{payeeName}}. Pay safely by UPI here: {{link}} Pay only through this link.',
    variables: ['amount', 'payeeName', 'link'],
    samples: { link: 'https://app.laboura.com/p/pay/k7m4q2px' },
  },
  payment_only_link: {
    name: 'payment_only_link',
    label: 'Payment-only link (someone else pays)',
    text: 'Laboura: you were asked to pay Rs {{amount}} for the registration of {{firstName}} ({{code}}). Pay safely by UPI here: {{link}} The link works for a short time only.',
    variables: ['amount', 'firstName', 'code', 'link'],
    samples: { link: 'https://app.laboura.com/p/pay-only/k7m4q2px' },
  },
  payment_receipt: {
    name: 'payment_receipt',
    label: 'Payment receipt',
    text: 'Thank you! Laboura received your payment. Your receipt: {{link}} Keep it for your records.',
    variables: ['link'],
    samples: { link: 'https://app.laboura.com/payments/receipt/k7m4q2px' },
  },
  placement_invoice: {
    name: 'placement_invoice',
    label: 'Invoice for the placement fee',
    text: 'Thank you! Laboura received your payment. Your invoice {{invoiceCode}}: {{link}} Keep it for your records.',
    variables: ['invoiceCode', 'link'],
    samples: { link: 'https://app.laboura.com/placements/invoice/k7m4q2px' },
  },
  payout_details_link: {
    name: 'payout_details_link',
    label: 'Add payout details (UPI or bank)',
    text: 'Laboura: please add the UPI or bank details for your payout here: {{link}} The link works for 24 hours.',
    variables: ['link'],
    samples: { link: 'https://app.laboura.com/payout-accounts/link/k7m4q2px' },
  },
  // Records and consent.
  referral_partner_id: {
    name: 'referral_partner_id',
    label: 'Referral partner ID',
    text: 'Hi {{name}}, your Laboura referral partner ID is {{code}}. Keep it to follow the people you introduce.',
    variables: ['name', 'code'],
    samples: { code: 'RF-00007' },
  },
  consent_withdrawn: {
    name: 'consent_withdrawn',
    label: 'Consent withdrawn on a call',
    text: 'Laboura: as you asked on the call, your consent for {{purposes}} is withdrawn. To give consent again, ask your Laboura agent to send a consent link and complete it on your phone by OTP.',
    variables: ['purposes'],
  },
  phone_number_changed: {
    name: 'phone_number_changed',
    label: 'Mobile number changed (to the old number)',
    text: 'Laboura: the mobile number on your Laboura record {{code}} was changed to one ending {{newLast4}}. Call Laboura if this was not you.',
    variables: ['code', 'newLast4'],
  },
  // Staff.
  attendance_leave_decision: {
    name: 'attendance_leave_decision',
    label: 'Leave request decided (to the staff member)',
    text: 'Laboura: your leave request for {{dates}} was {{decision}}. See the details on your attendance page.',
    variables: ['dates', 'decision'],
  },
  attendance_correction_decision: {
    name: 'attendance_correction_decision',
    label: 'Attendance correction decided (to the staff member)',
    text: 'Laboura: your attendance correction for {{dates}} was {{decision}}. See the details on your attendance page.',
    variables: ['dates', 'decision'],
    samples: { dates: '24 Nov 2026' },
  },
  // ---- end of Builder C's section ----

  // ==== Builder A (25 Nov, Master Guide rev 211): job seeker order Consent → Selfie → Payment → ID check ====
  // Sent by src/modules/job-seeker/job-seeker-flow.service.ts with sendPreferWhatsApp (WhatsApp first, SMS
  // backup). None starts or ends with a variable. registration_done is no longer sent to job seekers
  // (replaced by payment_received_id_left and guarantee_started); its entry above stays for old messages.
  details_saved_pay_next: {
    name: 'details_saved_pay_next',
    label: 'Job seeker: details saved, pay next',
    text: 'Hi {{firstName}}, your details for Laboura registration {{code}} are saved. Next, pay {{amount}} on your link: {{link}} Your {{days}} days start once your ID is verified.',
    variables: ['firstName', 'code', 'amount', 'link', 'days'],
  },
  payment_received_id_left: {
    name: 'payment_received_id_left',
    label: 'Job seeker: payment received, only the ID check is left',
    text: 'Hi {{firstName}}, payment received for Laboura registration {{code}}. Only your ID check is left: {{link}} Your {{days}} days start once your ID is verified.',
    variables: ['firstName', 'code', 'link', 'days'],
  },
  guarantee_started: {
    name: 'guarantee_started',
    label: 'Job seeker: your 30 days have started',
    text: 'Hi {{firstName}}, your ID is verified and your {{days}} days have started. They end on {{endDate}}. Our team will call you about suitable jobs.',
    variables: ['firstName', 'days', 'endDate'],
  },
  id_check_failed_refund: {
    name: 'id_check_failed_refund',
    label: 'Job seeker: ID check did not pass, refund on request',
    text: 'Hi {{firstName}}, your ID check for Laboura registration {{code}} did not pass: {{reason}}. If your ID cannot be verified, contact us for a full refund of {{amount}}. Reply to this message or call us.',
    variables: ['firstName', 'code', 'reason', 'amount'],
  },
  id_check_reminder: {
    name: 'id_check_reminder',
    label: 'Job seeker: reminder to finish the ID check',
    text: 'Hi {{firstName}}, your Laboura payment is received, but your ID check is not done yet, so your {{days}} days have not started. Finish it here: {{link}} It takes two minutes.',
    variables: ['firstName', 'days', 'link'],
  },
  // ==== end of Builder A section ====
} as const satisfies Record<string, WhatsAppTemplateDef>;

export type WhatsAppTemplateName = keyof typeof WHATSAPP_TEMPLATES;

export const NEW_WHATSAPP_TEMPLATE_NAMES = Object.keys(WHATSAPP_TEMPLATES) as WhatsAppTemplateName[];

export function whatsappTemplate(name: string): WhatsAppTemplateDef | null {
  return (WHATSAPP_TEMPLATES as Record<string, WhatsAppTemplateDef>)[name] ?? null;
}

/** The templates an agent may pick in the WhatsApp tab once the 24-hour window has closed. */
export function agentTemplates(): WhatsAppTemplateDef[] {
  return Object.values(WHATSAPP_TEMPLATES as Record<string, WhatsAppTemplateDef>).filter((t) => t.agentPickable);
}

/** The text a template sends, with its variables filled (missing ones left empty). */
export function renderTemplate(name: string, variables: Record<string, string> = {}): string {
  const def = whatsappTemplate(name);
  if (!def) return '';
  return def.text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => variables[key] ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * The parameter name Meta knows a variable by: lowercase with underscores
 * (`firstName` → `first_name`, `newLast4` → `new_last4`). Used in the send
 * payload and in the submission sheet, so the two always agree.
 */
export function metaParameterName(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

/** Example values for the submission sheet (Meta asks for one per variable). */
export const SAMPLE_VALUES: Record<string, string> = {
  firstName: 'Ravi',
  candidateName: 'Ravi Kumar',
  candidateFirstName: 'Ravi',
  leadFirstName: 'Suresh',
  name: 'Ravi Kumar',
  code: 'LB-00123',
  referralCode: 'RF-00007',
  link: 'https://app.laboura.com/p/register/k7m4q2px',
  step: 'selfie',
  businessName: 'Sri Ganesh Hotel',
  business: 'Sri Ganesh Hotel',
  trade: 'cook',
  jobType: 'Cook',
  area: 'JP Nagar',
  address: '12, 15th Cross, JP Nagar',
  salaryRange: '₹15,000–₹18,000',
  salary: '₹15,000–₹18,000 a month',
  shift: 'day',
  interviewDay: '26 Nov 2026',
  interviewTime: '26 Nov 2026, 11:00 am',
  contactPerson: 'Mr Prakash',
  joiningDate: '1 Dec 2026',
  headcount: '2',
  startDate: '1 Dec 2026',
  amount: '499.00',
  payeeName: 'Laboura Staffing Pvt Ltd',
  invoiceCode: 'INV-2026-00045',
  purposes: 'calls about jobs',
  newLast4: '3210',
  dates: '24 Nov 2026 to 26 Nov 2026',
  decision: 'approved',
  photoLink: 'https://app.laboura.com/photo/k7m4q2px',
  result: 'selected, salary ₹15,000, joining 1 Dec 2026',
};

/** The example value for one variable of one template. */
export function sampleValue(def: WhatsAppTemplateDef, key: string): string {
  if (def.category === 'authentication' && key === 'code') return '482913';
  return def.samples?.[key] ?? SAMPLE_VALUES[key] ?? key;
}

/** Plain words for a registration step, used in the "stopped part-way" message. */
export const STEP_WORDS: Record<string, string> = {
  consent: 'consent',
  selfie: 'selfie',
  id_check: 'ID check',
  id_team_lead_check: 'ID check',
  terms: 'terms',
  trade_pending: 'terms',
  payment: 'payment',
  payment_failed: 'payment',
  upi: 'UPI details',
};
