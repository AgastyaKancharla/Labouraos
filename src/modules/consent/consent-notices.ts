/**
 * The job seeker's six itemised consent ticks — notice version 1.2, taken word
 * for word from Job Seeker Terms v1.1, Part B (Master Guide rev 176, 15 Nov).
 * `withdrawal` is the document's "If you withdraw it later" column.
 *
 * The English is the owner-approved text. The Kannada and Hindi are MACHINE
 * DRAFTS for the test setup and must be reviewed by a native speaker (and the
 * lawyer) before launch. Consents given under 1.0 / 1.1 stay valid until the
 * person accepts 1.2 (re-consent, legal-document.service.ts).
 */
export type ConsentNotice = { title: string; description: string; withdrawal: string };

export const CONSENT_NOTICES: Record<string, Record<'en' | 'kn' | 'hi', ConsentNotice>> = {
  job_matching: {
    en: {
      title: '1. Job matching',
      description: 'I consent to Laboura matching my profile with potential employers and vacancies.',
      withdrawal: 'Laboura stops matching you. After paying, this ends your refund.',
    },
    kn: {
      title: '1. ಉದ್ಯೋಗ ಹೊಂದಾಣಿಕೆ',
      description: 'ನನ್ನ ಪ್ರೊಫೈಲ್ ಅನ್ನು ಸಂಭಾವ್ಯ ಉದ್ಯೋಗದಾತರು ಮತ್ತು ಖಾಲಿ ಹುದ್ದೆಗಳೊಂದಿಗೆ ಹೊಂದಿಸಲು Laboura ಗೆ ಒಪ್ಪಿಗೆ ನೀಡುತ್ತೇನೆ.',
      withdrawal: 'Laboura ನಿಮ್ಮನ್ನು ಹೊಂದಿಸುವುದನ್ನು ನಿಲ್ಲಿಸುತ್ತದೆ. ಪಾವತಿಯ ನಂತರ, ಇದರಿಂದ ನಿಮ್ಮ ಮರುಪಾವತಿ ಮುಗಿಯುತ್ತದೆ.',
    },
    hi: {
      title: '1. नौकरी मिलान',
      description: 'मैं Laboura को मेरी प्रोफ़ाइल संभावित नियोक्ताओं और खाली पदों से मिलाने की सहमति देता/देती हूँ।',
      withdrawal: 'Laboura आपको मैच करना बंद कर देता है। भुगतान के बाद, इससे आपका रिफ़ंड ख़त्म हो जाता है।',
    },
  },
  profile_sharing: {
    en: {
      title: '2. Profile sharing',
      description:
        'I consent to Laboura sharing my work experience and verified details with prospective employers: my first name, selfie, age, experience, languages, distance, expected salary and verified status, never my phone number.',
      withdrawal: 'Businesses stop seeing your card. After paying, this ends your refund.',
    },
    kn: {
      title: '2. ಪ್ರೊಫೈಲ್ ಹಂಚಿಕೆ',
      description:
        'ನನ್ನ ಕೆಲಸದ ಅನುಭವ ಮತ್ತು ಪರಿಶೀಲಿತ ವಿವರಗಳನ್ನು ಸಂಭಾವ್ಯ ಉದ್ಯೋಗದಾತರೊಂದಿಗೆ ಹಂಚಿಕೊಳ್ಳಲು Laboura ಗೆ ಒಪ್ಪಿಗೆ ನೀಡುತ್ತೇನೆ: ನನ್ನ ಮೊದಲ ಹೆಸರು, ಸೆಲ್ಫಿ, ವಯಸ್ಸು, ಅನುಭವ, ಭಾಷೆಗಳು, ದೂರ, ನಿರೀಕ್ಷಿತ ಸಂಬಳ ಮತ್ತು ಪರಿಶೀಲಿತ ಸ್ಥಿತಿ, ನನ್ನ ಫೋನ್ ನಂಬರ್ ಎಂದೂ ಅಲ್ಲ.',
      withdrawal: 'ವ್ಯಾಪಾರಗಳು ನಿಮ್ಮ ಕಾರ್ಡ್ ನೋಡುವುದು ನಿಲ್ಲುತ್ತದೆ. ಪಾವತಿಯ ನಂತರ, ಇದರಿಂದ ನಿಮ್ಮ ಮರುಪಾವತಿ ಮುಗಿಯುತ್ತದೆ.',
    },
    hi: {
      title: '2. प्रोफ़ाइल साझा करना',
      description:
        'मैं Laboura को मेरा काम का अनुभव और सत्यापित जानकारी संभावित नियोक्ताओं से साझा करने की सहमति देता/देती हूँ: मेरा पहला नाम, सेल्फ़ी, उम्र, अनुभव, भाषाएँ, दूरी, अपेक्षित सैलरी और सत्यापित स्थिति, मेरा फ़ोन नंबर कभी नहीं।',
      withdrawal: 'बिज़नेस आपका कार्ड देखना बंद कर देते हैं। भुगतान के बाद, इससे आपका रिफ़ंड ख़त्म हो जाता है।',
    },
  },
  call_recording: {
    en: {
      title: '3. Call recording',
      description:
        'I consent to calls with Laboura staff and prospective employers being recorded for quality and verification. Every call starts with an announcement.',
      withdrawal: 'Laboura cannot call you through its system. After paying, this ends your refund.',
    },
    kn: {
      title: '3. ಕರೆ ರೆಕಾರ್ಡಿಂಗ್',
      description: 'Laboura ಸಿಬ್ಬಂದಿ ಮತ್ತು ಸಂಭಾವ್ಯ ಉದ್ಯೋಗದಾತರೊಂದಿಗಿನ ಕರೆಗಳನ್ನು ಗುಣಮಟ್ಟ ಮತ್ತು ಪರಿಶೀಲನೆಗಾಗಿ ರೆಕಾರ್ಡ್ ಮಾಡಲು ಒಪ್ಪುತ್ತೇನೆ. ಪ್ರತಿ ಕರೆ ಒಂದು ಘೋಷಣೆಯೊಂದಿಗೆ ಆರಂಭವಾಗುತ್ತದೆ.',
      withdrawal: 'Laboura ತನ್ನ ವ್ಯವಸ್ಥೆಯ ಮೂಲಕ ನಿಮಗೆ ಕರೆ ಮಾಡಲು ಸಾಧ್ಯವಿಲ್ಲ. ಪಾವತಿಯ ನಂತರ, ಇದರಿಂದ ನಿಮ್ಮ ಮರುಪಾವತಿ ಮುಗಿಯುತ್ತದೆ.',
    },
    hi: {
      title: '3. कॉल रिकॉर्डिंग',
      description: 'मैं Laboura कर्मचारियों और संभावित नियोक्ताओं के साथ कॉल गुणवत्ता और सत्यापन के लिए रिकॉर्ड होने की सहमति देता/देती हूँ। हर कॉल एक घोषणा से शुरू होती है।',
      withdrawal: 'Laboura अपने सिस्टम से आपको कॉल नहीं कर सकता। भुगतान के बाद, इससे आपका रिफ़ंड ख़त्म हो जाता है।',
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
    kn: {
      title: '4. ಗುರುತು ಪರಿಶೀಲನೆ (ಆಧಾರ್ ಅಥವಾ ಬೇರೆ ಗುರುತಿನ ಚೀಟಿ)',
      description:
        'ನಾನು ಯಾರು ಮತ್ತು ನನಗೆ 18 ವರ್ಷ ಅಥವಾ ಹೆಚ್ಚು ಎಂದು ದೃಢೀಕರಿಸಲು Laboura ನನ್ನ ಗುರುತನ್ನು ಪರಿಶೀಲಿಸಲು ಒಪ್ಪುತ್ತೇನೆ. ಆಧಾರ್: ನನ್ನ ಆಧಾರ್‌ನ ಸುರಕ್ಷಿತ QR ಕೋಡ್ ಅನ್ನು ನನ್ನ ಫೋನ್‌ನಲ್ಲೇ ಓದಲಾಗುತ್ತದೆ (ಅಥವಾ ನನ್ನ ಫೋನ್‌ನಲ್ಲೇ ಉಳಿಯುವ ಇ-ಆಧಾರ್ PDF ನಿಂದ) ಮತ್ತು QR ನ ಮಾಹಿತಿ ಮಾತ್ರ ಕಳುಹಿಸಲಾಗುತ್ತದೆ; Laboura UIDAI ಡಿಜಿಟಲ್ ಸಹಿ ಪರಿಶೀಲಿಸುತ್ತದೆ. Laboura ಉಳಿಸುವುದು ಇಷ್ಟೇ: ಪರಿಶೀಲನೆ ಆಯಿತೇ ಇಲ್ಲವೇ, ವಿಧಾನ, ದಿನಾಂಕ ಮತ್ತು ಸಮಯ, ನನ್ನ ಆಧಾರ್ ಸಂಖ್ಯೆಯ ಕೊನೆಯ 4 ಅಂಕೆಗಳು ಮತ್ತು QR ನ ಸಮಯ ಮುದ್ರೆ, ನನ್ನ ಹೆಸರು, ಹುಟ್ಟಿದ ದಿನಾಂಕ, ಲಿಂಗ, ಪ್ರದೇಶ ಮತ್ತು ಪಿನ್‌ಕೋಡ್, ಹೆಸರು ಹೊಂದುತ್ತದೆಯೇ, ನನ್ನ ಫೋನ್ ಆ ಆಧಾರ್‌ಗೆ ಜೋಡಣೆಯಾಗಿದೆಯೇ, ನನಗೆ 18 ವರ್ಷ ತುಂಬಿದೆಯೇ, ಮತ್ತು ಈ ಒಪ್ಪಿಗೆ. QR ನ ಫೋಟೋವನ್ನು ಟೀಮ್ ಲೀಡ್ ನನ್ನ ಸೆಲ್ಫಿಯೊಂದಿಗೆ ಹೋಲಿಸುವವರೆಗೆ ಮಾತ್ರ (ಗರಿಷ್ಠ 30 ದಿನ) ಇಡಲಾಗುತ್ತದೆ. ನನ್ನ ಪೂರ್ಣ ಆಧಾರ್ ಸಂಖ್ಯೆ, ನನ್ನ ಕಾರ್ಡ್‌ನ ಯಾವುದೇ ಚಿತ್ರ, ಇ-ಆಧಾರ್ PDF ಅಥವಾ XML, ಅಥವಾ ನನ್ನ ಪೂರ್ಣ ವಿಳಾಸವನ್ನು Laboura ಎಂದೂ ಉಳಿಸುವುದಿಲ್ಲ. ಬೇರೆ ಗುರುತಿನ ಚೀಟಿ: ಬದಲಿಗೆ PAN, ಡ್ರೈವಿಂಗ್ ಲೈಸೆನ್ಸ್ ಅಥವಾ ವೋಟರ್ ID ಬಳಸಬಹುದು. ಕಾರ್ಡ್‌ನ ಲೈವ್ ಫೋಟೋವನ್ನು ಟೀಮ್ ಲೀಡ್ ಪರಿಶೀಲಿಸಿ ಪರಿಶೀಲನೆಯ ನಂತರ (ಗರಿಷ್ಠ 30 ದಿನ) ಅಳಿಸಲಾಗುತ್ತದೆ; ID ಬಗೆ ಮತ್ತು ಅದರ ಸಂಖ್ಯೆಯ ಕೊನೆಯ 4 ಅಕ್ಷರಗಳನ್ನು ಮಾತ್ರ ಇಡಲಾಗುತ್ತದೆ.',
      withdrawal: 'ಈಗಾಗಲೇ ಆದ ಪರಿಶೀಲನೆ ಫಲಿತಾಂಶವಾಗಿ ಮಾತ್ರ ದಾಖಲಾಗಿರುತ್ತದೆ. ಪರಿಶೀಲಿತ ಗುರುತಿಲ್ಲದೆ ನಿಮ್ಮನ್ನು ಹೊಂದಿಸಲು ಸಾಧ್ಯವಿಲ್ಲ.',
    },
    hi: {
      title: '4. ID जाँच (आधार या कोई और ID)',
      description:
        'मैं Laboura को मेरी पहचान और मेरी उम्र 18 या ज़्यादा होने की पुष्टि के लिए मेरी ID जाँचने की सहमति देता/देती हूँ। आधार: मेरे आधार का सिक्योर QR कोड मेरे अपने फ़ोन पर पढ़ा जाता है (या मेरी ई-आधार PDF से, जो मेरे फ़ोन पर ही रहती है) और सिर्फ़ QR का डेटा भेजा जाता है; Laboura UIDAI का डिजिटल हस्ताक्षर जाँचता है। Laboura सिर्फ़ यह रखता है: जाँच हुई या नहीं, तरीका, तारीख़ और समय, मेरे आधार नंबर के आख़िरी 4 अंक और QR का समय, मेरा नाम, जन्मतिथि, लिंग, इलाक़ा और पिनकोड, नाम मिलता है या नहीं, मेरा फ़ोन उस आधार से जुड़ा है या नहीं, मेरी उम्र 18 या ज़्यादा है या नहीं, और यह सहमति। QR की फ़ोटो सिर्फ़ तब तक रखी जाती है जब तक टीम लीड उसे मेरी सेल्फ़ी से न मिला ले (ज़्यादा से ज़्यादा 30 दिन)। Laboura मेरा पूरा आधार नंबर, मेरे कार्ड की कोई तस्वीर, मेरी ई-आधार PDF या XML, या मेरा पूरा पता कभी नहीं रखता। कोई और ID: मैं इसकी जगह PAN, ड्राइविंग लाइसेंस या वोटर ID इस्तेमाल कर सकता/सकती हूँ। कार्ड की लाइव फ़ोटो टीम लीड जाँचता है और जाँच के बाद (ज़्यादा से ज़्यादा 30 दिन में) डिलीट कर दी जाती है; सिर्फ़ ID का प्रकार और उसके नंबर के आख़िरी 4 अक्षर रखे जाते हैं।',
      withdrawal: 'पहले हो चुकी जाँच सिर्फ़ नतीजे के रूप में दर्ज रहती है। सत्यापित ID के बिना आपको मैच नहीं किया जा सकता।',
    },
  },
  job_updates: {
    en: {
      title: '5. Job updates',
      description: 'I consent to receiving job alerts, interview schedules and application updates by SMS, WhatsApp and phone.',
      withdrawal: 'Job alerts stop. Your refund is not affected. Messages you need for an offer or interview you are already part of still reach you.',
    },
    kn: {
      title: '5. ಉದ್ಯೋಗ ಅಪ್‌ಡೇಟ್‌ಗಳು',
      description: 'ಉದ್ಯೋಗ ಸೂಚನೆಗಳು, ಸಂದರ್ಶನ ವೇಳಾಪಟ್ಟಿ ಮತ್ತು ಅರ್ಜಿ ಅಪ್‌ಡೇಟ್‌ಗಳನ್ನು SMS, WhatsApp ಮತ್ತು ಫೋನ್ ಮೂಲಕ ಪಡೆಯಲು ಒಪ್ಪುತ್ತೇನೆ.',
      withdrawal: 'ಉದ್ಯೋಗ ಸೂಚನೆಗಳು ನಿಲ್ಲುತ್ತವೆ. ನಿಮ್ಮ ಮರುಪಾವತಿಗೆ ಪರಿಣಾಮವಿಲ್ಲ. ನೀವು ಈಗಾಗಲೇ ಭಾಗವಾಗಿರುವ ಆಫರ್ ಅಥವಾ ಸಂದರ್ಶನಕ್ಕೆ ಬೇಕಾದ ಸಂದೇಶಗಳು ಬರುತ್ತಲೇ ಇರುತ್ತವೆ.',
    },
    hi: {
      title: '5. नौकरी अपडेट',
      description: 'मैं नौकरी अलर्ट, इंटरव्यू का समय और आवेदन अपडेट SMS, WhatsApp और फ़ोन से पाने की सहमति देता/देती हूँ।',
      withdrawal: 'नौकरी अलर्ट रुक जाते हैं। आपके रिफ़ंड पर असर नहीं। जिस ऑफ़र या इंटरव्यू में आप पहले से हैं, उसके ज़रूरी संदेश आते रहते हैं।',
    },
  },
  promotions: {
    en: {
      title: '6. Promotions (optional)',
      description: 'I consent to receiving promotional offers and news from Laboura.',
      withdrawal: 'Promotions stop. Nothing else changes.',
    },
    kn: {
      title: '6. ಪ್ರಚಾರಗಳು (ಐಚ್ಛಿಕ)',
      description: 'Laboura ದಿಂದ ಪ್ರಚಾರ ಕೊಡುಗೆಗಳು ಮತ್ತು ಸುದ್ದಿ ಪಡೆಯಲು ಒಪ್ಪುತ್ತೇನೆ.',
      withdrawal: 'ಪ್ರಚಾರಗಳು ನಿಲ್ಲುತ್ತವೆ. ಬೇರೇನೂ ಬದಲಾಗುವುದಿಲ್ಲ.',
    },
    hi: {
      title: '6. प्रचार (वैकल्पिक)',
      description: 'मैं Laboura से प्रचार ऑफ़र और ख़बरें पाने की सहमति देता/देती हूँ।',
      withdrawal: 'प्रचार रुक जाते हैं। और कुछ नहीं बदलता।',
    },
  },
};
