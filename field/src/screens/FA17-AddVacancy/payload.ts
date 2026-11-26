import type { Trade } from '@/api/endpoints';

/** FA17 quick vacancy form → POST /vacancies (CreateVacancyDto). Amounts in paise. */
export interface QuickVacancy {
  trade: string;
  otherTrade: string;
  headcount: string;
  salaryMinPaise: number | null;
  salaryMaxPaise: number | null;
  ownerTold: boolean;
  /** Older drafts only: the day / night / rotational word. New vacancies pick a business shift. */
  shift: string;
  /** One of the business's own shifts (17 Nov). */
  businessShiftId: string;
  startDate: string;
  extras: string[];
}

export const OTHER_TRADE = '__other__';
export const EMPTY_VACANCY: QuickVacancy = {
  trade: '',
  otherTrade: '',
  headcount: '1',
  salaryMinPaise: null,
  salaryMaxPaise: null,
  ownerTold: false,
  shift: '',
  businessShiftId: '',
  startDate: '',
  extras: [],
};

/** The four extras on the quick form (values the API accepts). */
export const QUICK_EXTRAS = ['food', 'accommodation', 'pf_esi', 'uniform'] as const;
export const HEADCOUNTS = ['1', '2', '3', '4', '5'] as const;
export const VACANCY_SHIFTS = ['day', 'night', 'rotational'] as const;

export function tradeNameOf(form: QuickVacancy): string {
  return (form.trade === OTHER_TRADE ? form.otherTrade : form.trade).trim();
}

export function findTrade(trades: readonly Trade[] | undefined, name: string): Trade | undefined {
  const key = name.trim().toLowerCase();
  return trades?.find((t) => t.name.trim().toLowerCase() === key);
}

/**
 * The legal minimum (paise / month) this vacancy is checked against. A listed
 * trade uses its own figure; a typed ("Other") trade is checked by the server
 * against the unskilled figure of the business's zone (rev 193), so the form
 * uses the lowest unskilled figure in the list. `server` is what the server
 * answered for this trade name (MINIMUM_WAGE_TICK_REQUIRED, 26 Nov fix) and
 * always wins, so the warning and the tick show whenever the server wants them.
 */
export function legalMinimumFor(
  trades: readonly Trade[] | undefined,
  name: string,
  server?: { trade: string; legalMinimumPaise: number } | null,
): number | null {
  const key = name.trim().toLowerCase();
  if (!key) return null;
  if (server && server.trade.trim().toLowerCase() === key) return server.legalMinimumPaise;
  const trade = findTrade(trades, name);
  if (trade) return trade.legalMinimumPaise;
  const unskilled = (trades ?? []).filter((t) => t.minimumWageLevel === 'unskilled').map((t) => t.legalMinimumPaise);
  return unskilled.length > 0 ? Math.min(...unskilled) : null;
}

/** Below the legal minimum: allowed but warned; the owner-told tick is required. */
export function isBelowLegalMinimum(legalMinimumPaise: number | null | undefined, minPaise: number | null): boolean {
  return !!legalMinimumPaise && minPaise !== null && minPaise < legalMinimumPaise;
}

export type VacancyError = 'trade' | 'salaryMin' | 'salaryOrder' | 'ownerTold' | 'shift' | 'startDate';

export function vacancyErrors(form: QuickVacancy, legalMinimumPaise: number | null | undefined): VacancyError[] {
  const e: VacancyError[] = [];
  if (!tradeNameOf(form)) e.push('trade');
  if (!form.salaryMinPaise) e.push('salaryMin');
  if (form.salaryMinPaise && form.salaryMaxPaise && form.salaryMaxPaise < form.salaryMinPaise) e.push('salaryOrder');
  if (isBelowLegalMinimum(legalMinimumPaise, form.salaryMinPaise) && !form.ownerTold) e.push('ownerTold');
  if (!form.businessShiftId) e.push('shift');
  if (!form.startDate) e.push('startDate');
  return e;
}

export function vacancyBody(businessId: string, form: QuickVacancy) {
  return {
    businessId,
    tradeSkill: tradeNameOf(form),
    headcount: Number(form.headcount),
    salaryMinPaise: form.salaryMinPaise,
    ...(form.salaryMaxPaise ? { salaryMaxPaise: form.salaryMaxPaise } : {}),
    salaryPeriod: 'monthly',
    businessShiftId: form.businessShiftId,
    startDate: form.startDate,
    extras: form.extras,
    ownerToldMinimumWage: form.ownerTold,
    interviewType: 'walk_in',
    capturedChannel: 'field_visit',
  };
}
