export interface CreateJobSeekerDto {
  name?: string;
  phone?: string;
  mobileNumber?: string;
  otpRequestId: string;
  tradeSkill: string;
  minSalary: number;
  maxSalary: number;
  preferredCallWindowStart: string;
  preferredCallWindowEnd: string;
  city?: string;
  referredById?: string;
  [key: string]: unknown;
}
