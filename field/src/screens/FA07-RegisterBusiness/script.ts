/**
 * "Explain Laboura — read this to them", shown in all three languages
 * whatever the app language (the owner's language, not the agent's). Same
 * wording as the call agent's CA13 form (web/src/screens/call-agent/
 * _registration/scripts.ts); Kannada and Hindi need a native speaker's check.
 */
export type ScriptLanguage = 'kn' | 'hi' | 'en';

export const SCRIPT_LANGUAGE_LABELS: Record<ScriptLanguage, string> = { kn: 'ಕನ್ನಡ', hi: 'हिंदी', en: 'English' };

export const BUSINESS_SCRIPT: Record<ScriptLanguage, string> = {
  en:
    '“This call is recorded. Laboura sends you verified candidates. You pay only when you select someone: 50% of their first month’s salary plus 18% GST. If they leave within 60 days, we replace them free, up to 2 times. If you hire someone we introduced without going through Laboura within 12 months, the full fee plus 50% applies.\n\nYou’ll get a link to read the agreement and agree to it by OTP. A field agent will visit to verify your business before we show you candidates.”',
  kn:
    '“ಈ ಕರೆ ರೆಕಾರ್ಡ್ ಆಗುತ್ತಿದೆ. Laboura ನಿಮಗೆ ಪರಿಶೀಲಿಸಿದ ಅಭ್ಯರ್ಥಿಗಳನ್ನು ಕಳುಹಿಸುತ್ತದೆ. ನೀವು ಯಾರನ್ನಾದರೂ ಆಯ್ಕೆ ಮಾಡಿದಾಗ ಮಾತ್ರ ಪಾವತಿಸುತ್ತೀರಿ: ಅವರ ಮೊದಲ ತಿಂಗಳ ಸಂಬಳದ 50% ಜೊತೆಗೆ 18% GST. 60 ದಿನಗಳಲ್ಲಿ ಅವರು ಬಿಟ್ಟರೆ, 2 ಬಾರಿಯವರೆಗೆ ಉಚಿತವಾಗಿ ಬದಲಿ ಕೊಡುತ್ತೇವೆ. ನಾವು ಪರಿಚಯಿಸಿದವರನ್ನು 12 ತಿಂಗಳೊಳಗೆ Laboura ಮೂಲಕವಲ್ಲದೆ ನೇಮಿಸಿಕೊಂಡರೆ ಪೂರ್ಣ ಶುಲ್ಕ ಜೊತೆಗೆ 50% ಅನ್ವಯಿಸುತ್ತದೆ.\n\nಒಪ್ಪಂದವನ್ನು ಓದಿ OTP ಮೂಲಕ ಒಪ್ಪಲು ನಿಮಗೆ ಲಿಂಕ್ ಬರುತ್ತದೆ. ಅಭ್ಯರ್ಥಿಗಳನ್ನು ತೋರಿಸುವ ಮೊದಲು ಫೀಲ್ಡ್ ಏಜೆಂಟ್ ಬಂದು ನಿಮ್ಮ ವ್ಯಾಪಾರವನ್ನು ಪರಿಶೀಲಿಸುತ್ತಾರೆ.”',
  hi:
    '“यह कॉल रिकॉर्ड हो रही है। Laboura आपको जाँचे हुए उम्मीदवार भेजता है। आप तभी भुगतान करते हैं जब किसी को चुनते हैं: उसकी पहले महीने की सैलरी का 50% और 18% GST। अगर वह 60 दिन में छोड़ दे, तो हम 2 बार तक मुफ़्त में दूसरा देते हैं। अगर हमारे मिलवाए किसी को 12 महीने के अंदर Laboura के बिना रखा, तो पूरी फ़ीस और 50% लगेगा।\n\nआपको एग्रीमेंट पढ़कर OTP से मंज़ूर करने का लिंक मिलेगा। उम्मीदवार दिखाने से पहले फ़ील्ड एजेंट आकर आपका बिज़नेस जाँचेगा।”',
};
