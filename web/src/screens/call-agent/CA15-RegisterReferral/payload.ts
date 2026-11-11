import type { BusinessHit } from '../_registration/api';
import type { PlaceState } from '../_registration/kit';

/** Referral partner form (CA15) → CreateReferralDto (referral.service.ts). */
export interface ReferralForm {
  name: string;
  mobile: string;
  whatsappSame: boolean;
  whatsapp: string;
  language: string;
  type: 'individual' | 'business';
  individualRole: string;
  business: BusinessHit | null;
  partnerBusinessName: string;
  partnerBusinessType: string;
  place: PlaceState;
  heardFrom: string;
}

export const EMPTY_REFERRAL: ReferralForm = {
  name: '',
  mobile: '',
  whatsappSame: true,
  whatsapp: '',
  language: '',
  type: 'individual',
  individualRole: '',
  business: null,
  partnerBusinessName: '',
  partnerBusinessType: '',
  place: { area: '', pincode: '', latitude: null, longitude: null },
  heardFrom: '',
};

export function referralErrors(form: ReferralForm): string[] {
  const e: string[] = [];
  if (!form.name.trim()) e.push('name');
  if (!form.language) e.push('language');
  if (!form.whatsappSame && !/^[6-9]\d{9}$/.test(form.whatsapp)) e.push('whatsapp');
  if (form.type === 'individual' && !form.individualRole) e.push('individualRole');
  if (form.type === 'business' && !form.business && (!form.partnerBusinessName.trim() || !form.partnerBusinessType)) e.push('business');
  if (!form.place.area) e.push('area');
  if (!/^\d{6}$/.test(form.place.pincode)) e.push('pincode');
  if (!form.heardFrom) e.push('heardFrom');
  return e;
}

export function referralBody(form: ReferralForm, otpRequestId: string) {
  return {
    name: form.name.trim(),
    phone: form.mobile,
    otpRequestId,
    type: form.type,
    whatsappPhone: form.whatsappSame ? form.mobile : form.whatsapp,
    language: form.language,
    ...(form.type === 'individual'
      ? { individualRole: form.individualRole }
      : form.business
        ? { businessId: form.business.id }
        : { partnerBusinessName: form.partnerBusinessName.trim(), partnerBusinessType: form.partnerBusinessType }),
    locality: form.place.area,
    pincode: form.place.pincode,
    ...(form.place.latitude !== null && form.place.longitude !== null ? { latitude: form.place.latitude, longitude: form.place.longitude } : {}),
    heardFrom: form.heardFrom,
    city: 'Bengaluru',
  };
}
