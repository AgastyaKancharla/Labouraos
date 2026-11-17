import { formatINR } from '../../../lib/format/money';

/**
 * "Read this to them" scripts, in English (English only, Master Guide rev
 * 193). Wording from the approved designs CA08, CA13 and CA15.
 *
 * Every fee, percentage and period comes from Settings (the current
 * PricingPolicy, sent by GET /screens/call-registration/options as
 * `scriptTerms`) — never written here — so a change in Settings changes what
 * the agent reads out. A Manager never receives rupee figures (money
 * visibility), so for them the amounts are named in words instead.
 */
/** The PricingPolicy values the scripts read out. Rupee amounts are absent for Managers. */
export interface ScriptTerms {
  activationFeePaise?: number | null;
  referralPayoutPaise?: number | null;
  placementFeePercent: number;
  gstPercent: number;
  jobSeekerGuaranteeDays: number;
  replacementWindowDays: number;
  maxFreeReplacements: number;
  noBypassMonths: number;
  noBypassPenaltyPercent: number;
}

function rupees(paise: number | null | undefined): string | null {
  return typeof paise === 'number' && Number.isInteger(paise) ? formatINR(paise) : null;
}

export function jobSeekerConsentScript(terms: ScriptTerms): string {
  const fee = rupees(terms.activationFeePaise);
  const days = terms.jobSeekerGuaranteeDays;
  return `“This call is recorded. Laboura uses your details only to find you a job. Businesses see your first name, photo, age and experience — never your phone number. We check your ID and keep only the result, never your Aadhaar number. We send job updates by SMS and WhatsApp.\n\nYou’ll get one link. On it you tick these permissions yourself, take a selfie, check your ID and pay ${fee ?? 'the registration fee'}. If we don’t offer you a suitable job within ${days} days, you get ${fee ? `your ${fee}` : 'the fee'} back. If you turn down a suitable offer or stop answering, the guarantee ends.”`;
}

export function businessScript(terms: ScriptTerms): string {
  const fee = terms.placementFeePercent;
  const gst = terms.gstPercent;
  const window = terms.replacementWindowDays;
  const times = terms.maxFreeReplacements;
  const months = terms.noBypassMonths;
  const penalty = terms.noBypassPenaltyPercent;
  return `“This call is recorded. Laboura sends you verified candidates. You pay only when you select someone: ${fee}% of their first month’s salary plus ${gst}% GST. If they leave within ${window} days, we replace them free, up to ${times} times. If you hire someone we introduced without going through Laboura within ${months} months, the full fee plus ${penalty}% applies.\n\nYou’ll get a link to read the agreement and agree to it by OTP. A field agent will visit to verify your business before we show you candidates.”`;
}

export function referralScript(terms: ScriptTerms): string {
  const reward = rupees(terms.referralPayoutPaise);
  return `“This call is recorded. When someone you send to Laboura joins a job, you get ${reward ?? 'the referral reward'} by UPI — not when they register or pay. You’ll get a Partner ID by SMS; people you send should mention it. You’ll also get one link: agree to the terms, take a selfie, check your ID and add your UPI ID.”`;
}
