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
  walkInDate?: string;
  interviewSlots?: Array<{
    startsAt: string;
    endsAt: string;
    capacity?: number;
  }>;
}
