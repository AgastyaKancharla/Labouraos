import type { BusinessHit } from '../_registration/api';
import type { PlaceState } from '../_registration/kit';

/** Referral partner form (CA15) → CreateReferralDto (referral.service.ts). */
export interface ReferralForm {
  name: string;
  mobile: string;
  whatsappSame: boolean;
  whatsapp: string;
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
  type: 'individual',
  individualRole: '',
  business: null,
  partnerBusinessName: '',
  partnerBusinessType: '',
  place: { area: '', pincode: '', latitude: null, longitude: null },
  heardFrom: '',
};

/**
 * 22 Nov (owner testing): a partner who is a registered business takes the area, pincode and pin of
 * that business, so CA15 does not ask for them (the server fills them from the business too). Only
 * when the business has both an area and a valid pincode on file.
 */
export function placeFromBusiness(form: Pick<ReferralForm, 'type' | 'business'>): { area: string; pincode: string; hasPin: boolean } | null {
  const b = form.type === 'business' ? form.business : null;
  if (!b || !b.locality?.trim() || !/^\d{6}$/.test(b.pincode ?? '')) return null;
  return { area: b.locality.trim(), pincode: b.pincode!, hasPin: Boolean(b.hasPin) };
}

export function referralErrors(form: ReferralForm): string[] {
  const e: string[] = [];
  if (!form.name.trim()) e.push('name');
  if (!form.whatsappSame && !/^[6-9]\d{9}$/.test(form.whatsapp)) e.push('whatsapp');
  if (form.type === 'individual' && !form.individualRole) e.push('individualRole');
  if (form.type === 'business' && !form.business && (!form.partnerBusinessName.trim() || !form.partnerBusinessType)) e.push('business');
  if (!placeFromBusiness(form)) {
    if (!form.place.area) e.push('area');
    if (!/^\d{6}$/.test(form.place.pincode)) e.push('pincode');
  }
  if (!form.heardFrom) e.push('heardFrom');
  return e;
}

export function referralBody(form: ReferralForm, otpRequestId: string) {
  const fromBusiness = placeFromBusiness(form);
  if (fromBusiness) {
    // The pin comes from the business on the server; nothing typed is sent for the place.
    return { ...referralBodyBase(form, otpRequestId), locality: fromBusiness.area, pincode: fromBusiness.pincode, heardFrom: form.heardFrom, city: 'Bengaluru' };
  }
  return {
    name: form.name.trim(),
    phone: form.mobile,
    otpRequestId,
    type: form.type,
    whatsappPhone: form.whatsappSame ? form.mobile : form.whatsapp,
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

function referralBodyBase(form: ReferralForm, otpRequestId: string) {
  return {
    name: form.name.trim(),
    phone: form.mobile,
    otpRequestId,
    type: form.type,
    whatsappPhone: form.whatsappSame ? form.mobile : form.whatsapp,
    businessId: form.business!.id,
  };
}
