import { Business, JobSeeker, Vacancy } from '@prisma/client';

export interface PriorityDashboardOpportunity {
  vacancyId: string;
  vacancyCode: string;
  tradeSkill: string;
  offeredSalary: number;
  businessId: string;
  businessName: string;
  businessArea: string;
  candidateId: string;
  candidateCode: string;
  candidateName: string;
  candidatePhone: string;
  potentialFee: number;
  refundDeadline: Date | null;
  daysRemainingOnGuarantee: number | null;
  vacancy: Vacancy & { business: Business };
  candidate: JobSeeker;
}

