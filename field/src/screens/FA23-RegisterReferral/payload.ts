/**
 * The referral partner form (FA23, the field version of the office CA15) and
 * its mapping onto CreateReferralDto (src/modules/referral/dto/create-referral.dto.ts).
 */
export const INDIVIDUAL_ROLES = ['auto_driver', 'shop_staff', 'shop_owner', 'security_guard', 'existing_worker', 'other'] as const;
export const HEARD_FROM = ['toll_free_missed_call', 'ad', 'referral_partner', 'field_visit', 'social_media', 'walk_in', 'other'] as const;
export const PARTNER_BUSINESS_TYPES = [
  'restaurant_hotel', 'bakery', 'retail_shop', 'supermarket', 'apartment_society', 'office',
  'factory', 'warehouse', 'hospital_clinic', 'construction', 'security_agency', 'salon', 'other',
] as const;

export interface ReferralForm {
  name: string;
  mobile: string;
  requestId: string | null;
  code: string;
  sentAt: number | null;
  verifiedAt: string | null;
  whatsappSame: boolean;
  whatsapp: string;
  type: 'individual' | 'business';
  individualRole: string;
  partnerBusinessName: string;
  partnerBusinessType: string;
  area: string;
  pincode: string;
  heardFrom: string;
}

export const EMPTY_REFERRAL: ReferralForm = {
  name: '',
  mobile: '',
  requestId: null,
  code: '',
  sentAt: null,
  verifiedAt: null,
  whatsappSame: true,
  whatsapp: '',
  type: 'individual',
  individualRole: '',
  partnerBusinessName: '',
  partnerBusinessType: '',
  area: '',
  pincode: '',
  heardFrom: 'field_visit',
};

const MOBILE = /^[6-9]\d{9}$/;

/** Keys of the fields still missing or wrong (the same as CA15's referralErrors). */
export function referralErrors(form: ReferralForm): string[] {
  const e: string[] = [];
  if (!form.name.trim()) e.push('name');
  if (!form.verifiedAt || !form.requestId) e.push('mobile');
  if (!form.whatsappSame && !MOBILE.test(form.whatsapp)) e.push('whatsapp');
  if (form.type === 'individual' && !form.individualRole) e.push('individualRole');
  if (form.type === 'business' && (!form.partnerBusinessName.trim() || !form.partnerBusinessType)) e.push('business');
  if (!form.area) e.push('area');
  if (!/^\d{6}$/.test(form.pincode)) e.push('pincode');
  if (!form.heardFrom) e.push('heardFrom');
  return e;
}

/** Body for POST /referrals. */
export function referralBody(form: ReferralForm): Record<string, unknown> {
  return {
    name: form.name.trim(),
    phone: form.mobile,
    otpRequestId: form.requestId,
    type: form.type,
    whatsappPhone: form.whatsappSame ? form.mobile : form.whatsapp,
    ...(form.type === 'individual'
      ? { individualRole: form.individualRole }
      : { partnerBusinessName: form.partnerBusinessName.trim(), partnerBusinessType: form.partnerBusinessType }),
    locality: form.area,
    pincode: form.pincode,
    heardFrom: form.heardFrom,
    city: 'Bengaluru',
  };
}
