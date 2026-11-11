import { formatINR } from '../../../lib/format/money';

/**
 * "Read this to them" scripts, shown in the PERSON's language (not the
 * agent's screen language), so they live here rather than in i18n. Wording
 * from the approved designs CA08, CA13 and CA15; the Kannada and Hindi need a
 * native speaker's check before launch.
 *
 * Every fee, percentage and period comes from Settings (the current
 * PricingPolicy, sent by GET /screens/call-registration/options as
 * `scriptTerms`) — never written here — so a change in Settings changes what
 * the agent reads out. A Manager never receives rupee figures (money
 * visibility), so for them the amounts are named in words instead.
 */
export type ScriptLanguage = 'kn' | 'hi' | 'en';

export const SCRIPT_LANGUAGE_LABELS: Record<ScriptLanguage, string> = { kn: 'ಕನ್ನಡ', hi: 'हिंदी', en: 'English' };

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

export function jobSeekerConsentScript(terms: ScriptTerms): Record<ScriptLanguage, string> {
  const fee = rupees(terms.activationFeePaise);
  const days = terms.jobSeekerGuaranteeDays;
  return {
    en: `“This call is recorded. Laboura uses your details only to find you a job. Businesses see your first name, photo, age and experience — never your phone number. We check your ID and keep only the result, never your Aadhaar number. We send job updates by SMS and WhatsApp.\n\nYou’ll get one link. On it you tick these permissions yourself, take a selfie, check your ID and pay ${fee ?? 'the registration fee'}. If we don’t offer you a suitable job within ${days} days, you get ${fee ? `your ${fee}` : 'the fee'} back. If you turn down a suitable offer or stop answering, the guarantee ends.”`,
    kn: `“ಈ ಕರೆ ರೆಕಾರ್ಡ್ ಆಗುತ್ತಿದೆ. ನಿಮಗೆ ಕೆಲಸ ಹುಡುಕಲು ಮಾತ್ರ Laboura ನಿಮ್ಮ ವಿವರಗಳನ್ನು ಬಳಸುತ್ತದೆ. ವ್ಯಾಪಾರಿಗಳು ನಿಮ್ಮ ಮೊದಲ ಹೆಸರು, ಫೋಟೋ, ವಯಸ್ಸು ಮತ್ತು ಅನುಭವವನ್ನು ಮಾತ್ರ ನೋಡುತ್ತಾರೆ — ನಿಮ್ಮ ಫೋನ್ ನಂಬರ್ ಎಂದೂ ಇಲ್ಲ. ನಾವು ನಿಮ್ಮ ಗುರುತಿನ ಚೀಟಿಯನ್ನು ಪರಿಶೀಲಿಸಿ ಫಲಿತಾಂಶ ಮಾತ್ರ ಇಡುತ್ತೇವೆ, ಆಧಾರ್ ನಂಬರ್ ಎಂದೂ ಇಡುವುದಿಲ್ಲ. ಕೆಲಸದ ಮಾಹಿತಿಯನ್ನು SMS ಮತ್ತು WhatsApp ಮೂಲಕ ಕಳುಹಿಸುತ್ತೇವೆ.\n\nನಿಮಗೆ ಒಂದು ಲಿಂಕ್ ಬರುತ್ತದೆ. ಅದರಲ್ಲಿ ನೀವೇ ಈ ಅನುಮತಿಗಳನ್ನು ಟಿಕ್ ಮಾಡಿ, ಸೆಲ್ಫಿ ತೆಗೆದು, ಗುರುತು ಪರಿಶೀಲಿಸಿ ${fee ?? 'ನೋಂದಣಿ ಶುಲ್ಕ'} ಪಾವತಿಸುತ್ತೀರಿ. ${days} ದಿನಗಳಲ್ಲಿ ಸೂಕ್ತ ಕೆಲಸ ಕೊಡದಿದ್ದರೆ ನಿಮ್ಮ ${fee ?? 'ಶುಲ್ಕ'} ವಾಪಸ್. ಸೂಕ್ತ ಕೆಲಸ ಬೇಡ ಎಂದರೆ ಅಥವಾ ಕರೆ ಎತ್ತದಿದ್ದರೆ ಗ್ಯಾರಂಟಿ ಮುಗಿಯುತ್ತದೆ.”`,
    hi: `“यह कॉल रिकॉर्ड हो रही है। Laboura आपकी जानकारी सिर्फ़ आपको नौकरी दिलाने के लिए इस्तेमाल करता है। कंपनियाँ आपका पहला नाम, फ़ोटो, उम्र और अनुभव ही देखती हैं — आपका फ़ोन नंबर कभी नहीं। हम आपकी आईडी जाँचकर सिर्फ़ नतीजा रखते हैं, आधार नंबर कभी नहीं। नौकरी की जानकारी SMS और WhatsApp पर भेजते हैं।\n\nआपको एक लिंक मिलेगा। उसमें आप ख़ुद ये अनुमतियाँ टिक करेंगे, सेल्फ़ी लेंगे, आईडी जाँचेंगे और ${fee ?? 'पंजीकरण शुल्क'} देंगे। अगर ${days} दिन में सही नौकरी का ऑफ़र नहीं मिला तो आपके ${fee ?? 'शुल्क'} वापस। सही ऑफ़र मना करने या फ़ोन न उठाने पर गारंटी ख़त्म हो जाती है।”`,
  };
}

export function businessScript(terms: ScriptTerms): Record<ScriptLanguage, string> {
  const fee = terms.placementFeePercent;
  const gst = terms.gstPercent;
  const window = terms.replacementWindowDays;
  const times = terms.maxFreeReplacements;
  const months = terms.noBypassMonths;
  const penalty = terms.noBypassPenaltyPercent;
  return {
    en: `“This call is recorded. Laboura sends you verified candidates. You pay only when you select someone: ${fee}% of their first month’s salary plus ${gst}% GST. If they leave within ${window} days, we replace them free, up to ${times} times. If you hire someone we introduced without going through Laboura within ${months} months, the full fee plus ${penalty}% applies.\n\nYou’ll get a link to read the agreement and agree to it by OTP. A field agent will visit to verify your business before we show you candidates.”`,
    kn: `“ಈ ಕರೆ ರೆಕಾರ್ಡ್ ಆಗುತ್ತಿದೆ. Laboura ನಿಮಗೆ ಪರಿಶೀಲಿಸಿದ ಅಭ್ಯರ್ಥಿಗಳನ್ನು ಕಳುಹಿಸುತ್ತದೆ. ನೀವು ಯಾರನ್ನಾದರೂ ಆಯ್ಕೆ ಮಾಡಿದಾಗ ಮಾತ್ರ ಪಾವತಿಸುತ್ತೀರಿ: ಅವರ ಮೊದಲ ತಿಂಗಳ ಸಂಬಳದ ${fee}% ಜೊತೆಗೆ ${gst}% GST. ${window} ದಿನಗಳಲ್ಲಿ ಅವರು ಬಿಟ್ಟರೆ, ${times} ಬಾರಿಯವರೆಗೆ ಉಚಿತವಾಗಿ ಬದಲಿ ಕೊಡುತ್ತೇವೆ. ನಾವು ಪರಿಚಯಿಸಿದವರನ್ನು ${months} ತಿಂಗಳೊಳಗೆ Laboura ಮೂಲಕವಲ್ಲದೆ ನೇಮಿಸಿಕೊಂಡರೆ ಪೂರ್ಣ ಶುಲ್ಕ ಜೊತೆಗೆ ${penalty}% ಅನ್ವಯಿಸುತ್ತದೆ.\n\nಒಪ್ಪಂದವನ್ನು ಓದಿ OTP ಮೂಲಕ ಒಪ್ಪಲು ನಿಮಗೆ ಲಿಂಕ್ ಬರುತ್ತದೆ. ಅಭ್ಯರ್ಥಿಗಳನ್ನು ತೋರಿಸುವ ಮೊದಲು ಫೀಲ್ಡ್ ಏಜೆಂಟ್ ಬಂದು ನಿಮ್ಮ ವ್ಯಾಪಾರವನ್ನು ಪರಿಶೀಲಿಸುತ್ತಾರೆ.”`,
    hi: `“यह कॉल रिकॉर्ड हो रही है। Laboura आपको जाँचे हुए उम्मीदवार भेजता है। आप तभी भुगतान करते हैं जब किसी को चुनते हैं: उसकी पहले महीने की सैलरी का ${fee}% और ${gst}% GST। अगर वह ${window} दिन में छोड़ दे, तो हम ${times} बार तक मुफ़्त में दूसरा देते हैं। अगर हमारे मिलवाए किसी को ${months} महीने के अंदर Laboura के बिना रखा, तो पूरी फ़ीस और ${penalty}% लगेगा।\n\nआपको एग्रीमेंट पढ़कर OTP से मंज़ूर करने का लिंक मिलेगा। उम्मीदवार दिखाने से पहले फ़ील्ड एजेंट आकर आपका बिज़नेस जाँचेगा।”`,
  };
}

export function referralScript(terms: ScriptTerms): Record<ScriptLanguage, string> {
  const reward = rupees(terms.referralPayoutPaise);
  return {
    en: `“This call is recorded. When someone you send to Laboura joins a job, you get ${reward ?? 'the referral reward'} by UPI — not when they register or pay. You’ll get a Partner ID by SMS; people you send should mention it. You’ll also get one link: agree to the terms, take a selfie, check your ID and add your UPI ID.”`,
    kn: `“ಈ ಕರೆ ರೆಕಾರ್ಡ್ ಆಗುತ್ತಿದೆ. ನೀವು Laboura ಗೆ ಕಳುಹಿಸಿದವರು ಕೆಲಸಕ್ಕೆ ಸೇರಿದಾಗ ನಿಮಗೆ UPI ಮೂಲಕ ${reward ?? 'ರೆಫರಲ್ ಬಹುಮಾನ'} ಸಿಗುತ್ತದೆ — ಅವರು ನೋಂದಾಯಿಸಿದಾಗ ಅಥವಾ ಪಾವತಿಸಿದಾಗ ಅಲ್ಲ. ನಿಮಗೆ SMS ಮೂಲಕ ಪಾರ್ಟ್ನರ್ ID ಬರುತ್ತದೆ; ನೀವು ಕಳುಹಿಸುವವರು ಅದನ್ನು ಹೇಳಬೇಕು. ನಿಮಗೆ ಒಂದು ಲಿಂಕ್ ಕೂಡ ಬರುತ್ತದೆ: ನಿಯಮಗಳಿಗೆ ಒಪ್ಪಿ, ಸೆಲ್ಫಿ ತೆಗೆದು, ಗುರುತು ಪರಿಶೀಲಿಸಿ ನಿಮ್ಮ UPI ID ಸೇರಿಸಿ.”`,
    hi: `“यह कॉल रिकॉर्ड हो रही है। आपके भेजे हुए किसी व्यक्ति को नौकरी मिलने पर (जॉइन करने पर) आपको UPI से ${reward ?? 'रेफ़रल इनाम'} मिलेंगे — रजिस्टर या भुगतान करने पर नहीं। आपको SMS से पार्टनर ID मिलेगी; जिन्हें आप भेजें वे इसे बताएँ। आपको एक लिंक भी मिलेगा: शर्तें मानें, सेल्फ़ी लें, आईडी जाँचें और अपनी UPI ID डालें।”`,
  };
}
