/* Legal documents v1.1 (Master Guide rev 176): the words around the legal
   texts — "In short", "Read the full terms", the re-consent screen, the footer.
   The legal texts themselves come from the server (GET /legal/documents/:key).
   Kannada and Hindi are machine drafts and need a native speaker's review. */

export const legalEn = {
  'screen.P-Reconsent': 'Updated terms',
  'screen.P-PartnerReconsent': 'Updated terms',
  'legal.inShort': 'In short',
  'legal.readFull': 'Read the full terms',
  'legal.version': 'Version {version}',
  'legal.loading': 'Loading the terms…',
  'legal.footer.grievance': 'Grievance Officer: {contact}',
  'legal.footer.company': '{name} · CIN {cin}',
  'legal.updated.title': 'We’ve updated our terms',
  'legal.updated.intro': 'You accepted version {old}. Please read version {version} and accept it to carry on. A guarantee you already paid for keeps the terms you paid under.',
  'legal.updated.introNew': 'Please read version {version} of our terms and accept it to carry on.',
  'legal.updated.ticks': 'Tick each permission',
  'legal.updated.needAll': 'Tick every required box to accept.',
  'legal.updated.accept': 'Accept the updated terms',
  'legal.updated.done': 'Thank you — you accepted version {version}.',
  'legal.agree.authority': 'I have authority to agree on the business’s behalf (as owner, manager, HR or an authorised person)',
  'legal.partner.idCheck': 'I consent to Laboura checking my ID (Aadhaar Secure QR or another ID) and taking a live selfie, keeping only what clause 9.2 lists',
  'legal.fee.joining': 'Joining date',
  'legal.fee.fullName': 'Candidate',
  'legal.fee.phoneHidden': 'Their phone number stays hidden until the joining day; calls go through Laboura’s number.',
};

export type LegalKey = keyof typeof legalEn;

export const legalKn: Record<LegalKey, string> = {
  'screen.P-Reconsent': 'ನವೀಕರಿಸಿದ ನಿಯಮಗಳು',
  'screen.P-PartnerReconsent': 'ನವೀಕರಿಸಿದ ನಿಯಮಗಳು',
  'legal.inShort': 'ಸಂಕ್ಷಿಪ್ತವಾಗಿ',
  'legal.readFull': 'ಪೂರ್ಣ ನಿಯಮಗಳನ್ನು ಓದಿ',
  'legal.version': 'ಆವೃತ್ತಿ {version}',
  'legal.loading': 'ನಿಯಮಗಳು ಲೋಡ್ ಆಗುತ್ತಿವೆ…',
  'legal.footer.grievance': 'ಕುಂದುಕೊರತೆ ಅಧಿಕಾರಿ: {contact}',
  'legal.footer.company': '{name} · CIN {cin}',
  'legal.updated.title': 'ನಾವು ನಮ್ಮ ನಿಯಮಗಳನ್ನು ನವೀಕರಿಸಿದ್ದೇವೆ',
  'legal.updated.intro': 'ನೀವು ಆವೃತ್ತಿ {old} ಒಪ್ಪಿದ್ದೀರಿ. ಮುಂದುವರಿಯಲು ದಯವಿಟ್ಟು ಆವೃತ್ತಿ {version} ಓದಿ ಒಪ್ಪಿ. ನೀವು ಈಗಾಗಲೇ ಪಾವತಿಸಿದ ಗ್ಯಾರಂಟಿ, ಪಾವತಿಸಿದಾಗಿನ ನಿಯಮಗಳಲ್ಲೇ ಇರುತ್ತದೆ.',
  'legal.updated.introNew': 'ಮುಂದುವರಿಯಲು ದಯವಿಟ್ಟು ನಮ್ಮ ನಿಯಮಗಳ ಆವೃತ್ತಿ {version} ಓದಿ ಒಪ್ಪಿ.',
  'legal.updated.ticks': 'ಪ್ರತಿ ಅನುಮತಿಯನ್ನು ಟಿಕ್ ಮಾಡಿ',
  'legal.updated.needAll': 'ಒಪ್ಪಲು ಎಲ್ಲಾ ಕಡ್ಡಾಯ ಬಾಕ್ಸ್‌ಗಳನ್ನು ಟಿಕ್ ಮಾಡಿ.',
  'legal.updated.accept': 'ನವೀಕರಿಸಿದ ನಿಯಮಗಳನ್ನು ಒಪ್ಪಿ',
  'legal.updated.done': 'ಧನ್ಯವಾದ — ನೀವು ಆವೃತ್ತಿ {version} ಒಪ್ಪಿದ್ದೀರಿ.',
  'legal.agree.authority': 'ವ್ಯಾಪಾರದ ಪರವಾಗಿ ಒಪ್ಪಲು (ಮಾಲೀಕ, ಮ್ಯಾನೇಜರ್, HR ಅಥವಾ ಅಧಿಕೃತ ವ್ಯಕ್ತಿಯಾಗಿ) ನನಗೆ ಅಧಿಕಾರವಿದೆ',
  'legal.partner.idCheck': 'ಷರತ್ತು 9.2 ರಲ್ಲಿ ಹೇಳಿದ್ದನ್ನು ಮಾತ್ರ ಇಟ್ಟುಕೊಂಡು, Laboura ನನ್ನ ಗುರುತು (ಆಧಾರ್ ಸುರಕ್ಷಿತ QR ಅಥವಾ ಬೇರೆ ಗುರುತಿನ ಚೀಟಿ) ಪರಿಶೀಲಿಸಲು ಮತ್ತು ಲೈವ್ ಸೆಲ್ಫಿ ತೆಗೆಯಲು ಒಪ್ಪುತ್ತೇನೆ',
  'legal.fee.joining': 'ಸೇರುವ ದಿನಾಂಕ',
  'legal.fee.fullName': 'ಅಭ್ಯರ್ಥಿ',
  'legal.fee.phoneHidden': 'ಸೇರುವ ದಿನದವರೆಗೆ ಅವರ ಫೋನ್ ನಂಬರ್ ಮರೆಯಾಗಿರುತ್ತದೆ; ಕರೆಗಳು Laboura ನಂಬರ್ ಮೂಲಕ ಹೋಗುತ್ತವೆ.',
};

export const legalHi: Record<LegalKey, string> = {
  'screen.P-Reconsent': 'अपडेट की गई शर्तें',
  'screen.P-PartnerReconsent': 'अपडेट की गई शर्तें',
  'legal.inShort': 'संक्षेप में',
  'legal.readFull': 'पूरी शर्तें पढ़ें',
  'legal.version': 'संस्करण {version}',
  'legal.loading': 'शर्तें लोड हो रही हैं…',
  'legal.footer.grievance': 'शिकायत अधिकारी: {contact}',
  'legal.footer.company': '{name} · CIN {cin}',
  'legal.updated.title': 'हमने अपनी शर्तें अपडेट की हैं',
  'legal.updated.intro': 'आपने संस्करण {old} स्वीकार किया था। आगे बढ़ने के लिए कृपया संस्करण {version} पढ़कर स्वीकार करें। जिस गारंटी का भुगतान आप कर चुके हैं, वह उन्हीं शर्तों पर चलती है जिन पर भुगतान हुआ था।',
  'legal.updated.introNew': 'आगे बढ़ने के लिए कृपया हमारी शर्तों का संस्करण {version} पढ़कर स्वीकार करें।',
  'legal.updated.ticks': 'हर अनुमति टिक करें',
  'legal.updated.needAll': 'स्वीकार करने के लिए हर ज़रूरी बॉक्स टिक करें।',
  'legal.updated.accept': 'अपडेट की गई शर्तें स्वीकार करें',
  'legal.updated.done': 'धन्यवाद — आपने संस्करण {version} स्वीकार किया।',
  'legal.agree.authority': 'बिज़नेस की ओर से सहमति देने का (मालिक, मैनेजर, HR या अधिकृत व्यक्ति के रूप में) मुझे अधिकार है',
  'legal.partner.idCheck': 'धारा 9.2 में बताई बातें ही रखते हुए, Laboura को मेरी ID (आधार सिक्योर QR या कोई और ID) जाँचने और लाइव सेल्फ़ी लेने की मैं सहमति देता/देती हूँ',
  'legal.fee.joining': 'जॉइनिंग की तारीख़',
  'legal.fee.fullName': 'उम्मीदवार',
  'legal.fee.phoneHidden': 'जॉइनिंग के दिन तक उनका फ़ोन नंबर छिपा रहता है; कॉल Laboura के नंबर से होती हैं।',
};
