/**
 * The vacancy check (Master Guide rev 211, "Decided 25 Nov", B4): a vacancy goes live after the
 * owner's code as before, unless it looks unusual — then it waits in status pending_tl_check
 * and no candidate is shown for it until a Team Lead approves it.
 *
 * Unusual means either:
 *  - salary: the top of its salary range (monthly; a daily wage × PricingPolicy.salaryDaysPerMonth)
 *    is more than 1.5 times the top of its trade's usual monthly range (Trade.salaryMaxPaise,
 *    the market range the CEO keeps on C-Pricing → Trades). A trade typed in that is not on
 *    the list has no usual range, so only the openings rule applies to it.
 *  - openings: more than 5 people for one vacancy.
 * Fake jobs are typically baited with a salary far above the market or "20 helpers needed";
 * genuine ones sit inside or a little above the trade's range.
 */
export const VACANCY_SALARY_CHECK_FACTOR_PERCENT = 150;
export const VACANCY_MAX_OPENINGS_WITHOUT_CHECK = 5;

/** Status of a vacancy waiting for the Team Lead (after the owner confirmed it). */
export const VACANCY_PENDING_TL_CHECK = 'pending_tl_check';

export interface VacancyCheckInput {
  headcount: number;
  salaryMinPaise: number | null;
  salaryMaxPaise: number | null;
  salaryPeriod: string | null;
  /** The trade's usual monthly range top, or null when the trade is not on the list. */
  tradeSalaryMaxPaise: number | null;
  salaryDaysPerMonth: number;
}

export interface VacancyCheckReason {
  code: 'salary_high' | 'many_openings';
  detail: string;
}

function rupees(paise: number): string {
  return `₹${Math.round(paise / 100).toLocaleString('en-IN')}`;
}

export function vacancyCheckReasons(v: VacancyCheckInput): VacancyCheckReason[] {
  const reasons: VacancyCheckReason[] = [];
  const top = v.salaryMaxPaise ?? v.salaryMinPaise;
  if (top && top > 0 && v.tradeSalaryMaxPaise && v.tradeSalaryMaxPaise > 0) {
    const monthly = v.salaryPeriod === 'daily' ? top * Math.max(1, v.salaryDaysPerMonth) : top;
    const limit = Math.floor((v.tradeSalaryMaxPaise * VACANCY_SALARY_CHECK_FACTOR_PERCENT) / 100);
    if (monthly > limit) {
      reasons.push({
        code: 'salary_high',
        detail: `Salary up to ${rupees(monthly)} a month is more than 1.5 times the usual top for this trade (${rupees(v.tradeSalaryMaxPaise)})`,
      });
    }
  }
  if (v.headcount > VACANCY_MAX_OPENINGS_WITHOUT_CHECK) {
    reasons.push({ code: 'many_openings', detail: `${v.headcount} openings (more than ${VACANCY_MAX_OPENINGS_WITHOUT_CHECK})` });
  }
  return reasons;
}
