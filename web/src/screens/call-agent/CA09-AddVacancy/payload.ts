import type { BusinessHit } from '../_registration/api';
import { dateKeyToIso } from '../_registration/api';
import { EXPERIENCE_NEEDED } from '../_registration/options';

/** The vacancy form (CA09) and its mapping onto CreateVacancyDto. */
export interface VacancyForm {
  business: BusinessHit | null;
  branchId: string;
  trade: string;
  otherTrade: string;
  roleTitle: string;
  headcount: string;
  salaryMinPaise: number | null;
  salaryMaxPaise: number | null;
  period: 'monthly' | 'daily';
  ownerTold: boolean;
  shift: string;
  startsAt: string;
  endsAt: string;
  weeklyOff: string;
  experience: string;
  startDate: string;
  extras: string[];
  interviewType: 'walk_in' | 'scheduled';
  interviewDate: string;
  slotStart: string;
  slotEnd: string;
  contactName: string;
  gender: string;
  genderReason: string;
  description: string;
}

export const EMPTY_VACANCY: VacancyForm = {
  business: null,
  branchId: '',
  trade: '',
  otherTrade: '',
  roleTitle: '',
  headcount: '1',
  salaryMinPaise: null,
  salaryMaxPaise: null,
  period: 'monthly',
  ownerTold: false,
  shift: '',
  startsAt: '',
  endsAt: '',
  weeklyOff: '',
  experience: '',
  startDate: '',
  extras: [],
  interviewType: 'walk_in',
  interviewDate: '',
  slotStart: '',
  slotEnd: '',
  contactName: '',
  gender: '',
  genderReason: '',
  description: '',
};

/** Fields still missing; `belowLegal` makes the owner-told tick required. */
export function vacancyErrors(form: VacancyForm, tradeName: string, belowLegal: boolean, isDraft = false): string[] {
  const e: string[] = [];
  if (!form.business) e.push('business');
  if (!tradeName) e.push('trade');
  if (!form.salaryMinPaise) e.push('salaryMin');
  if (form.salaryMinPaise && form.salaryMaxPaise && form.salaryMaxPaise < form.salaryMinPaise) e.push('salaryOrder');
  if (belowLegal && !form.ownerTold) e.push('ownerTold');
  if (!form.shift) e.push('shift');
  if (!form.startsAt) e.push('startsAt');
  if (!form.endsAt) e.push('endsAt');
  if (!form.weeklyOff) e.push('weeklyOff');
  if (!form.experience) e.push('experience');
  if (!form.startDate) e.push('startDate');
  if (!isDraft) {
    if (!form.interviewDate) e.push('interviewDate');
    if (form.interviewType === 'scheduled' && (!form.slotStart || !form.slotEnd || form.slotEnd <= form.slotStart)) e.push('slot');
  }
  if (form.gender && !form.genderReason.trim()) e.push('genderReason');
  return e;
}

function istInstant(day: string, time: string): string {
  return new Date(`${day}T${time}:00+05:30`).toISOString();
}

/** Body for POST /vacancies. */
export function vacancyBody(form: VacancyForm, tradeName: string) {
  return {
    businessId: form.business!.id,
    ...(form.branchId ? { branchId: form.branchId } : {}),
    tradeSkill: tradeName,
    ...(form.roleTitle.trim() ? { roleTitle: form.roleTitle.trim() } : {}),
    headcount: Number(form.headcount),
    salaryMinPaise: form.salaryMinPaise!,
    ...(form.salaryMaxPaise ? { salaryMaxPaise: form.salaryMaxPaise } : {}),
    salaryPeriod: form.period,
    ownerToldMinimumWage: form.ownerTold,
    shift: form.shift,
    workingHours: `${form.startsAt}–${form.endsAt}`,
    weeklyOff: form.weeklyOff,
    experienceRequiredYears: EXPERIENCE_NEEDED.find((x) => x.value === form.experience)?.years ?? 0,
    startDate: form.startDate,
    extras: form.extras,
    interviewType: form.interviewType,
    ...(form.interviewType === 'walk_in'
      ? { walkInDate: form.interviewDate }
      : { interviewSlots: [{ startsAt: istInstant(form.interviewDate, form.slotStart), endsAt: istInstant(form.interviewDate, form.slotEnd) }] }),
    ...(form.contactName.trim() ? { interviewContactName: form.contactName.trim() } : {}),
    ...(form.gender ? { genderRequirement: form.gender, genderReason: form.genderReason.trim() } : {}),
    ...(form.description.trim() ? { description: form.description.trim() } : {}),
  };
}

/** Columns PATCH /vacancies/:id writes when a staff-needed draft is finished. */
export function draftPatchBody(form: VacancyForm, tradeName: string) {
  return {
    tradeSkill: tradeName,
    ...(form.roleTitle.trim() ? { roleTitle: form.roleTitle.trim() } : {}),
    headcount: Number(form.headcount),
    salaryMinPaise: form.salaryMinPaise!,
    salaryMaxPaise: form.salaryMaxPaise ?? form.salaryMinPaise!,
    salaryPeriod: form.period,
    shift: form.shift,
    workingHours: `${form.startsAt}–${form.endsAt}`,
    weeklyOff: form.weeklyOff,
    experienceRequiredYears: EXPERIENCE_NEEDED.find((x) => x.value === form.experience)?.years ?? 0,
    startDate: dateKeyToIso(form.startDate),
    extras: form.extras,
    ...(form.gender ? { genderRequirement: form.gender, genderReason: form.genderReason.trim() } : {}),
    ...(form.description.trim() ? { description: form.description.trim() } : {}),
    reason: 'Finished from the business’s staff-needed draft',
  };
}
