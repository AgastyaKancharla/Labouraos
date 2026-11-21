/**
 * WhatsApp message templates (Master Guide rev 202, 21 Nov), as config.
 *
 * WhatsApp only lets a business start a conversation (or write after the
 * 24-hour reply window has closed) with a template Meta approved beforehand.
 * Each entry here is the English text submitted for approval: the name must
 * match the approved template in WhatsApp Manager, and `variables` are the
 * named parameters in the order they appear. The same name is used for the SMS
 * fallback (its DLT template id comes from SMS_DLT_TEMPLATE_IDS).
 *
 * English only (rev 193). Changing a text here means submitting it to Meta
 * again before the real provider can send it.
 */
export interface WhatsAppTemplateDef {
  name: string;
  /** What it is for, for people (the agent's template picker shows it). */
  label: string;
  /** The approved text. `{{name}}` marks a variable. */
  text: string;
  variables: readonly string[];
  /** An agent may pick it in the WhatsApp tab (after the 24-hour window). */
  agentPickable?: boolean;
}

export const WHATSAPP_TEMPLATES = {
  // ---- Automatic event messages (SMS as fallback) ----
  registration_done: {
    name: 'registration_done',
    label: 'Registration done',
    text: 'Hi {{firstName}}, welcome to Laboura! Your registration {{code}} is complete. Our team will call you about suitable jobs. Save this number to reach us on WhatsApp.',
    variables: ['firstName', 'code'],
  },
  partner_registration_done: {
    name: 'partner_registration_done',
    label: 'Referral partner registration done',
    text: 'Hi {{firstName}}, you are now a Laboura referral partner ({{code}}). Share your personal link with people looking for a job or staff: {{link}}',
    variables: ['firstName', 'code', 'link'],
  },
  business_registration_done: {
    name: 'business_registration_done',
    label: 'Business verified',
    text: 'Hi {{firstName}}, {{businessName}} is now verified on Laboura ({{code}}). Our team will share matching candidates for your vacancies.',
    variables: ['firstName', 'businessName', 'code'],
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
  // ---- Links an agent sends ("Send on WhatsApp" next to Resend) ----
  consent_link: {
    name: 'consent_link',
    label: 'Registration link',
    text: 'Your Laboura registration link: {{link}} It continues from the step you stopped at.',
    variables: ['link'],
  },
  agreement_link: {
    name: 'agreement_link',
    label: 'Business agreement link',
    text: 'Please read and sign the Laboura business agreement here: {{link}}',
    variables: ['link'],
  },
  referral_terms_link: {
    name: 'referral_terms_link',
    label: 'Referral partner terms link',
    text: 'Your Laboura referral partner ID is {{referralCode}}. Finish your registration here: {{link}}',
    variables: ['link', 'referralCode'],
  },
  // ---- Inbound conversations ----
  whatsapp_off_shift_reply: {
    name: 'whatsapp_off_shift_reply',
    label: 'Automatic reply when nobody is on shift',
    text: 'Thanks! An agent will call you by 10 AM.',
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
    label: 'We tried to call you',
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
