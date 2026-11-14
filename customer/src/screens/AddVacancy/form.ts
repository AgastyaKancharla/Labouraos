import type { SalaryPeriod, Shift, Trade, VacancyDraft } from '@/api/types';
import type { MessageKey } from '@/i18n';
import { monthlyPaise } from '@/lib/validate';

export interface VacancyFormState {
  trade: string;
  roleTitle: string;
  openings: number | null;
  salaryMinPaise: number | null;
  salaryMaxPaise: number | null;
  salaryPeriod: SalaryPeriod;
  shift: '' | Shift;
  startDate: string;
  description: string;
  legalMinimumAcknowledged: boolean;
}

export const emptyVacancy = (): VacancyFormState => ({
  trade: '',
  roleTitle: '',
  openings: 1,
  salaryMinPaise: null,
  salaryMaxPaise: null,
  salaryPeriod: 'monthly',
  shift: '',
  startDate: '',
  description: '',
  legalMinimumAcknowledged: false,
});

/**
 * Below the legal minimum wage is ALLOWED BUT WARNED (guide, decided 9 Nov):
 * the form shows the legal minimum and the owner ticks "I know the legal
 * minimum wage" before saving. Daily wages are compared over 26 days.
 */
export function belowLegalMinimum(trade: Trade | undefined, v: Pick<VacancyFormState, 'salaryMinPaise' | 'salaryPeriod'>): boolean {
  if (!trade || !v.salaryMinPaise) return false;
  return monthlyPaise(v.salaryMinPaise, v.salaryPeriod) < trade.legalMinimumPaise;
}

export type VacancyErrors = Partial<Record<keyof VacancyFormState, MessageKey>>;

export function validateVacancy(v: VacancyFormState, trade: Trade | undefined): VacancyErrors {
  const e: VacancyErrors = {};
  if (!v.trade) e.trade = 'form.required';
  if (!v.openings || v.openings < 1) e.openings = 'form.required';
  if (!v.salaryMinPaise) e.salaryMinPaise = 'form.required';
  if (v.salaryMinPaise && v.salaryMaxPaise && v.salaryMaxPaise < v.salaryMinPaise) e.salaryMaxPaise = 'jobSeeker.maxBelowMin';
  if (!v.shift) e.shift = 'form.required';
  if (!v.startDate) e.startDate = 'form.required';
  if (belowLegalMinimum(trade, v) && !v.legalMinimumAcknowledged) e.legalMinimumAcknowledged = 'vacancy.tickLegalMinimum';
  return e;
}

export function toVacancyDraft(v: VacancyFormState): VacancyDraft {
  return {
    trade: v.trade,
    roleTitle: v.roleTitle.trim() || null,
    openings: v.openings ?? 1,
    salaryMinPaise: v.salaryMinPaise ?? 0,
    salaryMaxPaise: v.salaryMaxPaise,
    salaryPeriod: v.salaryPeriod,
    shift: v.shift as Shift,
    startDate: v.startDate,
    description: v.description.trim(),
    legalMinimumAcknowledged: v.legalMinimumAcknowledged,
  };
}
