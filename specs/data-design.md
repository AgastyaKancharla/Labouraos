# Laboura — Data Design v1

**Status:** Draft for Agastya's review, 2 November 2026. Nothing in this file is built yet.
**Source of truth for the rules:** the Laboura Master Guide (https://claude.ai/artifact/2bMss3tFEAZi1YUxdny5yX). If this file and the guide disagree, the guide wins and this file is fixed.
**Gap list it covers:** "Laboura — Code Check against the Master Guide" (https://claude.ai/artifact/LU6knsRzV89FPTX2vTmdMU) — 19 changes, 17 new features, 6 problems.

> Read this whole file before any task in the redesign phases. It is the one place every new table, column and status is defined, so later tasks never invent their own.

---

## 0. Design rules

1. **Additive first.** New columns are nullable or have defaults. Old columns are marked deprecated and removed only in the final clean-up migration (§14), after every service stops reading them.
2. **No backfill guessing.** Existing rows are test data. A guessed value is worse than an honest null.
3. **Money is integer paise.** Every amount column ends in `Paise`.
4. **Times are UTC in the database.** Day boundaries (day 30, day 60, 2 hours, 24 hours, 48 hours, 7 days) are computed with the existing `period-boundary` helper in Asia/Kolkata.
5. **Nothing computed is stored** unless stated. Eligibility, "money involved", profile completeness, pace and guarantee status are computed on read, as today.
6. **Statuses are strings with a documented closed list** (the current convention), validated in one place per entity (`<entity>.status.ts`), never as free text.
7. **Every rule number lives in `PricingPolicy`** (§2), never as a literal in a service.
8. **Personal data never goes into `AuditLog` or `StatusHistory` values.** Logs record *which* fields changed and the actor, not names, phone numbers or Aadhaar data.
9. **Full phone numbers are never returned to call agents, field agents or team leads.** Only the calling and messaging services read them.

---

## 1. Shared new tables

### `StatusHistory` — every status change, from day one (for the future customer apps)
| Column | Type | Notes |
| --- | --- | --- |
| id | uuid | |
| subjectType | string | job_seeker, business, vacancy, interview, placement, replacement_claim, payment, referral |
| subjectId | uuid | |
| fromStatus | string? | null on creation |
| toStatus | string | |
| changedByStaffId | uuid? | null = system |
| reason | string? | short, no personal data |
| changedAt | datetime | |

Index: (subjectType, subjectId, changedAt). Written in the same transaction as the status change, by one shared helper.

### `ReviewFlag` — anything a Team Lead or Manager must look at
| Column | Type | Notes |
| --- | --- | --- |
| id, code | | |
| kind | string | see list below |
| subjectType, subjectId | | |
| raisedForStaffId | uuid? | the agent involved, if any |
| details | json | no personal data |
| status | string | open, resolved, dismissed |
| raisedAt, resolvedAt | datetime | |
| resolvedByStaffId | uuid? | |
| resolution | string? | required when resolved or dismissed |

`kind` closed list: `duplicate_business`, `gps_mismatch`, `no_documents_check`, `interview_result_mismatch`, `interview_result_overdue`, `payment_overdue`, `payment_mismatch`, `business_many_rejections`, `agent_rejection_pattern`, `business_stopped_after_interviews`, `bypass_suspected`, `payout_name_mismatch`, `payout_shared_account`, `payout_matches_staff`, `odd_hour_login`, `screenshot_taken`, `hit_reversed`.

### `Consent` — one row per purpose, per person
| Column | Type | Notes |
| --- | --- | --- |
| id | uuid | |
| subjectType | string | job_seeker, business, referral, staff |
| subjectId | uuid | |
| purpose | string | job_matching, profile_sharing, call_recording, aadhaar_verification, job_updates, promotions (job seekers); agreement_terms, call_recording (businesses, referrals); gps_tracking, call_recording, data_use (staff) |
| granted | bool | |
| noticeVersion | string | version of the consent text shown |
| language | string | kn, hi, en |
| method | string | sms_link, in_app, contract |
| otpRequestId | string? | proof the person did it |
| grantedAt, withdrawnAt | datetime? | |

Unique: (subjectType, subjectId, purpose, noticeVersion). A job seeker can't move past `lead` without the five required purposes granted.

### `MessageLog` — every SMS and WhatsApp the system sends
| Column | Type | Notes |
| --- | --- | --- |
| id | uuid | |
| channel | string | sms, whatsapp |
| template | string | DLT / WhatsApp template name |
| subjectType, subjectId | | who it went to |
| relatedType, relatedId | | interview, placement, offer, consent… |
| providerMessageId | string? | |
| status | string | queued, sent, delivered, read, failed |
| sentAt, deliveredAt, failedAt | datetime? | |

No message body stored — the template name plus the related record recreate it.

### `CallRecord` — every call, as reported by the calling company
| Column | Type | Notes |
| --- | --- | --- |
| id, code | | |
| provider, providerCallId | string | unique together |
| direction | string | outbound, inbound |
| staffId | uuid? | the agent whose phone was rung |
| subjectType, subjectId | | job_seeker, business, referral |
| purpose | string | offer, follow_up, verification, exit_call, check_in, interview_result, refund_check, general |
| relatedType, relatedId | | interview, placement, claim… |
| providerStatus | string | completed, no_answer, busy, failed, canceled — **from the webhook only** |
| answered | bool | from the webhook only |
| startedAt, answeredAt, endedAt | datetime? | |
| durationSec | int? | |
| recordingStoragePath | string? | Laboura's own copy (Supabase storage), never the provider URL alone |
| recordingDeletedAt | datetime? | set by the clean-up job (§13) |
| announcementPlayed | bool | |
| agentOutcome | string? | answered calls only: interested, accepted_offer, rejected_offer, callback_requested, not_interested, working_now, other |
| agentOutcomeReason | string? | |
| agentOutcomeAt | datetime? | |

Rules: `providerStatus` and `answered` are written only by the webhook handler. An agent can set `agentOutcome` only when `answered = true`. Calls can only be started 09:00–21:00 IST and inside the candidate's preferred window.

---

## 2. `PricingPolicy` — fixes Problem 2 and 3

Replace the in-memory policy with a table. One row per version; the newest row with `effectiveFrom <= now` applies. Only the CEO writes.

| Column | Value today |
| --- | --- |
| activationFeePaise | 49900 (no GST added) |
| placementFeePercent | 50 |
| gstPercent | 18 |
| referralPayoutPaise | 20000 |
| joiningRewardPaise | 20000 |
| joiningRewardAfterDays | 30 |
| jobSeekerGuaranteeDays | 30 |
| offerReplyHours | 48 |
| maxHits | 3 |
| interviewResultDeadline | "20:00" — same day as the interview (walk-ins run 10:30–18:00) |
| interviewResultEscalateHours | 24 |
| placementPaymentDueHours | 24 |
| replacementWindowDays | 60 |
| replacementSearchDays | 15 |
| maxFreeReplacements | 2 |
| maxReplacementRejections | 2 |
| claimReportDays | 7 |
| claimDecisionHours | 48 |
| noBypassMonths | 12 |
| noBypassPenaltyPercent | 50 |
| payoutDetailsCoolingHours | 48 |
| idleLogoutMinutes | 60 |
| maxSessionMinutes | 120 |
| loginCodeValidMinutes | 5 |
| failedLoginLimit | 5 |
| lockoutMinutes | 15 |
| callingHoursStart / End | "09:00" / "21:00" |

Plus `effectiveFrom`, `setByStaffId`, `createdAt`. Every service reads values through `PricingService.current()`. Every money record (`Placement`, `Payment`) keeps a copy of the amounts it was created with, so a later price change never alters an old record.

---

## 3. Staff, login and devices

### `Staff` — changes
| Column | Change |
| --- | --- |
| email | becomes **nullable** — only CEO, Manager, Finance have one |
| code | becomes the **login identifier** |
| callRoutingPhone | **new**, string? — the number the calling company rings (field agents' own phones, office lines). Stored encrypted; never returned by any API |
| worksFromOffice | **new**, bool, default false |
| failedLoginCount | **new**, int, default 0 |
| lockedUntil | **new**, datetime? |
| lockedByStaffId / lockedReason | **new** — the one-tap lock |
| totpSecret / totpEnabled | kept; **required only for ceo, manager, finance** |
| area | **deprecated** — no areas (change 11) |
| registeredDeviceId | **deprecated** — replaced by `StaffDevice` |

### `StaffDevice` — new
| Column | Type | Notes |
| --- | --- | --- |
| id | uuid | |
| staffId | uuid | |
| deviceId | string | from the app or browser |
| label, platform | string | "Office PC 3", android, ios, web |
| status | string | pending, approved, revoked |
| requestedAt, approvedAt, revokedAt, lastSeenAt | datetime? | |
| approvedByStaffId, revokedByStaffId | uuid? | team lead or above, never self |

Unique: (staffId, deviceId). Login from a device that is not `approved` is refused, for **every** role, and a missing deviceId is refused (fixes Problem 4).

### `LoginCodeRequest` — new (the login code screen)
| Column | Type | Notes |
| --- | --- | --- |
| id | uuid | |
| staffId, staffDeviceId | uuid | |
| ipAddress | string | |
| onOfficeNetwork | bool | |
| status | string | pending, revealed, used, expired, refused |
| createdAt, expiresAt | datetime | expiresAt = createdAt + loginCodeValidMinutes |
| revealedByStaffId, revealedAt | | who tapped **Show code** |
| usedAt | datetime? | |
| refusedByStaffId, refusedReason | | |

**The code itself is never stored.** It is `HMAC(LOGIN_CODE_SECRET, requestId)` reduced to 6 digits, recomputed when an approver taps Show code and when the staff member types it. Who may reveal: the staff member's team lead, any manager, the CEO — never the staff member. Management roles skip this and use TOTP.

### `OfficeNetwork` — new
`id`, `label`, `cidr`, `active`, `addedByStaffId`, `createdAt`. A staff member with `worksFromOffice = true` is refused unless the request IP is inside an active range.

### `StaffSession` — changes
| Column | Change |
| --- | --- |
| lastActivityAt | **new** — refreshed on each request |
| absoluteExpiresAt | **new** — login + maxSessionMinutes |
| endedReason | **new** — logout, idle, max_length, replaced, locked, revoked |
| loginCodeRequestId | **new** |

One active session per staff member: a new login ends the others with `endedReason = replaced`. A short-lived access token is renewed silently while `lastActivityAt` is within idleLogoutMinutes and before `absoluteExpiresAt` (fixes the 15-minute hard logout).

### Login secret — fixes Problem 6
Remove the default value for `JWT_SECRET`. If it is missing or shorter than 32 characters, the server refuses to start.

---

## 4. Job seekers

### `JobSeeker` — changes
| Column | Change |
| --- | --- |
| status | new closed list: `lead`, `consented`, `pending_activation`, `active`, `paused`, `deactivated`, `placed` |
| dateOfBirth | **new**, date — required before `pending_activation`; must be 18+ |
| gender | **new**, string? — never on public cards |
| whatsappPhone | **new**, string? |
| photoStoragePath, photoTakenAt | **new** — taken in the app, consent required |
| locality, pincode, latitude, longitude | **new** — home area for distance; never shown exactly |
| travelDistanceKm | **new**, int |
| preferredLocalities | **new**, string[] |
| willingToRelocate, needsAccommodation | **new**, bool? |
| salaryPeriod | **new** — monthly, daily (applies to minSalary/maxSalary) |
| availableFrom | **new**, date |
| lookingSince | **new**, date — "how long looking" is computed from it |
| shiftPreference | **new** — day, night, rotational, any |
| jobType | **new** — full_time, part_time, live_in |
| currentlyWorking, lastEmployer, lastRole, lastSalaryPaise | **new**, optional |
| educationLevel, certificates[] | **new**, optional |
| drivingLicenceType, ownVehicle, policeVerified, hasSmartphone | **new**, optional |
| cvStoragePath, keySkills[], qualification, currentSalaryPaise | **new**, white-collar, optional |
| pausedAt | **new** — consent withdrawn |
| anonymisedAt | replaces `erasedAt` meaning (§13) |
| tradeSkill | **deprecated** — moves to `JobSeekerTrade` |
| kycStatus, kycReference | **deprecated** — move to `IdentityVerification` |

Profile completeness is computed on read from the optional fields; not stored.

### `JobSeekerTrade` — new
`jobSeekerId`, `trade`, `yearsExperience`, `isPrimary`. Max 3 per job seeker, exactly one primary.

### `JobSeekerLanguage` — new
`jobSeekerId`, `language`, `speaks`, `reads`, `writes`.

### `IdentityVerification` — new (Aadhaar result only)
| Column | Type | Notes |
| --- | --- | --- |
| id | uuid | |
| jobSeekerId | uuid | |
| method | string | digilocker, aadhaar_qr, pan, driving_licence, voter_id |
| vendor, vendorReference | string | |
| status | string | pending, verified, failed |
| last4 | string? | last 4 digits only |
| nameMatches | bool? | |
| isAdult | bool? | |
| verifiedAt, failureReason | | |

**Never stored anywhere:** full Aadhaar number, Aadhaar XML or PDF, Aadhaar photo, Aadhaar address. The existing `assertNoRawAadhaar` guard stays on every input.

### `JobSeekerHit` — changes
| Column | Change |
| --- | --- |
| reason | closed list: `no_pickup`, `offer_declined`, `offer_no_reply`, `interview_no_show` (replaces `offer_rejected`) |
| interviewId | **new** — the offer or interview it came from |
| callRecordId | **new** — the recording that backs it |
| reversedAt, reversedByStaffId, reversalReason | **new** — team lead reversal; raises a `hit_reversed` ReviewFlag to CEO and Manager |

A reversed hit doesn't count towards `maxHits` or refund rules. **Any** non-reversed hit of kind `offer_declined`, `offer_no_reply` or `interview_no_show` ends the refund (change 13).

### `ContactAttempt` — changes
Kept for the 3-hit no-pickup rule, but **created only by the system**: from a `CallRecord` webhook (calls) or a `MessageLog` send (WhatsApp/SMS). New columns `callRecordId`, `messageLogId`. The agent endpoint that types `picked_up`/`no_pickup` is removed (change 9).

---

## 5. Businesses

### `Business` — changes
| Column | Change |
| --- | --- |
| name | stays — the trading name |
| legalName | **new** |
| ownerName | **new** (owner = the business owner) |
| phone | stays — owner's mobile, OTP verified |
| additionalContactName, additionalContactPhone | **new** (`contactName` deprecated) |
| businessType | **new** — restaurant, retail, factory, office, warehouse, household, other |
| employeeCount | **new**, int |
| staffNeeded | **new**, string[] |
| licenceNumber, shopEstablishmentNumber, udyamNumber, pan | **new**, optional |
| gstNumber | stays; plus **new** gstVerified, gstLegalName, gstStatus, gstCheckedAt |
| yearsInOperation, hiringFrequency | **new**, optional |
| billingName, billingAddress | **new** |
| storefrontPhotoPath, storefrontPhotoHash, storefrontPhotoLive | **new** — taken in the app's camera |
| documentsStatus | **new** — `documented` or `no_documents` (computed at save from the registration numbers, stored because it drives a check) |
| verificationStatus | **new** — `lead`, `pending_visit`, `pending_tl_check`, `verified`, `rejected` |
| verifiedAt, verifiedByStaffId | **new** |
| accountAgentId, accountAgentAssignedAt | **new** — the account agent |
| leadCreatedByStaffId, leadChannel | **new** — field_visit, phone_call |
| locality | **new** — filled from GPS; replaces `area` |
| area | **deprecated** |
| selfieUrl / selfieHash | moved to `BusinessVisit` only |

Rule: no candidate is shown to a business unless `verificationStatus = verified`.

### `BusinessAgreement` — new
`businessId`, `version`, `termsHash`, `noBypassMonths`, `noBypassPenaltyPercent`, `feePercent`, `signedName`, `signedPhone` (masked copy), `otpRequestId`, `signedAt`, `documentStoragePath`. A business can't be `verified` without a signed agreement.

### `VisitAssignment` — new
| Column | Notes |
| --- | --- |
| businessId | |
| purpose | verification, revisit, interview_attendance, follow_up |
| suggestedStaffId | nearest available field agent, from the app |
| assignedStaffId, assignedByStaffId | team lead confirms or changes |
| status | pending, assigned, done, cancelled |
| relatedType, relatedId | e.g. the interview to attend |
| visitId | the `BusinessVisit` that completed it |

### `BusinessVisit` — changes
**New:** `purpose`, `ownerOtpRequestId`, `photoLive` bool, `assignmentId`. Existing GPS, selfie and duplicate-selfie checks stay.

### `FieldCheckIn` — new
`staffId`, `latitude`, `longitude`, `accuracyMeters`, `checkedInAt`. Location is recorded at events only — check-in, visits, calls — never continuously.

---

## 6. Vacancies

### `Vacancy` — changes
| Column | Change |
| --- | --- |
| roleTitle | **new** |
| tradeSkill | stays |
| offeredSalary | **renamed** salaryMinPaise; **new** salaryMaxPaise, salaryPeriod |
| extras | **new**, string[] — overtime, incentives, food, accommodation, transport, uniform, pf_esi |
| workingHours, shift, weeklyOff | **new** |
| latitude, longitude, locality | **new** — job location, may differ from the business |
| experienceRequiredYears, educationRequired | **new** |
| languagesRequired, licencesRequired | **new**, string[] |
| ageMin, ageMax | **new**, optional |
| genderRequirement, genderReason | **new**, optional, reason required |
| startDate, urgency | **new** |
| probationDays | **new** |
| interviewType | **new** — walk_in, scheduled |
| interviewContactName | **new** |
| capturedChannel | **new** — field_visit, phone_call |

### `VacancyInterviewSlot` — new
`vacancyId`, `startsAt`, `endsAt`, `capacity`. **Default (decided 2 Nov): walk-in, 10:30 AM to 6:00 PM** on the chosen day; fixed times are possible but not the default. The interview result is due by `interviewResultDeadline` (8:00 PM) the same day.

---

## 7. Matching

### `CandidateIntroduction` — new (the proof for the no-bypass clause)
| Column | Notes |
| --- | --- |
| businessId, vacancyId, jobSeekerId | |
| shownByStaffId | |
| shownAt | |
| rank, score | |
| matchReasons | json — why they matched |

Unique: none — every showing is logged. The no-bypass window runs from the **first** `shownAt` for that business and job seeker. The matching engine itself is code, not data: filters and ranking from the guide, computed on read.

---

## 8. Offers and interviews — the new flow (change 14)

### `Interview` — new
| Column | Type | Notes |
| --- | --- | --- |
| id, code | | |
| vacancyId, businessId, jobSeekerId | uuid | |
| slotStartsAt, slotEndsAt | datetime | |
| proposedByStaffId, proposedAt | | |
| suitabilitySnapshot | json | the checks that passed: trade, salary, distance, shift, real slot — evidence the offer was suitable |
| status | string | `offered`, `confirmed`, `declined`, `no_reply`, `completed`, `no_show`, `cancelled` |
| offerSentAt | datetime | call + SMS + WhatsApp (MessageLog ids) |
| replyDueAt | datetime | offerSentAt + offerReplyHours |
| candidateRespondedAt | datetime? | |
| businessDetailsSentAt | datetime? | name and address sent only once `confirmed` |
| agentAttendanceRequired | bool | first interview with a business, `no_documents`, or flagged |
| attendanceVisitId | uuid? | |
| result | string? | `selected`, `not_selected`, `candidate_no_show` |
| resultReason | string? | closed list: skills, experience, communication, salary_expectation, not_suitable, other |
| resultOtpRequestId | string? | the owner's OTP |
| resultDueAt | datetime | 8:00 PM IST on the interview day (`interviewResultDeadline`) |
| resultRecordedAt | datetime? | |
| candidateCheckAnswer | string? | offered_yes, offered_no, no_answer — asked at the same time |
| candidateCheckAt | datetime? | |

Rules:
- An `Interview` in status `offered` **is "the offer"** for the 30-day guarantee.
- `declined` → hit `offer_declined`. `no_reply` after documented attempts → hit `offer_no_reply`. `no_show` → hit `interview_no_show`. All three end the refund.
- `result = not_selected` is never a hit, and that business is never shown that candidate again.
- Owner says `not_selected` and candidate says `offered_yes` → `interview_result_mismatch` flag.
- No result by `resultDueAt` → the agent is asked to call; no result 24 hours after the slot → `interview_result_overdue` flag to the team lead.

### `Placement` — changes
| Column | Change |
| --- | --- |
| interviewId | **new** — every placement comes from a `selected` interview |
| status | new closed list: `awaiting_payment`, `cancelled`, `confirmed`, `active`, `dropped_out`, `replaced`, `completed`, `guarantee_ended` |
| selectedAt, paymentDueAt, paidAt | **new** — paymentDueAt = selectedAt + placementPaymentDueHours |
| joiningDate | **new** — confirmed to the candidate only after `paidAt` |
| rootPlacementId | **new** — the original placement; same for its replacements |
| replacementNumber | **new** — 0 original, 1 first replacement, 2 second |
| feePercentAtCreation, gstPercentAtCreation | **new** — policy snapshot |
| guaranteeEndedReason | **new** — two_rejections, second_replacement_left, refunded |
| clockPaused, clockPausedAt, replacementRejectionCount | **deprecated** — replaced by the rules below |

Rules:
- The job seeker becomes `placed` when the fee is **paid**, not before.
- Unpaid at `paymentDueAt` → `payment_overdue` flag; the joining date is not confirmed.
- The 60-day guarantee runs from the **root** placement's joinedDate, for the original and every replacement. It never restarts.
- At most `maxFreeReplacements` (2) replacements per root. If the second replacement also leaves → `guarantee_ended`, reason `second_replacement_left`, no refund.
- The business rejects `maxReplacementRejections` (2) replacement candidates → `guarantee_ended`, reason `two_rejections`, no refund.
- No replacement within `replacementSearchDays` (15) of an accepted claim → flat 100% refund (approved by CEO or Finance).

### `ReplacementCandidate` — stays, plus `interviewId`.

---

## 9. Replacement claims (change 16)

### `ReplacementClaim` — new (replaces "record dropout")
| Column | Type | Notes |
| --- | --- | --- |
| id, code | | |
| placementId | uuid | |
| workerLeftOn | date | |
| reportedAt | datetime | must be within claimReportDays of workerLeftOn |
| reportedWithinDeadline | bool | |
| feePaidInFull | bool | checked at report time |
| reason | string | closed list: `resigned`, `absconded_3_days`, `never_joined`, `serious_misconduct`, `repeated_absence`, `skill_gap_15_days`, `misrepresentation` (accept list); `business_closed`, `role_changed`, `salary_unpaid`, `unsafe_workplace`, `fired_without_reason`, `hired_own_person` (reject list) |
| evidencePaths | string[] | |
| exitCallRecordId | uuid? | the recorded call with the worker |
| decision | string? | accepted, rejected |
| decisionReason | string? | required |
| decidedByStaffId, decidedAt | | team lead or manager |
| decisionDueAt | datetime | reportedAt + claimDecisionHours |
| overruledByStaffId, overruleReason | | manager only |

A late report or an unpaid fee is rejected automatically, with the reason recorded.

---

## 10. Money out: refunds, payouts and the joining reward

### `Payment` — changes (money collected by UPI straight into the company account — decided 2 Nov)
| Column | Change |
| --- | --- |
| type | add `joining_reward` |
| method | **new** — `upi_direct` (default for everything), `gateway_card` (only when the payer chooses to pay by card — decided 2 Nov) |
| upiReference | **new** — the reference put in the QR code or UPI link (the candidate or placement code plus a short suffix); unique |
| expectedAmountPaise | **new** — the exact amount in the QR code |
| bankUtr | **new**, unique — the 12-digit UPI reference from the bank credit (incoming) or from Finance's transfer (outgoing) |
| confirmedBy | **new** — `bank_feed` (automatic) or `finance_manual` |
| confirmedByStaffId, confirmedAt | **new** — who matched it, for manual confirmation |
| approvedByStaffId, approvedAt | **new** — every refund, payout and reward is released by a person |
| payoutAccountId | **new** — for money going out |

Rules:
- A payment is `succeeded` only when the money is seen in the company bank account — by the bank's automatic notification if the bank offers one, otherwise by Finance matching the UTR against the bank statement. **A screenshot is never accepted.** The payer may type their UTR in to speed up matching; it is only a hint until Finance or the bank feed confirms it.
- The 30-day clock starts at `confirmedAt` (when the money is confirmed), and the placement joining date is confirmed only after it.
- An amount that doesn't match `expectedAmountPaise` is not auto-confirmed; it raises a `payment_mismatch` ReviewFlag (add to the §1 list).
- Outgoing money (refunds, payouts, rewards) is sent by UPI from the company account by the CEO or Finance, who record the UTR. The UPI app shows the receiver's name before sending; Finance confirms it matches `PayoutAccount.verifiedName`.

Release rule: `refund`, `referral_payout` and `joining_reward` can only be released by **ceo or finance** (change 17).

Joining reward: queued when the placement has been `active` for `joiningRewardAfterDays` (30) and the worker is still there; released manually.

### `PayoutAccount` — new (fixes Problem 5)
| Column | Type | Notes |
| --- | --- | --- |
| id | uuid | |
| ownerType, ownerId | | referral, job_seeker |
| method | string | upi, bank |
| maskedValue | string | part of the UPI ID, or the last 4 digits |
| verifiedName | string? | the name the UPI app or bank shows for the account |
| nameMatches | bool? | |
| upiIdEncrypted / bankAccountEncrypted, ifsc | string? | needed now that Finance pays directly; stored encrypted, never returned to agents, shown in full only to CEO and Finance at the moment of paying |
| providerContactId, providerFundAccountId | string? | only if a payout company is used later |
| status | string | pending_validation, verified, flagged, superseded |
| validatedAt | datetime? | |
| activeFrom | datetime | creation + payoutDetailsCoolingHours when it replaces an earlier account |
| changeOtpRequestId | string? | |
| createdByStaffId | uuid | |

Fraud checks raise `payout_name_mismatch`, `payout_shared_account` or `payout_matches_staff`.

---

## 11. Bypass checks

### `FollowUpTask` — new
| Column | Notes |
| --- | --- |
| kind | not_selected_day_7, not_selected_day_30, not_selected_day_90, placement_check_in_day_7, placement_check_in_day_30, refund_check, exit_call |
| subjectType, subjectId | |
| relatedType, relatedId | interview, placement, claim |
| dueAt | |
| assignedStaffId | |
| status | pending, done, missed |
| callRecordId | |
| answer | working_at_introduced_business, working_elsewhere, not_working, no_answer |
| answerBusinessId | if they name a business |

`working_at_introduced_business` for a business that never paid → `bypass_suspected` flag, and the refund (if any) is blocked. A daily job creates the tasks and the pattern flags (`business_many_rejections`, `agent_rejection_pattern`, `business_stopped_after_interviews`).

---

## 12. Corrections

### `AuditLog` — changes
| Column | Change |
| --- | --- |
| reason | **new**, string? — required for every edit by a team lead or above, and for every hit reversal |
| changedFields | **new**, string[] |
| before / after | kept, but **personal fields are written as `"[changed]"`, never their values** (fixes Problem 1) |

Edit rule, enforced in one shared guard: an agent can edit their own records until "money is involved" (a `Payment` succeeded for the job seeker, or the placement is `confirmed` or later). After that only a team lead or above can edit. Payments, `CallRecord` provider fields, recordings, `AuditLog` and `StatusHistory` are never editable by anyone.

---

## 13. Keeping data (change 18)

A daily `retention-cleanup` job, its periods in code next to the `PricingPolicy` constants and listed in the master guide:

| Data | Kept | Then |
| --- | --- | --- |
| Payments, invoices, refunds, payouts | 8 years | deleted |
| Job seeker profile | active + 23 months after last activity (decided 2 Nov) | anonymised: name, phones, photo, DOB, exact location removed; `anonymisedAt` set |
| Business, referral partner | active + 23 months | anonymised |
| Identity verification | result only, always | — |
| Call recordings | 1 year, or until a dispute on that placement closes | file deleted, `recordingDeletedAt` set |
| Login and access logs | 1 year | deleted |

The existing `erase` endpoint becomes "anonymise now", sharing the same code, and stops copying values into the log.

---

## 14. What is removed at the end

Only after every service has moved to the new columns, in one final clean-up migration:
`JobSeeker.tradeSkill`, `kycStatus`, `kycReference`, `erasedAt`; `Business.area`, `contactName`, `selfieUrl`, `selfieHash`; `Staff.area`, `registeredDeviceId`; `Placement.clockPaused`, `clockPausedAt`, `replacementRejectionCount`; `Vacancy.offeredSalary` (renamed); the agent contact-attempt endpoint; the area scope in the permissions matrix.

---

## 15. Permissions matrix changes

| Role | Resource | Today | New |
| --- | --- | --- | --- |
| field_agent | business, vacancy, placement | own_area | read: all; write: own_account (businesses where they are the account agent) |
| call_agent | business | write all | read all; write: lead creation only; may add vacancies to any business |
| team_lead | staff devices, login codes, unlock | — | own_team |
| finance | payment release | write | release refunds, payouts, rewards |
| manager | payment release | write | **no** release |

`own_area` is removed. `own_account` is new: matches `Business.accountAgentId` (and the business of a vacancy, interview or placement).

---

## 16. Order this is built in

Matches the "Suggested build order" in the code check doc. Each step is its own phase with its own spec:

1. Rulebook rewrite (AGENTS.md from the master guide) + Problems 1–6 + `PricingPolicy` (§2) + `StatusHistory`, `ReviewFlag` (§1)
2. Login and devices (§3)
3. Calling and messages: `CallRecord`, `MessageLog`, system-only `ContactAttempt` (§1, §4)
4. Job seeker registration: `Consent`, new fields, `JobSeekerTrade`, `JobSeekerLanguage`, `IdentityVerification` (§4)
5. Businesses and vacancies: new fields, `BusinessAgreement`, `VisitAssignment`, `FieldCheckIn`, `VacancyInterviewSlot`, permissions (§5, §6, §15)
6. Matching and the map: `CandidateIntroduction` (§7)
7. Offers and interviews to joining: `Interview`, new `Placement` flow (§8)
8. After joining: `ReplacementClaim`, joining reward, `FollowUpTask` (§9, §10, §11)
9. `PayoutAccount` (§10)
10. Corrections and retention (§12, §13), then the final clean-up (§14)
11. Field agent app, on top of all of the above

---

## 17. Open points for Agastya

1. ~~Direct bank transfer~~ — **decided 2 Nov:** all money by UPI straight into the company current account (§10); a payment gateway only for card payments. Still open: which bank, and whether it offers a "UPI Collection API with real-time callback" (otherwise Finance matches by hand).
2. ~~Interview slots~~ — **decided 2 Nov:** walk-in, 10:30 AM–6:00 PM by default (§6); result due by 8:00 PM the same day.
3. ~~Candidate's UPI for the joining reward~~ — **decided 2 Nov:** collected at joining, with the same name check.
4. ~~Retention~~ — **decided 2 Nov:** 23 months after last activity; the lawyer can change the number later (§13).
