export const OTP_PROVIDER = 'OTP_PROVIDER';

export interface OtpSendOptions {
  purpose?: string;
  requestId?: string;
}

export interface OtpSendResult {
  requestId: string;
  resendAvailableAt: string;
  resendsLeft: number;
}

export interface OtpProvider {
  sendOtp(phone: string, options?: OtpSendOptions): Promise<OtpSendResult>;
  verifyOtp(requestId: string, code: string): Promise<boolean>;
  isVerified?(requestId: string, phone?: string): Promise<boolean>;
  consumeVerified?(requestId: string, phone: string): Promise<boolean>;
  getPhoneLast4?(requestId: string): Promise<string | null>;
}
