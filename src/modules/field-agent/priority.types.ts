import { Business, JobSeeker, Vacancy } from '@prisma/client';

export type UrgencyBand = 'critical' | 'high' | 'medium' | 'normal';

export interface PriorityCandidateRow {
  candidate: JobSeeker;
  id: string;
  code: string;
  name: string;
  tradeSkill: string;
  minSalary: number;
  maxSalary: number;
  daysRemaining: number;
  refundDeadline: Date | null;
  band: UrgencyBand;
  twoHitFlag: boolean;
}

export interface PriorityVacancyRow {
  vacancy: Vacancy & { business: Business };
  id: string;
  code: string;
  tradeSkill: string;
  offeredSalary: number;
  headcount: number;
  businessId: string;
  businessName: string;
  businessArea: string;
  daysOpen: number;
  isReplacement: boolean;
  isInReplacementWindow: boolean;
  feeValue: number;
}

export interface PriorityTradeRow {
  trade: string;
  tradeSkill: string;
  activeCandidatesCount: number;
  openVacancyHeadcount: number;
  status: 'candidate_surplus' | 'vacancy_surplus' | 'balanced';
  surplusType: 'candidate_surplus' | 'vacancy_surplus' | 'balanced';
}
