import type { Area, BusinessType, Language, Pin, ReferralForm } from '@/api/types';
import type { MessageKey } from '@/i18n';
import { isMobile, isPincode } from '@/lib/validate';

export interface ReferralDraft {
  name: string;
  partnerType: '' | 'individual' | 'business';
  individualKind: '' | NonNullable<ReferralForm['individualKind']>;
  businessType: '' | BusinessType;
  businessName: string;
  area: string;
  pincode: string;
  pin: Pin | null;
  messageLanguage: Language;
  whatsappSame: boolean;
  whatsappPhone: string;
}

export const emptyReferral = (language: Language, name = ''): ReferralDraft => ({
  name,
  partnerType: '',
  individualKind: '',
  businessType: '',
  businessName: '',
  area: '',
  pincode: '',
  pin: null,
  messageLanguage: language,
  whatsappSame: true,
  whatsappPhone: '',
});

export type ReferralErrors = Partial<Record<keyof ReferralDraft, MessageKey>>;

/** The guide's partner registration (decided 9 Nov). */
export function validateReferral(d: ReferralDraft): ReferralErrors {
  const e: ReferralErrors = {};
  if (d.name.trim().length < 2) e.name = 'form.required';
  if (!d.partnerType) e.partnerType = 'form.required';
  if (d.partnerType === 'individual' && !d.individualKind) e.individualKind = 'form.required';
  if (d.partnerType === 'business') {
    if (!d.businessType) e.businessType = 'form.required';
    if (d.businessName.trim().length < 2) e.businessName = 'form.required';
  }
  if (!d.area) e.area = 'form.required';
  if (!isPincode(d.pincode)) e.pincode = 'form.pincodeInvalid';
  if (!d.whatsappSame && !isMobile(d.whatsappPhone)) e.whatsappPhone = 'otp.invalidMobile';
  return e;
}

export function toReferralForm(d: ReferralDraft, areas: Area[] = []): ReferralForm {
  const area = areas.find((a) => a.name === d.area);
  return {
    name: d.name.trim(),
    partnerType: d.partnerType as 'individual' | 'business',
    individualKind: d.partnerType === 'individual' ? (d.individualKind as NonNullable<ReferralForm['individualKind']>) : null,
    businessType: d.partnerType === 'business' ? (d.businessType as BusinessType) : null,
    businessName: d.partnerType === 'business' ? d.businessName.trim() : null,
    area: d.area,
    pincode: d.pincode.trim(),
    pin: d.pin ?? (area ? { latitude: area.latitude, longitude: area.longitude } : null),
    messageLanguage: d.messageLanguage,
    whatsappPhone: d.whatsappSame ? null : d.whatsappPhone,
  };
}
