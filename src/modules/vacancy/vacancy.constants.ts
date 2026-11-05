export const VACANCY_EXTRAS = [
  'overtime',
  'incentives',
  'food',
  'accommodation',
  'transport',
  'uniform',
  'pf_esi',
] as const;

export type VacancyExtra = (typeof VACANCY_EXTRAS)[number];
