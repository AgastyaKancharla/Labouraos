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
    en: {
      title: 'Aadhaar Verification',
      description: 'I consent to identity verification via DigiLocker / Aadhaar fallbacks to confirm age and identity.',
    },
    kn: {
      title: 'ಆಧಾರ್ ಪರಿಶೀಲನೆ',
      description: 'ವಯಸ್ಸು ಮತ್ತು ಗುರುತನ್ನು ದೃಢೀಕರಿಸಲು ಡಿಜಿಲಾಕರ್ ಮೂಲಕ ಆಧಾರ್ ಪರಿಶೀಲನೆಗೆ ಒಪ್ಪಿಗೆ ನೀಡುತ್ತೇನೆ.',
    },
    hi: {
      title: 'आधार सत्यापन',
      description: 'उम्र और पहचान की पुष्टि के लिए डिजीलॉकर/आधार सत्यापन की सहमति देता/देती हूँ।',
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
