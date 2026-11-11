/**
 * "Read this to them" texts, shown in the OTHER PERSON's language (the
 * owner's or the job seeker's), not the agent's screen language — so they
 * live here rather than in i18n. The consent wording is the same as the call
 * agent's (web CA08); the pitch is FA14. Kannada and Hindi to be checked by a
 * native speaker before launch.
 */
export type ScriptLanguage = 'kn' | 'hi' | 'en';

export const SCRIPT_LANGUAGES: readonly { value: ScriptLanguage; label: string }[] = [
  { value: 'kn', label: 'ಕನ್ನಡ' },
  { value: 'hi', label: 'हिंदी' },
  { value: 'en', label: 'English' },
];

export const JOB_SEEKER_CONSENT_SCRIPT: Record<ScriptLanguage, string> = {
  en:
    '“This call is recorded. Laboura uses your details only to find you a job. Businesses see your first name, photo, age and experience — never your phone number. We check your ID and keep only the result, never your Aadhaar number. We send job updates by SMS and WhatsApp.\n\nYou’ll get one link. On it you tick these permissions yourself, take a selfie, check your ID and pay ₹499. If we don’t offer you a suitable job within 30 days, you get your ₹499 back. If you turn down a suitable offer or stop answering, the guarantee ends.”',
  kn:
    '“ಈ ಕರೆ ರೆಕಾರ್ಡ್ ಆಗುತ್ತಿದೆ. ನಿಮಗೆ ಕೆಲಸ ಹುಡುಕಲು ಮಾತ್ರ Laboura ನಿಮ್ಮ ವಿವರಗಳನ್ನು ಬಳಸುತ್ತದೆ. ವ್ಯಾಪಾರಿಗಳು ನಿಮ್ಮ ಮೊದಲ ಹೆಸರು, ಫೋಟೋ, ವಯಸ್ಸು ಮತ್ತು ಅನುಭವವನ್ನು ಮಾತ್ರ ನೋಡುತ್ತಾರೆ — ನಿಮ್ಮ ಫೋನ್ ನಂಬರ್ ಎಂದೂ ಇಲ್ಲ. ನಾವು ನಿಮ್ಮ ಗುರುತಿನ ಚೀಟಿಯನ್ನು ಪರಿಶೀಲಿಸಿ ಫಲಿತಾಂಶ ಮಾತ್ರ ಇಡುತ್ತೇವೆ, ಆಧಾರ್ ನಂಬರ್ ಎಂದೂ ಇಡುವುದಿಲ್ಲ. ಕೆಲಸದ ಮಾಹಿತಿಯನ್ನು SMS ಮತ್ತು WhatsApp ಮೂಲಕ ಕಳುಹಿಸುತ್ತೇವೆ.\n\nನಿಮಗೆ ಒಂದು ಲಿಂಕ್ ಬರುತ್ತದೆ. ಅದರಲ್ಲಿ ನೀವೇ ಈ ಅನುಮತಿಗಳನ್ನು ಟಿಕ್ ಮಾಡಿ, ಸೆಲ್ಫಿ ತೆಗೆದು, ಗುರುತು ಪರಿಶೀಲಿಸಿ ₹499 ಪಾವತಿಸುತ್ತೀರಿ. 30 ದಿನಗಳಲ್ಲಿ ಸೂಕ್ತ ಕೆಲಸ ಕೊಡದಿದ್ದರೆ ನಿಮ್ಮ ₹499 ವಾಪಸ್. ಸೂಕ್ತ ಕೆಲಸ ಬೇಡ ಎಂದರೆ ಅಥವಾ ಕರೆ ಎತ್ತದಿದ್ದರೆ ಗ್ಯಾರಂಟಿ ಮುಗಿಯುತ್ತದೆ.”',
  hi:
    '“यह कॉल रिकॉर्ड हो रही है। Laboura आपकी जानकारी सिर्फ़ आपको नौकरी दिलाने के लिए इस्तेमाल करता है। कंपनियाँ आपका पहला नाम, फ़ोटो, उम्र और अनुभव ही देखती हैं — आपका फ़ोन नंबर कभी नहीं। हम आपकी आईडी जाँचकर सिर्फ़ नतीजा रखते हैं, आधार नंबर कभी नहीं। नौकरी की जानकारी SMS और WhatsApp पर भेजते हैं।\n\nआपको एक लिंक मिलेगा। उसमें आप ख़ुद ये अनुमतियाँ टिक करेंगे, सेल्फ़ी लेंगे, आईडी जाँचेंगे और ₹499 देंगे। अगर 30 दिन में सही नौकरी का ऑफ़र नहीं मिला तो आपके ₹499 वापस। सही ऑफ़र मना करने या फ़ोन न उठाने पर गारंटी ख़त्म हो जाती है।”',
};

/**
 * FA14 — "Explain Laboura" in three lines. {fee} and {gst} come from Settings;
 * line 2 says "half" when the fee is 50%.
 */
export function pitchLines(language: ScriptLanguage, feePercent: number, gstPercent: number, replacements = 2, guaranteeDays = 60): string[] {
  const half = feePercent === 50;
  if (language === 'kn') {
    return [
      'ನಾವು ನಿಮಗೆ ಪರಿಶೀಲಿಸಿದ ಸಿಬ್ಬಂದಿಯನ್ನು ಕಳುಹಿಸುತ್ತೇವೆ — ಗುರುತು ಪರಿಶೀಲಿಸಿದ, ಫೋಟೋ ಮತ್ತು ಅನುಭವದೊಂದಿಗೆ.',
      half
        ? `ನೀವು ಯಾರನ್ನಾದರೂ ಆಯ್ಕೆ ಮಾಡಿದಾಗ ಮಾತ್ರ ಪಾವತಿಸುತ್ತೀರಿ: ಅವರ ಮೊದಲ ತಿಂಗಳ ಸಂಬಳದ ಅರ್ಧ + ${gstPercent}% GST.`
        : `ನೀವು ಯಾರನ್ನಾದರೂ ಆಯ್ಕೆ ಮಾಡಿದಾಗ ಮಾತ್ರ ಪಾವತಿಸುತ್ತೀರಿ: ಅವರ ಮೊದಲ ತಿಂಗಳ ಸಂಬಳದ ${feePercent}% + ${gstPercent}% GST.`,
      `ಅವರು ${guaranteeDays} ದಿನಗಳಲ್ಲಿ ಬಿಟ್ಟರೆ, ${replacements} ಬಾರಿಯವರೆಗೆ ಉಚಿತವಾಗಿ ಬದಲಿ ಕೊಡುತ್ತೇವೆ.`,
    ];
  }
  if (language === 'hi') {
    return [
      'हम आपको जाँचे हुए कर्मचारी भेजते हैं — आईडी जाँची हुई, फ़ोटो और अनुभव के साथ।',
      half
        ? `आप तभी भुगतान करते हैं जब किसी को चुनते हैं: उसकी पहले महीने की सैलरी का आधा + ${gstPercent}% GST।`
        : `आप तभी भुगतान करते हैं जब किसी को चुनते हैं: उसकी पहले महीने की सैलरी का ${feePercent}% + ${gstPercent}% GST।`,
      `अगर वह ${guaranteeDays} दिन में छोड़ दे, तो हम ${replacements} बार तक मुफ़्त में दूसरा देते हैं।`,
    ];
  }
  return [
    'We send you verified staff — ID-checked, with a photo and experience.',
    half
      ? `You pay only when you select someone: half of their first month’s salary + ${gstPercent}% GST.`
      : `You pay only when you select someone: ${feePercent}% of their first month’s salary + ${gstPercent}% GST.`,
    `If they leave within ${guaranteeDays} days, we replace them free, up to ${replacements} times.`,
  ];
}
