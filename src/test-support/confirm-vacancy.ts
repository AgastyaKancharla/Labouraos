import { INestApplication } from '@nestjs/common';
import { OtpService } from '../common/otp/otp.service';
import { MockOtpProvider } from '../common/otp/mock-otp.provider';
import { VacancyConfirmationService } from '../modules/vacancy/vacancy-confirmation.service';

/**
 * Test helper (Phase 20 Task 8): a new vacancy waits for its contact person's OTP. Specs that only need an
 * open vacancy confirm it the real way — with the mock OTP code that creation already sent.
 */
export async function confirmVacancyForTest(
  app: INestApplication,
  created: { id: string; capturedByStaffId?: string | null; confirmation?: { otpRequestId?: string } | null },
  method: 'code_on_call' | 'code_on_visit' = 'code_on_call',
) {
  const otp = app.get(OtpService);
  const confirmations = app.get(VacancyConfirmationService);
  const actor = { id: created.capturedByStaffId ?? 'system', role: 'call_agent' };
  const requestId = created.confirmation?.otpRequestId
    ?? (await confirmations.sendCode(created.id, actor)).otpRequestId;
  const code = (otp.getProvider() as MockOtpProvider).getCode(requestId);
  if (!code) throw new Error('confirmVacancyForTest needs the mock OTP provider');
  return confirmations.confirmWithCode(created.id, { otpRequestId: requestId, code, method }, actor);
}
