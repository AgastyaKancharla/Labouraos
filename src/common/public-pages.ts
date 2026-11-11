import { publicLink } from './public-link';

/**
 * The public phone pages of the web app (web/src/screens/public, served at
 * /app/p/...). Every SMS and WhatsApp link to a job seeker, a business owner
 * or someone paying for a job seeker points at one of these. The older
 * server-rendered URLs (/consent/:token, /interviews/reply/:token …) redirect
 * here, so links already sent keep working.
 *
 * Keep in step with publicScreens in web/src/portals/screens.ts.
 */
export const PUBLIC_PAGE_PATHS = {
  /** P00 → P02b: the one registration link that resumes (consent, selfie, ID check, terms and ₹499). */
  registration: 'register',
  /** P02s: someone else pays the ₹499 (payment-only link, 15 minutes, OTP to the payer). */
  paymentOnly: 'pay',
  /** P03: the job seeker replies to an interview offer within 48 hours. */
  offerReply: 'offer',
  /** P04: the business signs the agreement by OTP. */
  businessAgreement: 'agreement',
  /** P05: the owner records the interview result by OTP. */
  interviewResult: 'interview-result',
  /** P05b: a UPI payment request (placement fee, or the ₹499) by its UPI reference. */
  payment: 'fee',
  /** P06: "Did they offer you the job?" to the candidate. */
  offerCheck: 'did-they-offer',
} as const;

export type PublicPage = keyof typeof PUBLIC_PAGE_PATHS;

/** Path of a public page inside the site: publicPagePath('offerReply', t) → '/app/p/offer/t'. */
export function publicPagePath(page: PublicPage, token: string): string {
  if (!token) throw new Error(`A ${page} link needs a token`);
  return `/app/p/${PUBLIC_PAGE_PATHS[page]}/${encodeURIComponent(token)}`;
}

/** Absolute link to a public page, for SMS and WhatsApp. */
export function publicPageLink(page: PublicPage, token: string): string {
  return publicLink(publicPagePath(page, token));
}

/** True when a browser (not an API client) asked for the page. */
export function wantsHtml(accept: string | undefined): boolean {
  return Boolean(accept && accept.includes('text/html'));
}
