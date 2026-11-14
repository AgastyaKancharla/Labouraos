import type { BusinessContactRole, BusinessType, HeardFrom, Language, Shift } from '@/api/types';
import type { Choice } from '@/components/form';
import type { MessageKey } from '@/i18n';

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

/** Picker lists shared by the forms, labelled in the chosen language. */
export const heardFromChoices = (t: T): Choice<HeardFrom>[] =>
  (['laboura_app', 'ad', 'social_media', 'referral_partner', 'field_visit', 'missed_call', 'walk_in'] as const).map((v) => ({ value: v, label: t(`heard.${v}`) }));

export const shiftChoices = (t: T): Choice<Shift>[] => (['day', 'night', 'rotational', 'any'] as const).map((v) => ({ value: v, label: t(`shift.${v}`) }));

export const messageLanguageChoices = (t: T): Choice<Language>[] => (['kn', 'hi', 'en'] as const).map((v) => ({ value: v, label: t(`msgLang.${v}`) }));

/** Households stay hidden until the owner decides (open question 9, C24). */
export const businessTypeChoices = (t: T): Choice<BusinessType>[] =>
  (
    ['restaurant_hotel', 'bakery', 'retail_shop', 'supermarket', 'apartment_society', 'office', 'factory', 'warehouse', 'hospital_clinic', 'construction', 'security_agency', 'salon', 'other'] as const
  ).map((v) => ({ value: v, label: t(`bizType.${v}`) }));

export const contactRoleChoices = (t: T): Choice<BusinessContactRole>[] =>
  (['owner', 'manager', 'hr', 'supervisor', 'other'] as const).map((v) => ({ value: v, label: t(`contactRole.${v}`) }));

export const spokenLanguageChoices = (t: T): Choice[] =>
  (['kannada', 'hindi', 'english', 'tamil', 'telugu', 'urdu', 'malayalam', 'marathi', 'bengali', 'odia'] as const).map((v) => ({ value: v, label: t(`spoken.${v}`) }));
