import type { BusinessContactRole, BusinessType, HeardFrom, Shift } from '@/api/types';
import type { Choice } from '@/components/form';
import type { MessageKey } from '@/i18n';

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

/** Picker lists shared by the forms, labelled in the chosen language. */
export const heardFromChoices = (t: T): Choice<HeardFrom>[] =>
  (['laboura_app', 'ad', 'social_media', 'referral_partner', 'field_visit', 'missed_call', 'walk_in'] as const).map((v) => ({ value: v, label: t(`heard.${v}`) }));

export const shiftChoices = (t: T): Choice<Shift>[] => (['day', 'night', 'rotational', 'any'] as const).map((v) => ({ value: v, label: t(`shift.${v}`) }));


/** Households stay hidden until the owner decides (open question 9, C24). */
export const businessTypeChoices = (t: T): Choice<BusinessType>[] =>
  (
    ['restaurant_hotel', 'bakery', 'retail_shop', 'supermarket', 'apartment_society', 'office', 'factory', 'warehouse', 'hospital_clinic', 'construction', 'security_agency', 'salon', 'other'] as const
  ).map((v) => ({ value: v, label: t(`bizType.${v}`) }));

export const contactRoleChoices = (t: T): Choice<BusinessContactRole>[] =>
  (['owner', 'manager', 'hr', 'supervisor'] as const).map((v) => ({ value: v, label: t(`contactRole.${v}`) }));

/** Spoken languages (what the person speaks, not the app language): the English names the agent form stores ("Kannada"). */
export const spokenLanguageChoices = (t: T): Choice[] =>
  (['kannada', 'hindi', 'english', 'tamil', 'telugu', 'urdu', 'malayalam', 'marathi', 'bengali', 'odia'] as const).map((v) => ({
    value: v.charAt(0).toUpperCase() + v.slice(1),
    label: t(`spoken.${v}`),
  }));

/**
 * Experience a business needs for a vacancy (24 Nov): the same five choices
 * as the call agent's Add vacancy (CA09), sent as `experienceRequiredYears`
 * — matching gives experience 15% of the score.
 */
export const EXPERIENCE_NEEDED = [
  { value: '0', years: 0 },
  { value: '1', years: 1 },
  { value: '2', years: 2 },
  { value: '3', years: 3 },
  { value: '5', years: 5 },
] as const;
export type ExperienceNeeded = (typeof EXPERIENCE_NEEDED)[number]['value'];
export const experienceChoices = (t: T): Choice<ExperienceNeeded>[] => EXPERIENCE_NEEDED.map((x) => ({ value: x.value, label: t(`experience.${x.value}`) }));
export const experienceYears = (value: string): number => EXPERIENCE_NEEDED.find((x) => x.value === value)?.years ?? 0;
