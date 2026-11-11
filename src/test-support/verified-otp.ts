import { INestApplication } from '@nestjs/common';
import { OtpService } from '../common/otp/otp.service';
import { MockOtpProvider } from '../common/otp/mock-otp.provider';

/** Test-only. Sends an OTP to a number through the mock provider and verifies it. */
export async function verifiedOtpFor(app: INestApplication, phone: string): Promise<string> {
  const otp = app.get(OtpService);
  const sent = await otp.sendOtp(phone);
  const code = (otp.getProvider() as MockOtpProvider).getCode(sent.requestId)!;
  await otp.verifyOtp(sent.requestId, code);
  return sent.requestId;
}
