/**
 * Security M4: Prisma writes whose `data` is not written out in place, reviewed
 * one by one. Key: `<file> :: <function> :: <model>.<method> :: <problem>` (see
 * prisma-write-check.ts). Each reason says why the value cannot carry request
 * fields the caller did not intend. A new entry needs the same review; fixing the
 * site (writing the data out in place) is always better than listing it.
 */
export const PRISMA_WRITE_ALLOWLIST: Record<string, string> = {
  "common/anonymisation/anonymisation.service.ts :: anonymise :: identityVerification.updateMany :: data-not-literal":
    "fixed wipe values (idWipe) built in this function",
  "common/anonymisation/anonymisation.service.ts :: anonymise :: referralIdentityVerification.updateMany :: data-not-literal":
    "fixed wipe values (idWipe) built in this function",
  "jobs/job-run-recorder.ts :: write :: jobRun.create :: data-not-literal":
    "JobRun row built by recordJobRun from the job's own name and timings; no request input",
  "jobs/sweep-monitoring.service.ts :: checkSweepStaleness :: jobAlertState.upsert :: update-spread":
    "conditional spread of a server timestamp (lastAlertedAt) only",
  "modules/aadhaar-qr/aadhaar-qr.service.ts :: check :: identityVerification.create :: data-spread":
    "row built in check() from the verified UIDAI QR result; the spread only adds the subject id",
  "modules/aadhaar-qr/aadhaar-qr.service.ts :: check :: referralIdentityVerification.create :: data-spread":
    "row built in check() from the verified UIDAI QR result; the spread only adds the subject id",
  "modules/aadhaar-qr/aadhaar-qr.service.ts :: finishAttempt :: aadhaarQrAttempt.update :: data-spread":
    "extra is the typed { recentQr } flag passed by this service",
  "modules/aadhaar-qr/id-check-photo.service.ts :: closeExpiredCheck :: referralIdentityVerification.updateMany :: data-not-literal":
    "fixed 'photo expired' values built just above",
  "modules/aadhaar-qr/id-check-photo.service.ts :: closeExpiredCheck :: identityVerification.updateMany :: data-not-literal":
    "fixed 'photo expired' values built just above",
  "modules/aadhaar-qr/other-id.service.ts :: submit :: identityVerification.updateMany :: data-not-literal":
    "row/replaced/data built in this function from the validated ID type, last 4 and the Team Lead's verdict",
  "modules/aadhaar-qr/other-id.service.ts :: submit :: identityVerification.create :: data-spread":
    "row/replaced/data built in this function from the validated ID type, last 4 and the Team Lead's verdict",
  "modules/aadhaar-qr/other-id.service.ts :: submit :: referralIdentityVerification.updateMany :: data-not-literal":
    "row/replaced/data built in this function from the validated ID type, last 4 and the Team Lead's verdict",
  "modules/aadhaar-qr/other-id.service.ts :: submit :: referralIdentityVerification.create :: data-spread":
    "row/replaced/data built in this function from the validated ID type, last 4 and the Team Lead's verdict",
  "modules/aadhaar-qr/other-id.service.ts :: closeAsFailed :: identityVerification.updateMany :: data-not-literal":
    "row/replaced/data built in this function from the validated ID type, last 4 and the Team Lead's verdict",
  "modules/aadhaar-qr/other-id.service.ts :: closeAsFailed :: referralIdentityVerification.updateMany :: data-not-literal":
    "row/replaced/data built in this function from the validated ID type, last 4 and the Team Lead's verdict",
  "modules/aadhaar-qr/other-id.service.ts :: recordDecision :: identityVerification.updateMany :: data-not-literal":
    "row/replaced/data built in this function from the validated ID type, last 4 and the Team Lead's verdict",
  "modules/aadhaar-qr/other-id.service.ts :: recordDecision :: referralIdentityVerification.updateMany :: data-not-literal":
    "row/replaced/data built in this function from the validated ID type, last 4 and the Team Lead's verdict",
  "modules/aadhaar-qr/under18-stop.service.ts :: lift :: identityVerification.updateMany :: data-not-literal":
    "lift time, the lifting staff id and the checked reason, built just above",
  "modules/aadhaar-qr/under18-stop.service.ts :: lift :: referralIdentityVerification.updateMany :: data-not-literal":
    "lift time, the lifting staff id and the checked reason, built just above",
  "modules/area/area.service.ts :: update :: area.update :: data-spread":
    "clean = AreaService.clean(input): name, pincode, latitude, longitude and active picked one by one and validated",
  "modules/attendance/attendance-requests.service.ts :: requestLeave :: leaveRequest.create :: data-spread":
    "decision and routing values (status, times, staff ids, note) chosen by the service; leave split from LeaveService.applyApproval",
  "modules/attendance/attendance-requests.service.ts :: requestCorrection :: attendanceCorrection.create :: data-spread":
    "decision and routing values (status, times, staff ids, note) chosen by the service; leave split from LeaveService.applyApproval",
  "modules/attendance/attendance-requests.service.ts :: decide :: leaveRequest.updateMany :: data-not-literal":
    "decision and routing values (status, times, staff ids, note) chosen by the service; leave split from LeaveService.applyApproval",
  "modules/attendance/attendance-requests.service.ts :: decide :: attendanceCorrection.updateMany :: data-not-literal":
    "decision and routing values (status, times, staff ids, note) chosen by the service; leave split from LeaveService.applyApproval",
  "modules/attendance/attendance-requests.service.ts :: decide :: leaveRequest.update :: data-spread":
    "decision and routing values (status, times, staff ids, note) chosen by the service; leave split from LeaveService.applyApproval",
  "modules/attendance/attendance-requests.service.ts :: forward :: leaveRequest.updateMany :: data-not-literal":
    "decision and routing values (status, times, staff ids, note) chosen by the service; leave split from LeaveService.applyApproval",
  "modules/attendance/attendance-requests.service.ts :: forward :: attendanceCorrection.updateMany :: data-not-literal":
    "decision and routing values (status, times, staff ids, note) chosen by the service; leave split from LeaveService.applyApproval",
  "modules/attendance/attendance-requests.service.ts :: sendBack :: leaveRequest.updateMany :: data-not-literal":
    "decision and routing values (status, times, staff ids, note) chosen by the service; leave split from LeaveService.applyApproval",
  "modules/attendance/attendance-requests.service.ts :: sendBack :: attendanceCorrection.updateMany :: data-not-literal":
    "decision and routing values (status, times, staff ids, note) chosen by the service; leave split from LeaveService.applyApproval",
  "modules/attendance/attendance-requests.service.ts :: overturn :: leaveRequest.update :: data-not-literal":
    "decision and routing values (status, times, staff ids, note) chosen by the service; leave split from LeaveService.applyApproval",
  "modules/attendance/attendance-requests.service.ts :: applyCorrection :: attendanceDay.update :: data-spread":
    "decision and routing values (status, times, staff ids, note) chosen by the service; leave split from LeaveService.applyApproval",
  "modules/attendance/attendance.service.ts :: today :: attendanceDay.update :: data-not-literal":
    "day totals and result worked out by the attendance service (totals(), dayResultFor())",
  "modules/attendance/attendance.service.ts :: finishDay :: attendanceDay.update :: data-spread":
    "day totals and result worked out by the attendance service (totals(), dayResultFor())",
  "modules/attendance/attendance.service.ts :: recalculateDay :: attendanceDay.update :: data-not-literal":
    "day totals and result worked out by the attendance service (totals(), dayResultFor())",
  "modules/attendance/attendance.service.ts :: recalculateDay :: attendanceDay.update :: data-spread":
    "day totals and result worked out by the attendance service (totals(), dayResultFor())",
  "modules/attendance/holiday.service.ts :: reworkDate :: attendanceDay.update :: data-not-literal":
    "NO_LEAVE constant reset values",
  "modules/attendance/leave.service.ts :: ensureAccrued :: leaveAccrual.createMany :: data-not-literal":
    "leave accrual/day fields worked out by LeaveService (constants, joinedFields(), totalsOf(), dayResultFor())",
  "modules/attendance/leave.service.ts :: markDay :: attendanceDay.update :: data-spread":
    "leave accrual/day fields worked out by LeaveService (constants, joinedFields(), totalsOf(), dayResultFor())",
  "modules/attendance/leave.service.ts :: markDay :: attendanceDay.update :: data-not-literal":
    "leave accrual/day fields worked out by LeaveService (constants, joinedFields(), totalsOf(), dayResultFor())",
  "modules/attendance/leave.service.ts :: markDay :: attendanceDay.create :: data-spread":
    "leave accrual/day fields worked out by LeaveService (constants, joinedFields(), totalsOf(), dayResultFor())",
  "modules/attendance/leave.service.ts :: writeTotals :: leaveRequest.update :: data-not-literal":
    "leave accrual/day fields worked out by LeaveService (constants, joinedFields(), totalsOf(), dayResultFor())",
  "modules/attendance/leave.service.ts :: reallocate :: attendanceDay.update :: data-spread":
    "leave accrual/day fields worked out by LeaveService (constants, joinedFields(), totalsOf(), dayResultFor())",
  "modules/attendance/leave.service.ts :: undoApproval :: attendanceDay.update :: data-not-literal":
    "leave accrual/day fields worked out by LeaveService (constants, joinedFields(), totalsOf(), dayResultFor())",
  "modules/attendance/leave.service.ts :: undoApproval :: attendanceDay.update :: data-spread":
    "leave accrual/day fields worked out by LeaveService (constants, joinedFields(), totalsOf(), dayResultFor())",
  "modules/attendance/leave.service.ts :: undoApproval :: attendanceDay.update :: data-not-literal #2":
    "leave accrual/day fields worked out by LeaveService (constants, joinedFields(), totalsOf(), dayResultFor())",
  "modules/attendance/leave.service.ts :: undoApproval :: attendanceDay.update :: data-spread #2":
    "leave accrual/day fields worked out by LeaveService (constants, joinedFields(), totalsOf(), dayResultFor())",
  "modules/attendance/leave.service.ts :: reclassifyWorkedDay :: attendanceDay.update :: data-spread":
    "leave accrual/day fields worked out by LeaveService (constants, joinedFields(), totalsOf(), dayResultFor())",
  "modules/business/business.service.ts :: update :: business.update :: data-not-literal":
    "AC-1 edit: built key by key from the pickEditableFields() allowlist and diff.changedFields (server-checked values only); phoneVerified only after the OTP on the new number",
  "modules/business/business.service.ts :: create :: business.create :: data-spread":
    "create: fields from the validated registration form; the spread is the GST lookup result or its empty values",
  "modules/bypass-charge/bypass-charge.service.ts :: raise :: bypassCharge.create :: data-spread":
    "amounts worked out with calculatePlacementFee/calculateGst in this service",
  "modules/company-plan/company-plan.service.ts :: setCompany :: companyPlan.upsert :: create-spread":
    "values = parseValues(body): only PLAN_METRICS keys, each a validated whole number",
  "modules/company-plan/company-plan.service.ts :: setCompany :: companyPlan.upsert :: update-spread":
    "values = parseValues(body): only PLAN_METRICS keys, each a validated whole number",
  "modules/company-plan/company-plan.service.ts :: saveTeamPlans :: teamPlan.upsert :: create-spread":
    "values = parseValues(body): only PLAN_METRICS keys, each a validated whole number",
  "modules/company-plan/company-plan.service.ts :: saveTeamPlans :: teamPlan.upsert :: update-spread":
    "values = parseValues(body): only PLAN_METRICS keys, each a validated whole number",
  "modules/conduct/conduct.service.ts :: confirmPossibleMatch :: reviewFlag.updateMany :: data-spread":
    "spreads the stored flag details (our own JSON) and the covered profiles worked out by the ban service",
  "modules/conduct/conduct.service.ts :: confirmPossibleMatch :: permanentBan.update :: data-spread":
    "spreads the stored flag details (our own JSON) and the covered profiles worked out by the ban service",
  "modules/conduct/conduct.service.ts :: rejectPossibleMatch :: reviewFlag.updateMany :: data-spread":
    "spreads the stored flag details (our own JSON) and the covered profiles worked out by the ban service",
  "modules/consent/consent-link.service.ts :: submitJobSeekerConsent :: jobSeeker.update :: data-spread":
    "status chosen by the consent step; pausedAt reset when he becomes active again",
  "modules/consent/consent.service.ts :: withdraw :: jobSeeker.update :: data-not-literal":
    "status 'paused' and pausedAt set by the consent withdrawal itself",
  "modules/customer-account/customer-account.service.ts :: update :: customerAccount.update :: data-not-literal":
    "language and displayName validated one by one above",
  "modules/customer-account/customer-account.service.ts :: setContactMe :: customerAccount.update :: data-not-literal":
    "contact-me consent fields chosen by the boolean, with server time",
  "modules/customer-account/customer-otp-limiter.service.ts :: bindSend :: customerOtpAttempt.update :: data-not-literal":
    "request id, purpose and account id from the sign-in service",
  "modules/customer-app/customer-registration.service.ts :: markRegistered :: signupTracker.update :: data-spread":
    "stage fields and tracker event chosen by the service",
  "modules/customer-app/customer-registration.service.ts :: newProfile :: customerProfile.create :: data-spread":
    "profile kind, record ids and role decided by the registration service after creating the record",
  "modules/customer-notification/customer-inbox.service.ts :: save :: customerDevice.update :: data-spread":
    "device fields validated one by one (appVersion, pushPermission, pushToken)",
  "modules/customer-notification/customer-notification-settings.service.ts :: update :: customerNotificationSetting.update :: data-not-literal":
    "only the service/jobUpdates/promotions booleans (each checked), or a consent key of the account's own subject and a fixed purpose",
  "modules/customer-notification/customer-notification-settings.service.ts :: grant :: consent.upsert :: create-spread":
    "only the service/jobUpdates/promotions booleans (each checked), or a consent key of the account's own subject and a fixed purpose",
  "modules/customer-notification/customer-push-sender.service.ts :: checkReceipts :: messageLog.update :: data-not-literal":
    "message status worked out from the push send tallies",
  "modules/data-request/data-request.service.ts :: update :: dataRequest.update :: data-not-literal":
    "built field by field from the validated status/notes, with the actor's id",
  "modules/field-selling/field-selling.service.ts :: processDuePhoneInterviews :: callRecord.update :: data-spread":
    "call fields from the telephony provider's answer",
  "modules/field-visit/field-visit.service.ts :: recordOutcome :: businessVisit.update :: data-not-literal":
    "visit/business fields validated above or worked out from the GPS proof and times",
  "modules/field-visit/field-visit.service.ts :: recordProof :: businessVisit.update :: data-spread":
    "visit/business fields validated above or worked out from the GPS proof and times",
  "modules/field-visit/field-visit.service.ts :: linkRegisteredBusiness :: business.update :: data-spread":
    "visit/business fields validated above or worked out from the GPS proof and times",
  "modules/finance/expense.service.ts :: create :: expense.create :: data-spread":
    "stored = bill storage result; payment = payInput() (paidFrom, reference, paidAt validated)",
  "modules/finance/expense.service.ts :: attachBill :: expense.update :: data-not-literal":
    "stored = bill storage result; payment = payInput() (paidFrom, reference, paidAt validated)",
  "modules/finance/expense.service.ts :: approve :: expense.updateMany :: data-spread":
    "stored = bill storage result; payment = payInput() (paidFrom, reference, paidAt validated)",
  "modules/finance/month-end.service.ts :: close :: monthClose.update :: data-not-literal":
    "close values (status, actor, time, note, checklist) built in closeMonth",
  "modules/finance/month-end.service.ts :: close :: monthClose.create :: data-spread":
    "close values (status, actor, time, note, checklist) built in closeMonth",
  "modules/finance/payroll.service.ts :: prepare :: payrollRun.updateMany :: data-spread":
    "payroll run, lines and corrections worked out by the payroll calculation; no request fields",
  "modules/finance/payroll.service.ts :: prepare :: payrollLine.createMany :: data-not-literal":
    "payroll run, lines and corrections worked out by the payroll calculation; no request fields",
  "modules/finance/payroll.service.ts :: prepare :: payrollRun.create :: data-spread":
    "payroll run, lines and corrections worked out by the payroll calculation; no request fields",
  "modules/finance/payroll.service.ts :: prepare :: payrollLine.createMany :: data-not-literal #2":
    "payroll run, lines and corrections worked out by the payroll calculation; no request fields",
  "modules/finance/payroll.service.ts :: prepare :: payrollCorrection.createMany :: data-not-literal":
    "payroll run, lines and corrections worked out by the payroll calculation; no request fields",
  "modules/finance/payroll.service.ts :: approve :: payrollCorrection.createMany :: data-not-literal":
    "payroll run, lines and corrections worked out by the payroll calculation; no request fields",
  "modules/growth/shortage-task.service.ts :: sweep :: shortageTask.update :: data-not-literal":
    "task fields built from the shortage group the service computed",
  "modules/growth/shortage-task.service.ts :: sweep :: shortageTask.create :: data-spread":
    "task fields built from the shortage group the service computed",
  "modules/growth/shortage-task.service.ts :: sweep :: shortageTask.update :: data-not-literal #2":
    "task fields built from the shortage group the service computed",
  "modules/job-seeker/job-seeker.service.ts :: create :: jobSeekerLanguage.createMany :: data-not-literal":
    "languages from validateJobSeekerRegistration()",
  "modules/job-seeker/job-seeker.service.ts :: acceptTermsAndCreatePayment :: jobSeeker.updateMany :: data-spread":
    "terms acceptance fields from the rendered legal document and server time",
  "modules/job-seeker/job-seeker.service.ts :: update :: jobSeeker.update :: data-not-literal":
    "AC-1 edit: built key by key from the pickEditableFields() allowlist and diff.changedFields (server-checked values only); phoneVerified only after the OTP on the new number",
  "modules/job-seeker/job-seeker.service.ts :: updateTrade :: jobSeekerTrade.update :: data-not-literal":
    "trade, yearsExperience and isPrimary set one by one from the validated dto",
  "modules/job-seeker/job-seeker.service.ts :: updateLanguage :: jobSeekerLanguage.update :: data-not-literal":
    "language, speaks, reads and writes set one by one from the validated dto",
  "modules/notification/notification.service.ts :: clear :: notification.updateMany :: data-not-literal":
    "read/cleared timestamps chosen by the service, scoped to the recipient",
  "modules/notification/notification.service.ts :: syncSubject :: notification.updateMany :: data-not-literal":
    "read/cleared timestamps chosen by the service, scoped to the recipient",
  "modules/notification/notification.service.ts :: reconcileKind :: notification.updateMany :: data-not-literal":
    "read/cleared timestamps chosen by the service, scoped to the recipient",
  "modules/notification/notification.service.ts :: markSeen :: notification.updateMany :: data-not-literal":
    "read/cleared timestamps chosen by the service, scoped to the recipient",
  "modules/payment/payment.service.ts :: onPaymentSucceeded :: payment.updateMany :: data-spread":
    "conditional spreads of values the payment service worked out (booking note, refund link, approver role, flag outcome)",
  "modules/payment/payment.service.ts :: confirmPaymentWithBankCredit :: bankCredit.updateMany :: data-spread":
    "conditional spreads of values the payment service worked out (booking note, refund link, approver role, flag outcome)",
  "modules/payment/payment.service.ts :: resolvePaymentMismatchFlag :: reviewFlag.updateMany :: data-spread":
    "conditional spreads of values the payment service worked out (booking note, refund link, approver role, flag outcome)",
  "modules/payment/payment.service.ts :: approvePayment :: payment.update :: data-spread":
    "conditional spreads of values the payment service worked out (booking note, refund link, approver role, flag outcome)",
  "modules/placement/placement.service.ts :: update :: placement.update :: data-not-literal":
    "AC-1 edit: built key by key from the pickEditableFields() allowlist and diff.changedFields (server-checked values only)",
  "modules/placement/placement.service.ts :: decideClaim :: replacementClaim.updateMany :: data-not-literal":
    "claim decision fields (decision, reason, deciders) set one by one from the checked dto, or server status values",
  "modules/placement/placement.service.ts :: decideClaim :: placement.updateMany :: data-not-literal":
    "claim decision fields (decision, reason, deciders) set one by one from the checked dto, or server status values",
  "modules/referral/referral.service.ts :: update :: referral.update :: data-not-literal":
    "AC-1 edit: built key by key from the pickEditableFields() allowlist and diff.changedFields (server-checked values only); phoneVerified only after the OTP on the new number",
  "modules/retention/retention.service.ts :: cleanupUnregisteredShopVisits :: businessVisit.updateMany :: data-spread":
    "anonymisation wipe values and the kept fields the retention job chose",
  "modules/signup-tracker/signup-tracker.service.ts :: applyStage :: signupTracker.update :: data-not-literal":
    "stage, assignment and event fields chosen by the tracker service",
  "modules/signup-tracker/signup-tracker.service.ts :: createCallTask :: signupTracker.updateMany :: data-spread":
    "stage, assignment and event fields chosen by the tracker service",
  "modules/signup-tracker/signup-tracker.service.ts :: event :: signupTrackerEvent.create :: data-spread":
    "stage, assignment and event fields chosen by the tracker service",
  "modules/staff/staff-setup.service.ts :: complete :: staff.updateMany :: data-spread":
    "set-up fields (password, TOTP, notice) chosen by the set-up flow after its checks",
  "modules/staff/staff.service.ts :: insertWithFreshCode :: staff.create :: data-not-literal":
    "build() callers pass explicit fields (createStaff), validated before",
  "modules/target/target.service.ts :: updateTarget :: target.update :: data-spread":
    "mergedMetrics: the target metric keys, each taken from the dto one by one and validated",
  "modules/telephony/inbound-call-router.service.ts :: route :: callbackTask.updateMany :: data-spread":
    "assignment fields from caller identification and the agent pick",
  "modules/trade/trade.service.ts :: createTrade :: trade.create :: data-spread":
    "validateTradeInput() returns the validated trade fields",
  "modules/trade/trade.service.ts :: updateTrade :: trade.update :: data-spread":
    "validateTradeInput() returns the validated trade fields",
  "modules/vacancy/candidate-introduction.service.ts :: shareByLink :: candidateIntroduction.createMany :: data-not-literal":
    "rows built from the matching results for the requested job seeker ids",
  "modules/vacancy/candidate-introduction.service.ts :: showInPerson :: candidateIntroduction.createMany :: data-not-literal":
    "rows built from the matching results for the requested job seeker ids",
  "modules/vacancy/vacancy.service.ts :: update :: vacancy.update :: data-not-literal":
    "AC-1 edit: built key by key from the pickEditableFields() allowlist and diff.changedFields (server-checked values only), plus the legal-minimum and reset-confirmation fields the service works out (M2)",
  "modules/vacancy/vacancy.service.ts :: create :: vacancy.create :: data-spread":
    "legal-minimum fields from VacancyConfirmationService and server status values",
  "modules/vacancy/vacancy.service.ts :: submitForConfirmation :: vacancy.updateMany :: data-spread":
    "legal-minimum fields from VacancyConfirmationService and server status values",

  // ---- M4-R1: raw SQL built from strings, and a delegate held in a variable ----
  'common/id/id.service.ts :: ensureSequenceExists :: $executeRawUnsafe :: raw-unsafe':
    'M4-R1: sequence name from getSequenceName(), which keeps only [a-z0-9_] of an entity prefix; no request value reaches it.',
  'common/id/id.service.ts :: syncSequenceUp :: $executeRawUnsafe :: raw-unsafe':
    'M4-R1: table, column and prefix come from the fixed sequence mapping in this file and the sanitised sequence name; no request value.',
  'common/id/id.service.ts :: generateCode :: $queryRawUnsafe :: raw-unsafe':
    'M4-R1: nextval() on the sanitised sequence name (only [a-z0-9_]); Postgres cannot bind an identifier as a parameter.',
  'common/id/id.service.ts :: generateCode :: $queryRawUnsafe :: raw-unsafe #2':
    'M4-R1: the same nextval() retry after creating the sequence; sanitised name only.',
  'common/observability/system-status.controller.ts :: buildReport :: $queryRawUnsafe :: raw-unsafe':
    "M4-R1: the constant 'SELECT 1' health probe; no value is put into it.",
  'health/health.service.ts :: checkDatabase :: $queryRawUnsafe :: raw-unsafe':
    "M4-R1: the constant 'SELECT 1' health probe; no value is put into it.",
  'modules/area/area.service.ts :: renameRecords :: delegate.updateMany :: delegate-in-variable':
    'M4-R1: loops the fixed LOCALITY_TABLES list; data is written out in place ({ locality: toName }) and the where is the fixed locality match. Benign.',
};
