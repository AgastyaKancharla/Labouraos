export const BUSINESS_AGREEMENT_VERSION = '1.0';

export type AgreementLanguage = 'kn' | 'hi' | 'en';

export interface AgreementTermsNumbers {
  noBypassMonths: number;
  noBypassPenaltyPercent: number;
  feePercent: number;
  gstPercent: number;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderBusinessAgreementTerms(
  numbers: AgreementTermsNumbers,
  language: AgreementLanguage,
): string {
  const translations: Record<AgreementLanguage, { title: string; fee: string; noBypass: string }> = {
    en: {
      title: 'Laboura Business Agreement',
      fee: `When a candidate is selected, the business pays ${numbers.feePercent}% of the agreed first-month salary, plus ${numbers.gstPercent}% GST.`,
      noBypass: `If the business hires a candidate introduced by Laboura during the ${numbers.noBypassMonths}-month no-bypass period, the business owes the full placement fee plus a ${numbers.noBypassPenaltyPercent}% penalty.`,
    },
    hi: {
      title: 'Laboura व्यवसाय समझौता',
      fee: `उम्मीदवार चुने जाने पर व्यवसाय सहमत पहले महीने के वेतन का ${numbers.feePercent}% और ${numbers.gstPercent}% GST देता है।`,
      noBypass: `यदि व्यवसाय ${numbers.noBypassMonths} महीने की अवधि में Laboura द्वारा परिचित कराए गए उम्मीदवार को नियुक्त करता है, तो पूरा प्लेसमेंट शुल्क और ${numbers.noBypassPenaltyPercent}% जुर्माना देना होगा।`,
    },
    kn: {
      title: 'Laboura ವ್ಯವಹಾರ ಒಪ್ಪಂದ',
      fee: `ಅಭ್ಯರ್ಥಿಯನ್ನು ಆಯ್ಕೆ ಮಾಡಿದಾಗ, ವ್ಯವಹಾರವು ಒಪ್ಪಿದ ಮೊದಲ ತಿಂಗಳ ವೇತನದ ${numbers.feePercent}% ಮತ್ತು ${numbers.gstPercent}% GST ಪಾವತಿಸುತ್ತದೆ.`,
      noBypass: `Laboura ಪರಿಚಯಿಸಿದ ಅಭ್ಯರ್ಥಿಯನ್ನು ${numbers.noBypassMonths} ತಿಂಗಳ ಅವಧಿಯಲ್ಲಿ ನೇಮಿಸಿದರೆ, ಪೂರ್ಣ ನೇಮಕಾತಿ ಶುಲ್ಕದ ಜೊತೆಗೆ ${numbers.noBypassPenaltyPercent}% ದಂಡವನ್ನು ವ್ಯವಹಾರ ಪಾವತಿಸಬೇಕು.`,
    },
  };
  const copy = translations[language];
  return `<article lang="${language}" data-template-version="${BUSINESS_AGREEMENT_VERSION}"><h1>${escapeHtml(copy.title)}</h1><p>${escapeHtml(copy.fee)}</p><p>${escapeHtml(copy.noBypass)}</p></article>`;
}

export function renderSignedAgreementDocument(termsHtml: string): string {
  return termsHtml;
}

export function maskAgreementPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return `******${digits.slice(-4)}`;
}
