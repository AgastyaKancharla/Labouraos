export const REFERRAL_TERMS_VERSION = '1.0';

export type AgreementLanguage = 'kn' | 'hi' | 'en';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderReferralTerms(
  referralPayoutPaise: number,
  language: AgreementLanguage,
): string {
  const payoutRupees = Math.round(referralPayoutPaise / 100);

  const translations: Record<
    AgreementLanguage,
    { title: string; payout: string; rules: string; callRecording: string }
  > = {
    en: {
      title: 'Laboura Referral Partner Terms',
      payout: `You will receive ₹${payoutRupees} for each candidate referred by you who joins a verified business through Laboura.`,
      rules:
        'Referral rewards are paid manually from the company account to your verified payout details after name matching. Payout details must be entered on your own phone via OTP, and any change requires a 48-hour cooling period.',
      callRecording:
        'By signing these terms, you also consent to call recording for verification, coordination, and quality assurance.',
    },
    hi: {
      title: 'Laboura रेफरल पार्टनर शर्तें',
      payout: `Laboura के माध्यम से किसी सत्यापित व्यवसाय में शामिल होने वाले आपके द्वारा रेफर किए गए प्रत्येक उम्मीदवार के लिए आपको ₹${payoutRupees} प्राप्त होंगे।`,
      rules:
        'रेफरल पुरस्कार नाम मिलान के बाद कंपनी खाते से आपके सत्यापित पेआउट खाते में मैन्युअल रूप से भुगतान किए जाते हैं। पेआउट विवरण आपके अपने फोन पर OTP द्वारा दर्ज होना आवश्यक है, और किसी भी बदलाव पर 48 घंटे का कूलिंग पीरियड लागू होता है।',
      callRecording:
        'इन शर्तों पर हस्ताक्षर करके, आप सत्यापन, समन्वय और गुणवत्ता आश्वासन के लिए कॉल रिकॉर्डिंग की भी सहमति देते हैं।',
    },
    kn: {
      title: 'Laboura ರೆಫರಲ್ ಪಾಲುದಾರರ ನಿಯಮಗಳು',
      payout: `Laboura ಮೂಲಕ ಪರಿಶೀಲಿಸಿದ ವ್ಯವಹಾರಕ್ಕೆ ಸೇರುವ ನೀವು ರೆಫರ್ ಮಾಡಿದ ಪ್ರತಿಯೊಬ್ಬ ಅಭ್ಯರ್ಥಿಗೂ ₹${payoutRupees} ಗಳಿಸುತ್ತೀರಿ.`,
      rules:
        'ರೆಫರಲ್ ಬಹುಮಾನವನ್ನು ಹೆಸರು ಹೊಂದಾಣಿಕೆಯ ನಂತರ ಕಂಪನಿಯ ಖಾತೆಯಿಂದ ನಿಮ್ಮ ಪರಿಶೀಲಿತ ಪಾವತಿ ವಿವರಗಳಿಗೆ ಮ್ಯಾನುಯಲ್ ಆಗಿ ಪಾವತಿಸಲಾಗುತ್ತದೆ. ಪಾವತಿ ವಿವರಗಳನ್ನು OTP ಮೂಲಕ ನಿಮ್ಮ ಸ್ವಂತ ಫೋನ್‌ನಲ್ಲಿ ನಮೂದಿಸಬೇಕು ಮತ್ತು ಯಾವುದೇ ಬದಲಾವಣೆಗೆ 48 ಗಂಟೆಗಳ ಕಾಯುವ ಅವಧಿ ಅನ್ವಯಿಸುತ್ತದೆ.',
      callRecording:
        'ಈ ನಿಯಮಗಳಿಗೆ ಸಹಿ ಮಾಡುವ ಮೂಲಕ, ಪರಿಶೀಲನೆ, ಸಮನ್ವಯ ಮತ್ತು ಗುಣಮಟ್ಟದ ಭರವಸೆಗಾಗಿ ಕರೆ ರೆಕಾರ್ಡಿಂಗ್‌ಗೂ ನೀವು ಸಮ್ಮತಿಸುತ್ತೀರಿ.',
    },
  };

  const copy = translations[language] || translations.en;
  return `<article lang="${language}" data-template-version="${REFERRAL_TERMS_VERSION}"><h1>${escapeHtml(copy.title)}</h1><p>${escapeHtml(copy.payout)}</p><p>${escapeHtml(copy.rules)}</p><p>${escapeHtml(copy.callRecording)}</p></article>`;
}
