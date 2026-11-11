/** Words for the Finance screens (plain English, as in the designs). */
export const EXPENSE_CATEGORY: Record<string, string> = {
  rent: 'Rent',
  calling: 'Calling company',
  sms_whatsapp: 'SMS & WhatsApp',
  id_checks: 'ID checks',
  hosting: 'Hosting',
  ads_marketing: 'Ads & marketing',
  field_travel: "Field agents' travel",
  office_other: 'Office & other',
  salaries: 'Salaries',
  payouts_rewards: 'Referral payouts & joining rewards',
};

export const EXPENSE_CATEGORY_OPTIONS = ['office_other', 'calling', 'sms_whatsapp', 'hosting', 'ads_marketing', 'field_travel', 'rent', 'id_checks'] as const;

export const CHANNEL: Record<string, string> = {
  toll_free_missed_call: 'Toll-free missed call',
  ad: 'Ads / posters',
  referral_partner: 'Referral partners',
  field_visit: 'Field visits',
  social_media: 'Social media',
  walk_in: 'Walk-in',
  other: 'Other',
};

export const PAID_FROM: Record<string, string> = {
  bank_transfer: 'Bank transfer (company account)',
  upi: 'UPI (company account)',
  card: 'Company card',
  cash: 'Cash',
};

export function roleLabel(role: string | undefined): string {
  return role === 'ceo' ? 'CEO' : role === 'finance' ? 'Finance' : role === 'team_lead' ? 'TL' : role === 'manager' ? 'Manager' : (role ?? '');
}

export function firstName(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}
