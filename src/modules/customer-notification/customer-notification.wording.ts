import { CUSTOMER_EVENTS, CustomerEventKind } from './customer-notification.constants';

/**
 * Notification wording in the three app languages (decided 11 Nov: Kannada,
 * Hindi and English everywhere). One title and one body per event; the same
 * text is the inbox copy and the push.
 *
 * Lock-screen rule (proposal 5.4): no private details. Never a business name,
 * an address, a phone number, a rupee amount or a reason here: "You have an
 * interview tomorrow. Open Laboura", and the app shows the details after
 * sign-in. A referral partner sees a first name only (decided, question 18).
 *
 * Kannada and Hindi were written by Claude and must be checked by a native
 * speaker before the public launch (marked in the PR). Push and in-app wording
 * needs no DLT or Meta approval; the same text can seed the SMS and WhatsApp
 * templates later (proposal 5.4).
 */

export type CustomerLanguage = 'kn' | 'hi' | 'en';

export interface Wording {
  title: string;
  body: string;
}

export const CUSTOMER_NOTIFICATION_WORDING: Record<CustomerEventKind, Record<CustomerLanguage, Wording>> = {
  signup_reminder: {
    en: { title: 'Finish your Laboura sign-up', body: '{stepsLeft} steps left. Tap to continue where you stopped.' },
    kn: { title: 'ನಿಮ್ಮ Laboura ನೋಂದಣಿ ಪೂರ್ಣಗೊಳಿಸಿ', body: 'ಇನ್ನೂ {stepsLeft} ಹಂತಗಳು ಬಾಕಿ ಇವೆ. ನಿಲ್ಲಿಸಿದಲ್ಲಿಂದ ಮುಂದುವರಿಸಲು ಟ್ಯಾಪ್ ಮಾಡಿ.' },
    hi: { title: 'अपना Laboura पंजीकरण पूरा करें', body: 'बस {stepsLeft} कदम बाकी हैं। जहाँ रुके थे, वहीं से आगे बढ़ने के लिए टैप करें।' },
  },
  id_check_approved: {
    en: { title: 'ID check done', body: 'Your identity is verified. Open Laboura for the next step.' },
    kn: { title: 'ಗುರುತಿನ ಪರಿಶೀಲನೆ ಮುಗಿದಿದೆ', body: 'ನಿಮ್ಮ ಗುರುತು ದೃಢಪಟ್ಟಿದೆ. ಮುಂದಿನ ಹಂತಕ್ಕಾಗಿ Laboura ತೆರೆಯಿರಿ.' },
    hi: { title: 'पहचान जाँच पूरी हुई', body: 'आपकी पहचान की पुष्टि हो गई है। अगले कदम के लिए Laboura खोलें।' },
  },
  id_check_retry: {
    en: { title: 'ID check needs another try', body: 'We could not finish your ID check. Open Laboura to try again.' },
    kn: { title: 'ಗುರುತಿನ ಪರಿಶೀಲನೆ ಮತ್ತೆ ಮಾಡಬೇಕು', body: 'ನಿಮ್ಮ ಗುರುತಿನ ಪರಿಶೀಲನೆ ಪೂರ್ಣವಾಗಲಿಲ್ಲ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಲು Laboura ತೆರೆಯಿರಿ.' },
    hi: { title: 'पहचान जाँच दोबारा करें', body: 'आपकी पहचान जाँच पूरी नहीं हो सकी। दोबारा कोशिश करने के लिए Laboura खोलें।' },
  },
  payment_confirmed: {
    en: { title: 'Payment received', body: 'Your {days}-day guarantee has started. Your receipt is in Laboura.' },
    kn: { title: 'ಪಾವತಿ ಸ್ವೀಕರಿಸಲಾಗಿದೆ', body: 'ನಿಮ್ಮ {days} ದಿನಗಳ ಗ್ಯಾರಂಟಿ ಆರಂಭವಾಗಿದೆ. ರಸೀದಿ Laboura ನಲ್ಲಿ ಇದೆ.' },
    hi: { title: 'भुगतान मिल गया', body: 'आपकी {days} दिन की गारंटी शुरू हो गई है। रसीद Laboura में है।' },
  },
  fee_paid: {
    en: { title: 'Payment received', body: 'Thank you. Your invoice and the candidate details are in Laboura.' },
    kn: { title: 'ಪಾವತಿ ಸ್ವೀಕರಿಸಲಾಗಿದೆ', body: 'ಧನ್ಯವಾದಗಳು. ನಿಮ್ಮ ಇನ್‌ವಾಯ್ಸ್ ಮತ್ತು ಅಭ್ಯರ್ಥಿಯ ವಿವರಗಳು Laboura ನಲ್ಲಿ ಇವೆ.' },
    hi: { title: 'भुगतान मिल गया', body: 'धन्यवाद। आपका इनवॉइस और उम्मीदवार का विवरण Laboura में है।' },
  },
  job_match: {
    en: { title: 'A new job that suits you', body: 'Open Laboura to see it and tap "I\'m interested".' },
    kn: { title: 'ನಿಮಗೆ ಸರಿಹೊಂದುವ ಹೊಸ ಕೆಲಸ', body: 'ನೋಡಲು Laboura ತೆರೆಯಿರಿ ಮತ್ತು "ನನಗೆ ಆಸಕ್ತಿ ಇದೆ" ಒತ್ತಿರಿ.' },
    hi: { title: 'आपके लायक एक नई नौकरी', body: 'देखने के लिए Laboura खोलें और "मुझे दिलचस्पी है" दबाएँ।' },
  },
  interview_booked: {
    en: { title: 'You have an interview offer', body: 'Reply within {hours} hours. Open Laboura for the details.' },
    kn: { title: 'ನಿಮಗೆ ಸಂದರ್ಶನದ ಆಫರ್ ಬಂದಿದೆ', body: '{hours} ಗಂಟೆಗಳ ಒಳಗೆ ಉತ್ತರಿಸಿ. ವಿವರಗಳಿಗೆ Laboura ತೆರೆಯಿರಿ.' },
    hi: { title: 'आपको इंटरव्यू का ऑफ़र मिला है', body: '{hours} घंटे के अंदर जवाब दें। विवरण के लिए Laboura खोलें।' },
  },
  interview_reminder_tomorrow: {
    en: { title: 'Interview tomorrow', body: 'You have an interview tomorrow. Open Laboura for the time.' },
    kn: { title: 'ನಾಳೆ ಸಂದರ್ಶನ', body: 'ನಾಳೆ ನಿಮಗೆ ಸಂದರ್ಶನವಿದೆ. ಸಮಯಕ್ಕಾಗಿ Laboura ತೆರೆಯಿರಿ.' },
    hi: { title: 'कल इंटरव्यू है', body: 'कल आपका इंटरव्यू है। समय देखने के लिए Laboura खोलें।' },
  },
  interview_reminder_soon: {
    en: { title: 'Interview in 2 hours', body: 'Your interview is in about 2 hours. Open Laboura for directions.' },
    kn: { title: '2 ಗಂಟೆಗಳಲ್ಲಿ ಸಂದರ್ಶನ', body: 'ಸುಮಾರು 2 ಗಂಟೆಗಳಲ್ಲಿ ನಿಮ್ಮ ಸಂದರ್ಶನವಿದೆ. ದಾರಿಗಾಗಿ Laboura ತೆರೆಯಿರಿ.' },
    hi: { title: '2 घंटे में इंटरव्यू', body: 'लगभग 2 घंटे में आपका इंटरव्यू है। रास्ते के लिए Laboura खोलें।' },
  },
  offer_check: {
    en: { title: 'Did they offer you the job?', body: 'Tell us in Laboura: yes or no.' },
    kn: { title: 'ಅವರು ನಿಮಗೆ ಕೆಲಸ ಕೊಟ್ಟರೆ?', body: 'Laboura ನಲ್ಲಿ ತಿಳಿಸಿ: ಹೌದು ಅಥವಾ ಇಲ್ಲ.' },
    hi: { title: 'क्या उन्होंने आपको नौकरी दी?', body: 'Laboura में बताएँ: हाँ या नहीं।' },
  },
  joining_confirmed: {
    en: { title: 'Joining date confirmed', body: 'Open Laboura to see the joining date.' },
    kn: { title: 'ಸೇರುವ ದಿನಾಂಕ ಖಚಿತವಾಗಿದೆ', body: 'ಸೇರುವ ದಿನಾಂಕ ನೋಡಲು Laboura ತೆರೆಯಿರಿ.' },
    hi: { title: 'जॉइनिंग की तारीख पक्की हुई', body: 'जॉइनिंग की तारीख देखने के लिए Laboura खोलें।' },
  },
  joining_moved: {
    en: { title: 'Joining date changed', body: 'The joining date has moved. Open Laboura to see the new date.' },
    kn: { title: 'ಸೇರುವ ದಿನಾಂಕ ಬದಲಾಗಿದೆ', body: 'ಸೇರುವ ದಿನಾಂಕ ಬದಲಾಗಿದೆ. ಹೊಸ ದಿನಾಂಕ ನೋಡಲು Laboura ತೆರೆಯಿರಿ.' },
    hi: { title: 'जॉइनिंग की तारीख बदली', body: 'जॉइनिंग की तारीख बदल गई है। नई तारीख देखने के लिए Laboura खोलें।' },
  },
  joining_day_check: {
    en: { title: 'Joining day', body: 'Today is the joining day. Tell us in Laboura if it happened.' },
    kn: { title: 'ಇಂದು ಸೇರುವ ದಿನ', body: 'ಇಂದು ಕೆಲಸಕ್ಕೆ ಸೇರುವ ದಿನ. ಸೇರಿದ್ದಾರೆಯೇ ಎಂದು Laboura ನಲ್ಲಿ ತಿಳಿಸಿ.' },
    hi: { title: 'आज जॉइनिंग का दिन है', body: 'आज जॉइनिंग का दिन है। जॉइनिंग हुई या नहीं, Laboura में बताएँ।' },
  },
  hit_recorded: {
    en: { title: 'A hit was recorded', body: 'Open Laboura to see why, and how to ask for a review.' },
    kn: { title: 'ಒಂದು ಹಿಟ್ ದಾಖಲಾಗಿದೆ', body: 'ಕಾರಣ ಮತ್ತು ಮರುಪರಿಶೀಲನೆ ಕೇಳುವ ವಿಧಾನ ನೋಡಲು Laboura ತೆರೆಯಿರಿ.' },
    hi: { title: 'एक हिट दर्ज हुई है', body: 'कारण और दोबारा जाँच माँगने का तरीका देखने के लिए Laboura खोलें।' },
  },
  guarantee_countdown: {
    en: { title: 'Guarantee update', body: '{daysLeft} days left in your guarantee. Open Laboura for your status.' },
    kn: { title: 'ಗ್ಯಾರಂಟಿ ಅಪ್‌ಡೇಟ್', body: 'ನಿಮ್ಮ ಗ್ಯಾರಂಟಿಯಲ್ಲಿ ಇನ್ನೂ {daysLeft} ದಿನಗಳು ಉಳಿದಿವೆ. ಸ್ಥಿತಿ ನೋಡಲು Laboura ತೆರೆಯಿರಿ.' },
    hi: { title: 'गारंटी अपडेट', body: 'आपकी गारंटी में {daysLeft} दिन बाकी हैं। अपनी स्थिति देखने के लिए Laboura खोलें।' },
  },
  refund_approved: {
    en: { title: 'Refund approved', body: 'Your refund is approved. Laboura will pay it to your UPI soon.' },
    kn: { title: 'ಮರುಪಾವತಿ ಅನುಮೋದನೆಯಾಗಿದೆ', body: 'ನಿಮ್ಮ ಮರುಪಾವತಿ ಅನುಮೋದನೆಯಾಗಿದೆ. Laboura ಶೀಘ್ರದಲ್ಲೇ ನಿಮ್ಮ UPI ಗೆ ಪಾವತಿಸುತ್ತದೆ.' },
    hi: { title: 'रिफ़ंड मंज़ूर हुआ', body: 'आपका रिफ़ंड मंज़ूर हो गया है। Laboura जल्द ही आपके UPI पर भुगतान करेगा।' },
  },
  refund_paid: {
    en: { title: 'Refund paid', body: 'Your refund has been paid. The UPI reference is in Laboura.' },
    kn: { title: 'ಮರುಪಾವತಿ ಮಾಡಲಾಗಿದೆ', body: 'ನಿಮ್ಮ ಮರುಪಾವತಿ ಮಾಡಲಾಗಿದೆ. UPI ರೆಫರೆನ್ಸ್ Laboura ನಲ್ಲಿ ಇದೆ.' },
    hi: { title: 'रिफ़ंड भेज दिया गया', body: 'आपका रिफ़ंड भेज दिया गया है। UPI रेफ़रेंस Laboura में है।' },
  },
  reward_approved: {
    en: { title: 'Joining reward approved', body: 'Your joining reward is approved. Laboura will pay it to your UPI soon.' },
    kn: { title: 'ಸೇರ್ಪಡೆ ಬಹುಮಾನ ಅನುಮೋದನೆಯಾಗಿದೆ', body: 'ನಿಮ್ಮ ಸೇರ್ಪಡೆ ಬಹುಮಾನ ಅನುಮೋದನೆಯಾಗಿದೆ. Laboura ಶೀಘ್ರದಲ್ಲೇ ನಿಮ್ಮ UPI ಗೆ ಪಾವತಿಸುತ್ತದೆ.' },
    hi: { title: 'जॉइनिंग इनाम मंज़ूर हुआ', body: 'आपका जॉइनिंग इनाम मंज़ूर हो गया है। Laboura जल्द ही आपके UPI पर भुगतान करेगा।' },
  },
  reward_paid: {
    en: { title: 'Joining reward paid', body: 'Your joining reward has been paid. The UPI reference is in Laboura.' },
    kn: { title: 'ಸೇರ್ಪಡೆ ಬಹುಮಾನ ಪಾವತಿಯಾಗಿದೆ', body: 'ನಿಮ್ಮ ಸೇರ್ಪಡೆ ಬಹುಮಾನ ಪಾವತಿಯಾಗಿದೆ. UPI ರೆಫರೆನ್ಸ್ Laboura ನಲ್ಲಿ ಇದೆ.' },
    hi: { title: 'जॉइनिंग इनाम भेज दिया गया', body: 'आपका जॉइनिंग इनाम भेज दिया गया है। UPI रेफ़रेंस Laboura में है।' },
  },
  visit_booked: {
    en: { title: 'Visit booked', body: '{agentFirstName} from Laboura will visit you on {when}.' },
    kn: { title: 'ಭೇಟಿ ನಿಗದಿಯಾಗಿದೆ', body: 'Laboura ನ {agentFirstName} ಅವರು {when} ರಂದು ನಿಮ್ಮನ್ನು ಭೇಟಿ ಮಾಡುತ್ತಾರೆ.' },
    hi: { title: 'मुलाक़ात तय हुई', body: 'Laboura से {agentFirstName} {when} को आपसे मिलने आएँगे।' },
  },
  business_approved: {
    en: { title: 'Your business is verified', body: 'Laboura can now share candidates with you. Open Laboura.' },
    kn: { title: 'ನಿಮ್ಮ ವ್ಯವಹಾರ ದೃಢಪಟ್ಟಿದೆ', body: 'ಈಗ Laboura ನಿಮಗೆ ಅಭ್ಯರ್ಥಿಗಳನ್ನು ತೋರಿಸಬಹುದು. Laboura ತೆರೆಯಿರಿ.' },
    hi: { title: 'आपका व्यवसाय सत्यापित हो गया', body: 'अब Laboura आपको उम्मीदवार दिखा सकता है। Laboura खोलें।' },
  },
  vacancy_confirmed: {
    en: { title: 'Vacancy confirmed', body: 'Vacancy {vacancyCode} is confirmed. We will look for candidates.' },
    kn: { title: 'ಖಾಲಿ ಹುದ್ದೆ ಖಚಿತವಾಗಿದೆ', body: 'ಖಾಲಿ ಹುದ್ದೆ {vacancyCode} ಖಚಿತವಾಗಿದೆ. ನಾವು ಅಭ್ಯರ್ಥಿಗಳನ್ನು ಹುಡುಕುತ್ತೇವೆ.' },
    hi: { title: 'वैकेंसी पक्की हुई', body: 'वैकेंसी {vacancyCode} पक्की हो गई है। हम उम्मीदवार ढूँढेंगे।' },
  },
  candidates_shared: {
    en: { title: 'New candidates for you', body: 'Laboura shared candidates for your vacancy. Open Laboura to see them.' },
    kn: { title: 'ನಿಮಗಾಗಿ ಹೊಸ ಅಭ್ಯರ್ಥಿಗಳು', body: 'ನಿಮ್ಮ ಖಾಲಿ ಹುದ್ದೆಗೆ Laboura ಅಭ್ಯರ್ಥಿಗಳನ್ನು ಹಂಚಿಕೊಂಡಿದೆ. ನೋಡಲು Laboura ತೆರೆಯಿರಿ.' },
    hi: { title: 'आपके लिए नए उम्मीदवार', body: 'Laboura ने आपकी वैकेंसी के लिए उम्मीदवार भेजे हैं। देखने के लिए Laboura खोलें।' },
  },
  interview_result_due: {
    en: { title: 'Record today\'s interview result', body: 'Please record the result in Laboura by 8 PM today.' },
    kn: { title: 'ಇಂದಿನ ಸಂದರ್ಶನದ ಫಲಿತಾಂಶ ದಾಖಲಿಸಿ', body: 'ದಯವಿಟ್ಟು ಇಂದು ರಾತ್ರಿ 8 ಗಂಟೆಯೊಳಗೆ Laboura ನಲ್ಲಿ ಫಲಿತಾಂಶ ದಾಖಲಿಸಿ.' },
    hi: { title: 'आज के इंटरव्यू का नतीजा दर्ज करें', body: 'कृपया आज रात 8 बजे तक Laboura में नतीजा दर्ज करें।' },
  },
  selected_pay_fee: {
    en: { title: 'Candidate selected: pay to confirm', body: 'Pay the fee within {hours} hours to confirm the joining. Open Laboura.' },
    kn: { title: 'ಅಭ್ಯರ್ಥಿ ಆಯ್ಕೆ: ಖಚಿತಪಡಿಸಲು ಪಾವತಿಸಿ', body: 'ಸೇರ್ಪಡೆ ಖಚಿತಪಡಿಸಲು {hours} ಗಂಟೆಗಳ ಒಳಗೆ ಶುಲ್ಕ ಪಾವತಿಸಿ. Laboura ತೆರೆಯಿರಿ.' },
    hi: { title: 'उम्मीदवार चुना गया: पक्का करने के लिए भुगतान करें', body: 'जॉइनिंग पक्की करने के लिए {hours} घंटे के अंदर फ़ीस भरें। Laboura खोलें।' },
  },
  claim_decided: {
    en: { title: 'Replacement claim decided', body: 'There is a decision on your replacement claim. Open Laboura.' },
    kn: { title: 'ಬದಲಿ ಕ್ಲೇಮ್ ತೀರ್ಮಾನವಾಗಿದೆ', body: 'ನಿಮ್ಮ ಬದಲಿ ಕ್ಲೇಮ್ ಬಗ್ಗೆ ತೀರ್ಮಾನವಾಗಿದೆ. Laboura ತೆರೆಯಿರಿ.' },
    hi: { title: 'रिप्लेसमेंट क्लेम पर फ़ैसला', body: 'आपके रिप्लेसमेंट क्लेम पर फ़ैसला हो गया है। Laboura खोलें।' },
  },
  replacement_found: {
    en: { title: 'Replacement found', body: 'Laboura found a replacement candidate for you. Open Laboura.' },
    kn: { title: 'ಬದಲಿ ಅಭ್ಯರ್ಥಿ ಸಿಕ್ಕಿದ್ದಾರೆ', body: 'Laboura ನಿಮಗಾಗಿ ಬದಲಿ ಅಭ್ಯರ್ಥಿಯನ್ನು ಹುಡುಕಿದೆ. Laboura ತೆರೆಯಿರಿ.' },
    hi: { title: 'रिप्लेसमेंट मिल गया', body: 'Laboura ने आपके लिए रिप्लेसमेंट उम्मीदवार ढूँढ लिया है। Laboura खोलें।' },
  },
  referral_registered: {
    en: { title: 'New referral', body: '{firstName} registered with your link.' },
    kn: { title: 'ಹೊಸ ರೆಫರಲ್', body: '{firstName} ನಿಮ್ಮ ಲಿಂಕ್ ಮೂಲಕ ನೋಂದಾಯಿಸಿದ್ದಾರೆ.' },
    hi: { title: 'नया रेफ़रल', body: '{firstName} ने आपके लिंक से पंजीकरण किया है।' },
  },
  referral_paid: {
    en: { title: 'Referral update', body: '{firstName} has paid and is now looking for a job with Laboura.' },
    kn: { title: 'ರೆಫರಲ್ ಅಪ್‌ಡೇಟ್', body: '{firstName} ಪಾವತಿಸಿದ್ದಾರೆ ಮತ್ತು ಈಗ Laboura ಮೂಲಕ ಕೆಲಸ ಹುಡುಕುತ್ತಿದ್ದಾರೆ.' },
    hi: { title: 'रेफ़रल अपडेट', body: '{firstName} ने भुगतान कर दिया है और अब Laboura से नौकरी ढूँढ रहे हैं।' },
  },
  referral_joined: {
    en: { title: 'Your referral joined a job', body: '{firstName} joined a job. Your reward is now due. Open Laboura.' },
    kn: { title: 'ನಿಮ್ಮ ರೆಫರಲ್ ಕೆಲಸಕ್ಕೆ ಸೇರಿದ್ದಾರೆ', body: '{firstName} ಕೆಲಸಕ್ಕೆ ಸೇರಿದ್ದಾರೆ. ನಿಮ್ಮ ಬಹುಮಾನ ಈಗ ಬಾಕಿ ಇದೆ. Laboura ತೆರೆಯಿರಿ.' },
    hi: { title: 'आपका रेफ़रल नौकरी पर लग गया', body: '{firstName} ने नौकरी जॉइन कर ली है। आपका इनाम अब देय है। Laboura खोलें।' },
  },
  payout_approved: {
    en: { title: 'Payout approved', body: 'Your referral payout is approved. Laboura will pay it to your UPI soon.' },
    kn: { title: 'ಪಾವತಿ ಅನುಮೋದನೆಯಾಗಿದೆ', body: 'ನಿಮ್ಮ ರೆಫರಲ್ ಪಾವತಿ ಅನುಮೋದನೆಯಾಗಿದೆ. Laboura ಶೀಘ್ರದಲ್ಲೇ ನಿಮ್ಮ UPI ಗೆ ಪಾವತಿಸುತ್ತದೆ.' },
    hi: { title: 'भुगतान मंज़ूर हुआ', body: 'आपका रेफ़रल भुगतान मंज़ूर हो गया है। Laboura जल्द ही आपके UPI पर भुगतान करेगा।' },
  },
  payout_paid: {
    en: { title: 'Payout paid', body: 'Your referral payout has been paid. The UPI reference is in Laboura.' },
    kn: { title: 'ಪಾವತಿ ಮಾಡಲಾಗಿದೆ', body: 'ನಿಮ್ಮ ರೆಫರಲ್ ಪಾವತಿ ಮಾಡಲಾಗಿದೆ. UPI ರೆಫರೆನ್ಸ್ Laboura ನಲ್ಲಿ ಇದೆ.' },
    hi: { title: 'भुगतान भेज दिया गया', body: 'आपका रेफ़रल भुगतान भेज दिया गया है। UPI रेफ़रेंस Laboura में है।' },
  },
  promotion: {
    en: { title: 'News from Laboura', body: 'Open Laboura to see what is new.' },
    kn: { title: 'Laboura ನಿಂದ ಸುದ್ದಿ', body: 'ಹೊಸದೇನಿದೆ ಎಂದು ನೋಡಲು Laboura ತೆರೆಯಿರಿ.' },
    hi: { title: 'Laboura से ख़बर', body: 'नया क्या है, यह देखने के लिए Laboura खोलें।' },
  },
};

const LOCALE: Record<CustomerLanguage, string> = { en: 'en-IN', kn: 'kn-IN', hi: 'hi-IN' };

export function isCustomerLanguage(value: unknown): value is CustomerLanguage {
  return value === 'kn' || value === 'hi' || value === 'en';
}

export type WordingVars = Record<string, string | number | Date>;

/** Formats a value for a placeholder: dates in IST, in the person's language. */
function formatVar(value: string | number | Date, language: CustomerLanguage): string {
  if (value instanceof Date) {
    return new Intl.DateTimeFormat(LOCALE[language], {
      timeZone: 'Asia/Kolkata',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    }).format(value);
  }
  return String(value);
}

function fill(template: string, vars: WordingVars, language: CustomerLanguage): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? formatVar(vars[name], language) : match,
  );
}

/**
 * The title and body of one event in one language. Unknown languages fall
 * back to English. Throws when a placeholder the event needs is missing, so a
 * caller can never send "{firstName} joined a job".
 */
export function renderWording(kind: CustomerEventKind, language: string, vars: WordingVars = {}): Wording & { language: CustomerLanguage } {
  const lang: CustomerLanguage = isCustomerLanguage(language) ? language : 'en';
  const missing = CUSTOMER_EVENTS[kind].vars.filter((name) => !Object.prototype.hasOwnProperty.call(vars, name));
  if (missing.length > 0) {
    throw new Error(`Notification ${kind} needs ${missing.join(', ')}`);
  }
  const wording = CUSTOMER_NOTIFICATION_WORDING[kind][lang];
  return { title: fill(wording.title, vars, lang), body: fill(wording.body, vars, lang), language: lang };
}
