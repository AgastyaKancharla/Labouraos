export const OTP_PROVIDER = 'OTP_PROVIDER';

export interface OtpSendOptions {
  purpose?: string;
  requestId?: string;
}

export interface OtpSendResult {
  requestId: string;
  resendAvailableAt: string;
  resendsLeft: number;
  /**
   * OTP test mode only (mock sender, see otp-test-mode.ts): the code itself,
   * so testers can finish OTP steps. Never set by the real sender.
   */
  testModeCode?: string;
}

export interface OtpProvider {
  sendOtp(phone: string, options?: OtpSendOptions): Promise<OtpSendResult>;
  verifyOtp(requestId: string, code: string): Promise<boolean>;
  isVerified?(requestId: string, phone?: string): Promise<boolean>;
  consumeVerified?(requestId: string, phone: string): Promise<boolean>;
  getPhoneLast4?(requestId: string): Promise<string | null>;
}
