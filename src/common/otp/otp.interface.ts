export const OTP_PROVIDER = 'OTP_PROVIDER';

export interface OtpProvider {
  sendOtp(phone: string): Promise<{ requestId: string }>;
  verifyOtp(requestId: string, code: string): Promise<boolean>;
  isVerified?(requestId: string, phone?: string): Promise<boolean>;
}
