export const CONSENT_NOTICES: Record<
  string,
  Record<'en' | 'kn' | 'hi', { title: string; description: string }>
> = {
  job_matching: {
    en: {
      title: 'Job Matching',
      description: 'I consent to Laboura matching my profile with potential employers and vacancies.',
    },
    kn: {
      title: 'ಉದ್ಯೋಗ ಹೊಂದಾಣಿಕೆ',
      description: 'ನನ್ನ ಪ್ರೊಫೈಲ್ ಅನ್ನು ಸಂಭಾವ್ಯ ಉದ್ಯೋಗದಾತರೊಂದಿಗೆ ಹೊಂದಿಸಲು ನಾನು ಲ್ಯಾಬೂರಾಗೆ ಒಪ್ಪಿಗೆ ನೀಡುತ್ತೇನೆ.',
    },
    hi: {
      title: 'नौकरी मिलान',
      description: 'मैं संभावित नियोक्ताओं के साथ अपनी प्रोफ़ाइल मिलाने के लिए लेबूरा को सहमति देता/देती हूँ।',
    },
  },
  profile_sharing: {
    en: {
      title: 'Profile Sharing',
      description: 'I consent to Laboura sharing my work experience and verified details with prospective employers.',
    },
    kn: {
      title: 'ಪ್ರೊಫೈಲ್ ಹಂಚಿಕೆ',
      description: 'ಪರಿಶೀಲಿಸಿದ ಉದ್ಯೋಗದಾತರೊಂದಿಗೆ ನನ್ನ ಅನುಭವ ಮತ್ತು ವಿವರಗಳನ್ನು ಹಂಚಿಕೊಳ್ಳಲು ಒಪ್ಪುತ್ತೇನೆ.',
    },
    hi: {
      title: 'प्रोफ़ाइल साझा करना',
      description: 'मैं नियोक्ताओं के साथ अपने कार्य अनुभव और विवरण साझा करने की सहमति देता/देती हूँ।',
    },
  },
  call_recording: {
    en: {
      title: 'Call Recording',
      description: 'I consent to calls with Laboura staff and prospective employers being recorded for quality and verification.',
    },
    kn: {
      title: 'ಕರೆ ರೆಕಾರ್ಡಿಂಗ್',
      description: 'ಗುಣಮಟ್ಟ ಮತ್ತು ತರಬೇತಿಗಾಗಿ ಲ್ಯಾಬೂರಾ ಸಿಬ್ಬಂದಿಯೊಂದಿಗಿನ ಕರೆಗಳನ್ನು ರೆಕಾರ್ಡ್ ಮಾಡಲು ಒಪ್ಪುತ್ತೇನೆ.',
    },
    hi: {
      title: 'कॉल रिकॉर्डिंग',
      description: 'गुणवत्ता और सत्यापन के लिए लेबूरा कर्मचारियों के साथ कॉल रिकॉर्ड करने की सहमति देता/देती हूँ।',
    },
  },
  aadhaar_verification: {
    // Guide, "Aadhaar verification" (14 Nov): says exactly what is read, what is kept and what is never kept.
    en: {
      title: 'ID check (Aadhaar or another ID)',
      description:
        "I consent to Laboura checking my ID to confirm who I am and that I am 18 or older. Aadhaar: the Secure QR code on my Aadhaar is read on my own phone (or from my e-Aadhaar PDF, which stays on my phone) and only the QR's data is sent; Laboura checks UIDAI's digital signature. Laboura keeps only: verified or not, the method, the date and time, the last 4 digits of my Aadhaar number and the QR's time stamp, my name, date of birth, gender, area and pincode, whether the name matches, whether my phone is linked to that Aadhaar, whether I am 18 or older, and this consent. The photo from the QR is kept only until a Team Lead compares it with my selfie (30 days at most). Laboura never keeps my full Aadhaar number, any picture of my card, my e-Aadhaar PDF or XML, or my full address. I can use PAN, a driving licence or a voter ID instead.",
    },
    kn: {
      title: 'ಗುರುತು ಪರಿಶೀಲನೆ (ಆಧಾರ್ ಅಥವಾ ಬೇರೆ ಗುರುತಿನ ಚೀಟಿ)',
      description:
        'ನಾನು ಯಾರು ಮತ್ತು ನನಗೆ 18 ವರ್ಷ ಅಥವಾ ಹೆಚ್ಚು ವಯಸ್ಸಾಗಿದೆ ಎಂದು ದೃಢೀಕರಿಸಲು ಲ್ಯಾಬೂರಾ ನನ್ನ ಗುರುತನ್ನು ಪರಿಶೀಲಿಸಲು ನಾನು ಒಪ್ಪುತ್ತೇನೆ. ಆಧಾರ್: ನನ್ನ ಆಧಾರ್‌ನಲ್ಲಿರುವ ಸುರಕ್ಷಿತ QR ಕೋಡ್ ಅನ್ನು ನನ್ನ ಫೋನ್‌ನಲ್ಲೇ ಓದಲಾಗುತ್ತದೆ (ಅಥವಾ ನನ್ನ ಇ-ಆಧಾರ್ PDF ನಿಂದ — ಅದು ನನ್ನ ಫೋನ್‌ನಲ್ಲೇ ಉಳಿಯುತ್ತದೆ) ಮತ್ತು QR ನ ಮಾಹಿತಿ ಮಾತ್ರ ಕಳುಹಿಸಲಾಗುತ್ತದೆ; ಲ್ಯಾಬೂರಾ UIDAI ಡಿಜಿಟಲ್ ಸಹಿಯನ್ನು ಪರಿಶೀಲಿಸುತ್ತದೆ. ಲ್ಯಾಬೂರಾ ಉಳಿಸುವುದು ಇಷ್ಟೇ: ಪರಿಶೀಲನೆ ಆಯಿತೇ ಇಲ್ಲವೇ, ವಿಧಾನ, ದಿನಾಂಕ ಮತ್ತು ಸಮಯ, ನನ್ನ ಆಧಾರ್ ಸಂಖ್ಯೆಯ ಕೊನೆಯ 4 ಅಂಕೆಗಳು ಮತ್ತು QR ನ ಸಮಯ ಮುದ್ರೆ, ನನ್ನ ಹೆಸರು, ಹುಟ್ಟಿದ ದಿನಾಂಕ, ಲಿಂಗ, ಪ್ರದೇಶ ಮತ್ತು ಪಿನ್‌ಕೋಡ್, ಹೆಸರು ಹೊಂದುತ್ತದೆಯೇ, ನನ್ನ ಫೋನ್ ಆ ಆಧಾರ್‌ಗೆ ಜೋಡಣೆಯಾಗಿದೆಯೇ, ನನಗೆ 18 ವರ್ಷ ತುಂಬಿದೆಯೇ, ಮತ್ತು ಈ ಒಪ್ಪಿಗೆ. QR ನಲ್ಲಿರುವ ಫೋಟೋವನ್ನು ಟೀಮ್ ಲೀಡ್ ನನ್ನ ಸೆಲ್ಫಿಯೊಂದಿಗೆ ಹೋಲಿಸುವವರೆಗೆ ಮಾತ್ರ (ಗರಿಷ್ಠ 30 ದಿನ) ಇಡಲಾಗುತ್ತದೆ. ನನ್ನ ಪೂರ್ಣ ಆಧಾರ್ ಸಂಖ್ಯೆ, ನನ್ನ ಕಾರ್ಡ್‌ನ ಯಾವುದೇ ಚಿತ್ರ, ಇ-ಆಧಾರ್ PDF ಅಥವಾ XML, ಅಥವಾ ನನ್ನ ಪೂರ್ಣ ವಿಳಾಸವನ್ನು ಲ್ಯಾಬೂರಾ ಎಂದಿಗೂ ಉಳಿಸುವುದಿಲ್ಲ. ಬದಲಿಗೆ PAN, ಡ್ರೈವಿಂಗ್ ಲೈಸೆನ್ಸ್ ಅಥವಾ ವೋಟರ್ ID ಬಳಸಬಹುದು.',
    },
    hi: {
      title: 'पहचान जाँच (आधार या कोई और आईडी)',
      description:
        'मैं लेबूरा को मेरी पहचान और मेरी उम्र 18 साल या उससे ज़्यादा होने की पुष्टि के लिए मेरी आईडी जाँचने की सहमति देता/देती हूँ। आधार: मेरे आधार पर छपा सिक्योर QR कोड मेरे अपने फ़ोन पर ही पढ़ा जाता है (या मेरी ई-आधार PDF से, जो मेरे फ़ोन पर ही रहती है) और सिर्फ़ QR का डेटा भेजा जाता है; लेबूरा UIDAI का डिजिटल हस्ताक्षर जाँचता है। लेबूरा सिर्फ़ यह रखता है: जाँच हुई या नहीं, तरीका, तारीख़ और समय, मेरे आधार नंबर के आख़िरी 4 अंक और QR का समय, मेरा नाम, जन्मतिथि, लिंग, इलाक़ा और पिनकोड, नाम मिलता है या नहीं, मेरा फ़ोन उस आधार से जुड़ा है या नहीं, मेरी उम्र 18 साल या ज़्यादा है या नहीं, और यह सहमति। QR की फ़ोटो सिर्फ़ तब तक रखी जाती है जब तक टीम लीड उसे मेरी सेल्फ़ी से न मिला ले (ज़्यादा से ज़्यादा 30 दिन)। लेबूरा मेरा पूरा आधार नंबर, मेरे कार्ड की कोई भी तस्वीर, मेरी ई-आधार PDF या XML, या मेरा पूरा पता कभी नहीं रखता। मैं इसकी जगह PAN, ड्राइविंग लाइसेंस या वोटर ID भी दे सकता/सकती हूँ।',
    },
  },
  job_updates: {
    en: {
      title: 'Job Updates & Alerts',
      description: 'I consent to receiving job alerts, interview schedules, and application updates via SMS, WhatsApp, and phone.',
    },
    kn: {
      title: 'ಉದ್ಯೋಗ ಅಪ್‌ಡೇಟ್‌ಗಳು',
      description: 'ಎಸ್‌ಎಂಎಸ್ ಮತ್ತು ವಾಟ್ಸಾಪ್ ಮೂಲಕ ಸಂದರ್ಶನ ಮತ್ತು ಉದ್ಯೋಗ ಅಪ್‌ಡೇಟ್‌ಗಳನ್ನು ಸ್ವೀಕರಿಸಲು ಒಪ್ಪುತ್ತೇನೆ.',
    },
    hi: {
      title: 'नौकरी अपडेट',
      description: 'एसएमएस और व्हाट्सएप के माध्यम से साक्षात्कार और नौकरी अपडेट प्राप्त करने की सहमति देता/देती हूँ।',
    },
  },
  promotions: {
    en: {
      title: 'Promotions (Optional)',
      description: 'I consent to receiving promotional offers and additional partner services from Laboura.',
    },
    kn: {
      title: 'ಪ್ರಚಾರಗಳು (ಐಚ್ಛಿಕ)',
      description: 'ಲ್ಯಾಬೂರಾದಿಂದ ಪ್ರಚಾರ ಕೊಡುಗೆಗಳನ್ನು ಸ್ವೀಕರಿಸಲು ನಾನು ಒಪ್ಪುತ್ತೇನೆ (ಐಚ್ಛಿಕ).',
    },
    hi: {
      title: 'प्रचार (वैकल्पिक)',
      description: 'लेबूरा से प्रचार ऑफ़र प्राप्त करने की सहमति देता/देती हूँ (वैकल्पिक)।',
    },
  },
};
