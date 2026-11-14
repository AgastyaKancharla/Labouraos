/**
 * Words of the push and inbox screens, in the three app languages. Agent C's
 * own file (screen wording elsewhere is Agent B's i18n), so the two branches
 * never edit the same file. Kannada and Hindi were written by Claude and are
 * marked for a native speaker's review before the public launch.
 * The notification texts themselves come from the server, already in the
 * person's language.
 */
import type { Language } from '@/i18n';

const en = {
  'inbox.title': 'Messages',
  'inbox.empty': 'No messages yet. Updates about your sign-up, payments and interviews will appear here.',
  'inbox.markAll': 'Mark all as read',
  'inbox.unread': '{count} unread',
  'inbox.new': 'New',
  'inbox.loadMore': 'Show older messages',
  'inbox.urgent': 'Urgent',
  'settings.title': 'Notification settings',
  'settings.service': 'Service updates',
  'settings.serviceHelp': 'Payments, interviews, offers and your status.',
  'settings.serviceLocked': 'Cannot be turned off while your guarantee is running, so that you never miss an offer.',
  'settings.jobUpdates': 'Job updates',
  'settings.jobUpdatesHelp': 'New jobs that suit you.',
  'settings.promotions': 'Offers and promotions',
  'settings.promotionsHelp': 'Only if you want them. You can turn this off any time.',
  'settings.quiet': 'No notifications between 9 PM and 9 AM, except urgent ones. At most 3 a day.',
  'settings.saveError': 'Could not save. Please try again.',
  'prompt.title': 'Get updates from Laboura',
  'prompt.body': 'We will tell you when your payment is received, when you get an interview offer and when your status changes. Nothing between 9 PM and 9 AM except urgent messages.',
  'prompt.allow': 'Allow notifications',
  'prompt.later': 'Not now',
  'channel.service': 'Service updates',
  'channel.jobUpdates': 'Job updates',
  'channel.promotions': 'Offers and promotions',
} as const;

export type PushKey = keyof typeof en;

const kn: Record<PushKey, string> = {
  'inbox.title': 'ಸಂದೇಶಗಳು',
  'inbox.empty': 'ಇನ್ನೂ ಸಂದೇಶಗಳಿಲ್ಲ. ನಿಮ್ಮ ನೋಂದಣಿ, ಪಾವತಿ ಮತ್ತು ಸಂದರ್ಶನಗಳ ಅಪ್‌ಡೇಟ್‌ಗಳು ಇಲ್ಲಿ ಕಾಣಿಸುತ್ತವೆ.',
  'inbox.markAll': 'ಎಲ್ಲವನ್ನೂ ಓದಿದೆ ಎಂದು ಗುರುತಿಸಿ',
  'inbox.unread': '{count} ಓದದವು',
  'inbox.new': 'ಹೊಸದು',
  'inbox.loadMore': 'ಹಳೆಯ ಸಂದೇಶಗಳನ್ನು ತೋರಿಸಿ',
  'inbox.urgent': 'ತುರ್ತು',
  'settings.title': 'ಅಧಿಸೂಚನೆ ಸೆಟ್ಟಿಂಗ್‌ಗಳು',
  'settings.service': 'ಸೇವಾ ಅಪ್‌ಡೇಟ್‌ಗಳು',
  'settings.serviceHelp': 'ಪಾವತಿಗಳು, ಸಂದರ್ಶನಗಳು, ಆಫರ್‌ಗಳು ಮತ್ತು ನಿಮ್ಮ ಸ್ಥಿತಿ.',
  'settings.serviceLocked': 'ನಿಮ್ಮ ಗ್ಯಾರಂಟಿ ನಡೆಯುತ್ತಿರುವಾಗ ಇದನ್ನು ಆಫ್ ಮಾಡಲು ಆಗುವುದಿಲ್ಲ, ನೀವು ಯಾವುದೇ ಆಫರ್ ತಪ್ಪಿಸಿಕೊಳ್ಳಬಾರದು ಎಂದು.',
  'settings.jobUpdates': 'ಉದ್ಯೋಗ ಅಪ್‌ಡೇಟ್‌ಗಳು',
  'settings.jobUpdatesHelp': 'ನಿಮಗೆ ಸರಿಹೊಂದುವ ಹೊಸ ಕೆಲಸಗಳು.',
  'settings.promotions': 'ಆಫರ್‌ಗಳು ಮತ್ತು ಪ್ರಚಾರಗಳು',
  'settings.promotionsHelp': 'ನಿಮಗೆ ಬೇಕಾದರೆ ಮಾತ್ರ. ಯಾವಾಗ ಬೇಕಾದರೂ ಆಫ್ ಮಾಡಬಹುದು.',
  'settings.quiet': 'ರಾತ್ರಿ 9 ರಿಂದ ಬೆಳಿಗ್ಗೆ 9 ರವರೆಗೆ ತುರ್ತು ಸಂದೇಶಗಳನ್ನು ಬಿಟ್ಟು ಯಾವುದೇ ಅಧಿಸೂಚನೆ ಇಲ್ಲ. ದಿನಕ್ಕೆ ಗರಿಷ್ಠ 3.',
  'settings.saveError': 'ಉಳಿಸಲು ಆಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
  'prompt.title': 'Laboura ನಿಂದ ಅಪ್‌ಡೇಟ್‌ಗಳನ್ನು ಪಡೆಯಿರಿ',
  'prompt.body': 'ನಿಮ್ಮ ಪಾವತಿ ಸ್ವೀಕರಿಸಿದಾಗ, ಸಂದರ್ಶನದ ಆಫರ್ ಬಂದಾಗ ಮತ್ತು ನಿಮ್ಮ ಸ್ಥಿತಿ ಬದಲಾದಾಗ ನಾವು ತಿಳಿಸುತ್ತೇವೆ. ರಾತ್ರಿ 9 ರಿಂದ ಬೆಳಿಗ್ಗೆ 9 ರವರೆಗೆ ತುರ್ತು ಸಂದೇಶಗಳನ್ನು ಬಿಟ್ಟು ಏನೂ ಬರುವುದಿಲ್ಲ.',
  'prompt.allow': 'ಅಧಿಸೂಚನೆಗಳನ್ನು ಅನುಮತಿಸಿ',
  'prompt.later': 'ಈಗ ಬೇಡ',
  'channel.service': 'ಸೇವಾ ಅಪ್‌ಡೇಟ್‌ಗಳು',
  'channel.jobUpdates': 'ಉದ್ಯೋಗ ಅಪ್‌ಡೇಟ್‌ಗಳು',
  'channel.promotions': 'ಆಫರ್‌ಗಳು ಮತ್ತು ಪ್ರಚಾರಗಳು',
};

const hi: Record<PushKey, string> = {
  'inbox.title': 'संदेश',
  'inbox.empty': 'अभी कोई संदेश नहीं। आपके पंजीकरण, भुगतान और इंटरव्यू के अपडेट यहाँ दिखेंगे।',
  'inbox.markAll': 'सबको पढ़ा हुआ मानें',
  'inbox.unread': '{count} बिना पढ़े',
  'inbox.new': 'नया',
  'inbox.loadMore': 'पुराने संदेश दिखाएँ',
  'inbox.urgent': 'ज़रूरी',
  'settings.title': 'सूचना सेटिंग',
  'settings.service': 'सेवा अपडेट',
  'settings.serviceHelp': 'भुगतान, इंटरव्यू, ऑफ़र और आपकी स्थिति।',
  'settings.serviceLocked': 'आपकी गारंटी चलते समय इसे बंद नहीं किया जा सकता, ताकि आपसे कोई ऑफ़र न छूटे।',
  'settings.jobUpdates': 'नौकरी अपडेट',
  'settings.jobUpdatesHelp': 'आपके लायक नई नौकरियाँ।',
  'settings.promotions': 'ऑफ़र और प्रचार',
  'settings.promotionsHelp': 'सिर्फ़ अगर आप चाहें। इसे कभी भी बंद कर सकते हैं।',
  'settings.quiet': 'रात 9 बजे से सुबह 9 बजे तक ज़रूरी संदेशों के अलावा कोई सूचना नहीं। दिन में ज़्यादा से ज़्यादा 3।',
  'settings.saveError': 'सेव नहीं हो सका। कृपया फिर से कोशिश करें।',
  'prompt.title': 'Laboura से अपडेट पाएँ',
  'prompt.body': 'आपका भुगतान मिलने पर, इंटरव्यू का ऑफ़र आने पर और आपकी स्थिति बदलने पर हम आपको बताएँगे। रात 9 बजे से सुबह 9 बजे तक ज़रूरी संदेशों के अलावा कुछ नहीं आएगा।',
  'prompt.allow': 'सूचनाएँ चालू करें',
  'prompt.later': 'अभी नहीं',
  'channel.service': 'सेवा अपडेट',
  'channel.jobUpdates': 'नौकरी अपडेट',
  'channel.promotions': 'ऑफ़र और प्रचार',
};

export const PUSH_STRINGS: Record<Language, Record<PushKey, string>> = { en, kn, hi };

export function pushText(language: Language, key: PushKey, params?: Record<string, string | number>): string {
  const template = PUSH_STRINGS[language]?.[key] ?? en[key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}
