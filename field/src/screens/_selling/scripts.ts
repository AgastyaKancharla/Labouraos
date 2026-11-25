/**
 * "Read this to them" texts for the field agent, in English (English only,
 * Master Guide rev 193). The consent wording is the same as the call agent's
 * (web CA08); the pitch is FA14.
 */
export const JOB_SEEKER_CONSENT_SCRIPT = '“This call is recorded. Laboura uses your details only to find you a job. Businesses see your first name, photo, age and experience — never your phone number. We check your ID and keep only the result, never your Aadhaar number. We send job updates by SMS and WhatsApp.\n\nYou’ll get one link. On it you tick these permissions yourself, take a selfie, pay ₹499 and then check your ID. Your 30 days start only after your government ID is verified. If we don’t offer you a suitable job within those 30 days, you get your ₹499 back. If you turn down a suitable offer or stop answering, the guarantee ends.”';

/**
 * FA14 — "Explain Laboura" in three lines. {fee} and {gst} come from Settings;
 * line 2 says "half" when the fee is 50%.
 */
export function pitchLines(feePercent: number, gstPercent: number, replacements = 2, guaranteeDays = 60): string[] {
  const half = feePercent === 50;
  return [
    'We send you verified staff — ID-checked, with a photo and experience.',
    half
      ? `You pay only when you select someone: half of their first month’s salary + ${gstPercent}% GST.`
      : `You pay only when you select someone: ${feePercent}% of their first month’s salary + ${gstPercent}% GST.`,
    `If they leave within ${guaranteeDays} days, we replace them free, up to ${replacements} times.`,
  ];
}
