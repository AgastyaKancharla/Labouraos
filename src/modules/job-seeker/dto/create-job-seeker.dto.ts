export interface CreateJobSeekerDto {
  name: string;
  phone: string;
  otpRequestId: string;
  messageLanguage: 'kn' | 'hi' | 'en';
  bestTimeToCall: '09-12' | '12-15' | '15-18' | '18-21' | '09-21';
  dateOfBirth: string;
  gender: string;
  heardFrom: 'toll_free_missed_call' | 'ad' | 'referral_partner' | 'field_visit' | 'social_media' | 'walk_in' | 'other' | 'laboura_app';
  locality: string;
  pincode: string;
  latitude: number;
  longitude: number;
  travelDistanceKm: number;
  trades: Array<{ trade: string; yearsExperience: number }>;
  availableFrom: string;
  lookingSince: string;
  minSalary: number;
  maxSalary: number;
  salaryPeriod: 'monthly' | 'daily';
  shiftPreference: 'day' | 'night' | 'rotational' | 'any';
  jobType: 'full_time' | 'part_time' | 'live_in';
  spokenLanguages: string[];
  referredById?: string;
  city?: string;
  [key: string]: unknown;
}
