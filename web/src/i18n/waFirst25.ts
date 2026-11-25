/* WhatsApp first, SMS as backup (Master Guide rev 211, 25 Nov): the two send
   buttons wherever an agent sends a link (components/SendLinkButtons), "Send by
   SMS" on the code screens after 30 seconds, and "No WhatsApp" on the call agent
   console's profiles (components/NoWhatsAppToggle). */

export const waFirst25En = {
  'send.onWhatsApp': 'Send on WhatsApp',
  'send.bySms': 'Send by SMS',
  'send.result.whatsapp': 'Sent on WhatsApp. If it is not delivered within an hour (9 AM–9 PM), it goes by SMS too.',
  'send.result.sms': 'Sent by SMS.',
  'send.result.smsFallback': 'WhatsApp could not take it, so it went by SMS.',
  'send.result.none': 'Not sent: neither WhatsApp nor SMS took it. Try again or call them.',
  'send.result.blocked': 'Not sent: this person asked not to be contacted, or the number is wrong.',
  'otp.sendBySms': 'Send by SMS',
  'otp.sentBySms': 'A new code was sent by SMS.',
  'noWa.title': 'WhatsApp',
  'noWa.has': 'Messages go on WhatsApp first, with SMS as backup.',
  'noWa.none': 'No WhatsApp: messages go straight by SMS.',
  'noWa.meta': 'WhatsApp said this number cannot get messages.',
  'noWa.mark': 'Mark "No WhatsApp"',
  'noWa.clear': 'They have WhatsApp',
  'noWa.saved': 'Saved',
} as const;
