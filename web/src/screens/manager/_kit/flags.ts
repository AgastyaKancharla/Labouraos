/** Plain words for review flag kinds on the Manager screens (mirrors the API's flagTitle for the common ones). */
const WORDS: Record<string, string> = {
  visit_short: 'Short visit',
  visits_too_far_apart: 'Visits too far apart',
  visit_photo_reused: 'Photo used twice',
  visit_gps_suspect: 'GPS looks faked',
  visits_no_onboarding: 'Many visits, no onboarding',
  duplicate_business: 'Duplicate business',
  gps_mismatch: 'Location mismatch',
  odd_hour_login: 'Odd login',
  bypass_suspected: 'Suspected bypass',
  break_overrun: 'Break over time',
  follow_up_unanswered: 'Follow-up unanswered 3 times',
  owner_complaint: 'Owner complaint',
  joining_no_show: "Worker didn't join",
  agent_rejection_pattern: 'Many rejections',
  screenshot_taken: 'Screenshot taken',
  name_check: 'Name check',
  aadhaar_phone_not_linked: 'Phone not linked to Aadhaar',
  aadhaar_qr_tampered: 'Aadhaar QR failed the UIDAI check',
};

export function flagWords(kind: string): string {
  if (WORDS[kind]) return WORDS[kind];
  const w = kind.replace(/_/g, ' ');
  return w.charAt(0).toUpperCase() + w.slice(1);
}
