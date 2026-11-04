export interface CreateJobSeekerTradeDto {
  trade: string;
  yearsExperience?: number;
  isPrimary?: boolean;
}

export interface UpdateJobSeekerTradeDto {
  trade?: string;
  yearsExperience?: number;
  isPrimary?: boolean;
}
