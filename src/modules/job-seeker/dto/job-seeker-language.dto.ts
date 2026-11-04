export interface CreateJobSeekerLanguageDto {
  language: string;
  speaks?: boolean;
  reads?: boolean;
  writes?: boolean;
}

export interface UpdateJobSeekerLanguageDto {
  language?: string;
  speaks?: boolean;
  reads?: boolean;
  writes?: boolean;
}
