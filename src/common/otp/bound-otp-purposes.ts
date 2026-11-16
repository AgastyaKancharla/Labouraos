/**
 * OTP purposes bound to one record, for codes a staff member asks the owner to
 * read out (sent with OtpService.sendBoundOtp, never through POST /otp/send).
 * A code sent for one interview or visit never completes another, and a code
 * from another flow never completes these.
 */

/** FA15f/FA15s: the owner confirms an interview result in the shop. */
export function interviewResultOtpPurpose(interviewId: string): string {
  return `interview_result:${interviewId}`;
}

/** FA06 / the visit form: the owner proves he is present at a verification visit. */
export function ownerVisitOtpPurpose(assignmentId: string): string {
  return `owner_visit:${assignmentId}`;
}
