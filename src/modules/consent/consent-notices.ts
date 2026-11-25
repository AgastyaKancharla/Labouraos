/**
 * The job seeker's six itemised consent ticks — taken word for word from Job
 * Seeker Terms v1.1, Part B (notice 1.2, Master Guide rev 176, 15 Nov), unchanged
 * in notice 1.3 (rev 211), which adds GUARANTEE_START_NOTICE above them.
 * `withdrawal` is the document's "If you withdraw it later" column.
 *
 * The English is the owner-approved text (English only, rev 193). Consents
 * given under 1.0 / 1.1 stay valid until the
 * person accepts 1.2 (re-consent, legal-document.service.ts).
 */
export type ConsentNotice = { title: string; description: string; withdrawal: string };

/**
 * Notice version 1.3 (Master Guide rev 211, "Decided 25 Nov"): the line every consent page shows a job
 * seeker above the ticks, word for word. The order is Consent → Selfie → Payment → ID check, so the
 * 30 days wait for the ID check. Someone who consented under 1.2 is asked again (re-consent).
 */
export const GUARANTEE_START_NOTICE = 'Your 30 days start only after your government ID is verified. Until then your registration is paused.';

export const CONSENT_NOTICES: Record<string, Record<'en', ConsentNotice>> = {
  job_matching: {
    en: {
      title: '1. Job matching',
      description: 'I consent to Laboura matching my profile with potential employers and vacancies.',
      withdrawal: 'Laboura stops matching you. After paying, this ends your refund.',
    },
  },
  profile_sharing: {
    en: {
      title: '2. Profile sharing',
      description:
        'I consent to Laboura sharing my work experience and verified details with prospective employers: my first name, selfie, age, experience, languages, distance, expected salary and verified status, never my phone number.',
      withdrawal: 'Businesses stop seeing your card. After paying, this ends your refund.',
    },
  },
  call_recording: {
    en: {
      title: '3. Call recording',
      description:
        'I consent to calls with Laboura staff and prospective employers being recorded for quality and verification. Every call starts with an announcement.',
      withdrawal: 'Laboura cannot call you through its system. After paying, this ends your refund.',
    },
  },
  aadhaar_verification: {
    // Guide, "Aadhaar verification" (14 Nov): exactly what is read, what is kept and what is never kept.
    en: {
      title: '4. ID check (Aadhaar or another ID)',
      description:
        "I consent to Laboura checking my ID to confirm who I am and that I am 18 or older. Aadhaar: the Secure QR code on my Aadhaar is read on my own phone (or from my e-Aadhaar PDF, which stays on my phone) and only the QR's data is sent; Laboura checks UIDAI's digital signature. Laboura keeps only: verified or not, the method, the date and time, the last 4 digits of my Aadhaar number and the QR's time stamp, my name, date of birth, gender, area and pincode, whether the name matches, whether my phone is linked to that Aadhaar, whether I am 18 or older, and this consent. The photo from the QR is kept only until a Team Lead compares it with my selfie (30 days at most). Laboura never keeps my full Aadhaar number, any picture of my card, my e-Aadhaar PDF or XML, or my full address. Another ID: I can use PAN, a driving licence or a voter ID instead. A live photo of the card is checked by a Team Lead and deleted after the check (30 days at most); only the ID type and the last 4 characters of its number are kept.",
      withdrawal: 'The check already done stays recorded as a result only. You cannot be matched without a verified ID.',
    },
  },
  job_updates: {
    en: {
      title: '5. Job updates',
      description: 'I consent to receiving job alerts, interview schedules and application updates by SMS, WhatsApp and phone.',
      withdrawal: 'Job alerts stop. Your refund is not affected. Messages you need for an offer or interview you are already part of still reach you.',
    },
  },
  promotions: {
    en: {
      title: '6. Promotions (optional)',
      description: 'I consent to receiving promotional offers and news from Laboura.',
      withdrawal: 'Promotions stop. Nothing else changes.',
    },
  },
};
