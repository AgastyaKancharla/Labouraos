export class CreateVacancyDto {
  tradeSkill!: string;
  salaryMinPaise!: number;
  salaryMaxPaise?: number;
  salaryPeriod?: string;
  headcount?: number;
  description?: string;
  roleTitle?: string;
  extras?: string[];
  workingHours?: string;
  shift?: string;
  weeklyOff?: string;
  latitude?: number;
  longitude?: number;
  locality?: string;
  experienceRequiredYears?: number;
  educationRequired?: string;
  languagesRequired?: string[];
  licencesRequired?: string[];
  ageMin?: number;
  ageMax?: number;
  genderRequirement?: string;
  genderReason?: string;
  startDate?: string;
  urgency?: string;
  probationDays?: number;
  interviewType?: string;
  interviewContactName?: string;
  capturedChannel?: string;
  /** The branch this vacancy belongs to; its contact person confirms it and gets its messages. */
  branchId?: string;
  /** Required when the monthly salary is below the legal minimum wage for the trade (Phase 20 Task 8). */
  ownerToldMinimumWage?: boolean;
  walkInDate?: string;
  interviewSlots?: Array<{
    startsAt: string;
    endsAt: string;
    capacity?: number;
  }>;
}
