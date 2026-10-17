export interface CreateReferralDto {
  name: string;
  phone?: string;
  mobileNumber?: string;
  type?: 'individual' | 'business';
  otpRequestId: string;
  city?: string;
  [key: string]: unknown;
}
