/**
 * WhatsApp first, SMS as backup (Master Guide rev 211, 25 Nov): the two send
 * buttons wherever a link is sent (components/SendLinkButtons) and "Send by SMS"
 * on the code screens after 30 seconds (screens/_selling/OtpStep).
 */
export const waFirst25En = {
  'send.onWhatsApp': 'Send on WhatsApp',
  'send.bySms': 'Send by SMS',
  'send.result.whatsapp': 'Sent on WhatsApp. If it is not delivered within an hour (9 AM–9 PM), it goes by SMS too.',
  'send.result.sms': 'Sent by SMS.',
  'send.result.smsFallback': 'WhatsApp could not take it, so it went by SMS.',
  'send.result.none': 'Not sent: neither WhatsApp nor SMS took it. Try again or call them.',
  'otp.sendBySms': 'Send by SMS',
  'otp.sentBySms': 'A new code was sent by SMS.',
};
