# Phase 12 — Consent and Job Seeker Registration

**Goal:** a job seeker cannot be matched to any job, called, or have their Aadhaar checked until they have given written consent for each required purpose. Consent is recorded as proof — not a tick an agent makes on their behalf. The job seeker's profile gets the new fields the matching and screening redesign needs.

**Why this is next:** step 4 of the build order in `specs/data-design.md` §16. Builds the `Consent` table from §1, and the `JobSeeker` changes, `JobSeekerTrade`, `JobSeekerLanguage`, `IdentityVerification` and `JobSeekerHit` changes from §4.

**How consent is captured (confirmed with Agastya):** the agent explains consent out loud on a recorded call (Phase 11's `CallRecord` already proves this happened), then the system sends the job seeker a one-time link by SMS to a consent page. The job seeker opens it, reads the notice in their language, is OTP-verified on their own phone, ticks the required purposes, and submits. That submit is the consent record — not the call.

**Out of scope — do not build:** business and referral-partner consent screens (the `Consent` table already supports `subjectType: business/referral` — just don't wire any UI or gating for them yet; that comes with their own onboarding phase). Staff consent (`gps_tracking`, `data_use`). Interviews, offers, placements, replacement claims. The field agent native app. The retention clean-up job.

**Read first:** `AGENTS.md`, `LESSONS.md`, this whole spec, `specs/data-design.md` §1 (`Consent`) and §4 (all of it). `assertNoRawAadhaar` already exists in the codebase — read it before building `IdentityVerification`.

---

## How this phase runs — waves

| Wave | Tasks | Run |
| --- | --- | --- |
| 1 | Task 1 (Consent table and service), Task 2 (JobSeeker new fields and status list), Task 3 (JobSeekerTrade, JobSeekerLanguage) | Together, or one after another |
| 2 | Task 4 (consent capture page and OTP), Task 5 (IdentityVerification) | Together, or one after another |
| 3 | Task 6 (JobSeekerHit changes), Task 7 (deprecate old fields) | Together, or one after another |

Each task has its own branch and a fixed migration folder name. Build on the latest `main`, push, wait for GitHub Actions to pass **on the branch**, fix failures on the branch, then merge — one branch at a time, rebasing on the latest `main` first. Locally run only the tests for your own change; GitHub runs the full suite.

---

## Wave 1

### [x] Task 1 — Consent table and service
**Branch:** `phase-12/task-1-consent` · **Migration folder:** `20261105100000_add_consent`

**Acceptance:**
- `Consent` table exactly as `specs/data-design.md` §1, with unique `(subjectType, subjectId, purpose, noticeVersion)`.
- `purpose` closed list for job seekers: `job_matching`, `profile_sharing`, `call_recording`, `aadhaar_verification`, `job_updates`, `promotions`. The **five required** ones are all of these except `promotions` — `promotions` is optional and never blocks anything.
- `ConsentService.grant({ subjectType, subjectId, purpose, noticeVersion, language, method, otpRequestId })` and `.withdraw({ subjectType, subjectId, purpose })`. Granting sets `grantedAt`; withdrawing sets `withdrawnAt` and does not delete the row (history stays).
- `ConsentService.hasAllRequired(subjectType, subjectId)` — true only when every required purpose for that `subjectType` has a row with `grantedAt` set and `withdrawnAt` null.
- A withdrawal of `call_recording` or `job_matching` by an **active** job seeker moves their `JobSeeker.status` to `paused` and sets `pausedAt` (data-design §4). Withdrawing `promotions` or `job_updates` changes nothing else.
- Tests: granting all five required purposes returns `hasAllRequired = true`; missing one returns false; `promotions` alone never returns true; withdrawing `call_recording` on an active job seeker pauses them; a repeat grant of the same purpose and notice version does not create a second row; granting a new `noticeVersion` after a notice change creates a new row rather than overwriting the old one.

### [x] Task 2 — JobSeeker new fields and status list
**Branch:** `phase-12/task-2-jobseeker-fields` · **Migration folder:** `20261105110000_jobseeker_profile_fields`

**Acceptance:**
- All new `JobSeeker` columns from data-design §4 (`dateOfBirth`, `gender`, `whatsappPhone`, `photoStoragePath`, `photoTakenAt`, `locality`, `pincode`, `latitude`, `longitude`, `travelDistanceKm`, `preferredLocalities`, `willingToRelocate`, `needsAccommodation`, `salaryPeriod`, `availableFrom`, `lookingSince`, `shiftPreference`, `jobType`, `currentlyWorking`, `lastEmployer`, `lastRole`, `lastSalaryPaise`, `educationLevel`, `certificates`, `drivingLicenceType`, `ownVehicle`, `policeVerified`, `hasSmartphone`, `cvStoragePath`, `keySkills`, `qualification`, `currentSalaryPaise`, `pausedAt`), all nullable, no backfill.
- New `status` closed list: `lead`, `consented`, `pending_activation`, `active`, `paused`, `deactivated`, `placed`, validated in `job-seeker.status.ts`. Existing statuses map: anything currently `active`-equivalent stays `active`; nothing is guessed beyond a direct rename.
- `dateOfBirth` is required and the job seeker must be 18+ before status can move to `pending_activation` or beyond — enforced in the service, not just the database.
- `tradeSkill`, `kycStatus`, `kycReference` are marked `@deprecated` in the schema comment but **not removed** (design rule 1). Nothing reads them yet in new code.
- A status move from `lead` to `consented` is only allowed through `ConsentService.hasAllRequired` returning true (wire the actual transition in Task 4, once the capture page exists — this task just builds the guard and a service method that checks it and throws if called early).
- Tests: a job seeker under 18 can't reach `pending_activation`; the old status values still read correctly after migration; the deprecated columns are untouched by any new code path; attempting `lead → consented` without all required consents throws.

### [x] Task 3 — JobSeekerTrade and JobSeekerLanguage
**Branch:** `phase-12/task-3-trade-language` · **Migration folder:** `20261105120000_jobseeker_trade_language`

**Acceptance:**
- `JobSeekerTrade`: `jobSeekerId`, `trade`, `yearsExperience`, `isPrimary`. Max 3 per job seeker, exactly one `isPrimary = true` when any row exists, enforced in the service (not just a constraint).
- `JobSeekerLanguage`: `jobSeekerId`, `language`, `speaks`, `reads`, `writes`.
- `CRUD` endpoints for both, scoped the same way the job seeker profile itself is scoped today (field agent on their own captured leads, Team Lead/Manager/CEO on their team/all).
- Tests: a 4th trade is refused; changing primary trade un-sets the old primary; a language row with all three of speaks/reads/writes false is still valid (can't read/write but speaks).

---

## Wave 2 (after Wave 1 is merged)

### [x] Task 4 — The consent capture page and OTP
**Branch:** `phase-12/task-4-consent-capture` · **No migration**

**Acceptance:**
- `POST /consent/links` (call agent, field agent, Team Lead, Manager, CEO): `{ jobSeekerId }` → generates a short-lived, single-use token and sends it by SMS through `MessagingService` (Phase 11) using a new template, e.g. `consent_link`. No phone number in the response.
- The consent page (public, token in the URL, no login) shows the notice text for each required purpose in the job seeker's `preferredLanguage` (kn, hi, en), plus the optional `promotions` checkbox, separately tickable.
- Before showing the final submit button, the page requires an OTP sent to the job seeker's own registered phone (reuse the existing OTP/SMS infrastructure). The verified OTP request becomes `Consent.otpRequestId`.
- `POST /consent/submit` with the token: verifies the token hasn't expired or been used, verifies the OTP, then calls `ConsentService.grant(...)` once per ticked purpose with `method: 'sms_link'`, the current `noticeVersion`, and the job seeker's language. After granting, if all five required purposes are now granted, the job seeker's status moves `lead → consented`.
- A used or expired token is refused with a clear message, not a 500.
- Add `consent_explain` to the `CallRecord.purpose` closed list (data-design §1), so the agent's explanatory call can be tagged distinctly from a general call. No schema change — just the closed-list file.
- Tests: a full tick-and-submit moves status to `consented`; ticking only 4 of 5 required leaves status at `lead`; an expired token is refused; a reused token is refused; the OTP must match before submit succeeds; the job seeker's phone number never appears in the page's own API responses to agents (only to the job seeker's own browser, which already has it since they're the one who received the SMS).

### [ ] Task 5 — IdentityVerification
**Branch:** `phase-12/task-5-identity-verification` · **Migration folder:** `20261105130000_add_identity_verification`

**Acceptance:**
- `IdentityVerification` table exactly as data-design §4. `method`: `digilocker`, `aadhaar_qr`, `pan`, `driving_licence`, `voter_id`.
- Every write path runs through the existing `assertNoRawAadhaar` guard — extend its call sites to cover this table's inserts if it isn't already wired in generically.
- `status`: `pending`, `verified`, `failed`. `last4`, `nameMatches`, `isAdult` are the only Aadhaar-derived facts ever stored.
- Verification can only be requested (`POST /job-seekers/:id/identity-verification`) once `Consent.aadhaar_verification` is granted for that job seeker — refused otherwise.
- `JobSeeker.kycStatus`/`kycReference` are not written to by this new code path (Task 2 already marked them deprecated).
- Tests: a verification request without the `aadhaar_verification` consent is refused; a full Aadhaar number anywhere in a request body is rejected by the guard, by test, not just by convention; only `last4` is ever persisted; `nameMatches` and `isAdult` round-trip correctly.

---

## Wave 3 (after Wave 2 is merged)

### [ ] Task 6 — JobSeekerHit changes
**Branch:** `phase-12/task-6-hit-changes` · **Migration folder:** `20261105140000_jobseeker_hit_changes`

**Acceptance:**
- `reason` closed list: `no_pickup`, `offer_declined`, `offer_no_reply`, `interview_no_show` (replaces `offer_rejected` — existing rows with the old value are read-mapped, not rewritten).
- New columns: `interviewId`, `callRecordId`, `reversedAt`, `reversedByStaffId`, `reversalReason`.
- `POST /job-seeker-hits/:id/reverse` (Team Lead, Manager, CEO only): sets the reversal fields, and raises a `hit_reversed` `ReviewFlag` addressed to CEO and Manager (Phase 6.7's `ReviewFlagService`).
- A reversed hit is excluded from `maxHits` and from refund-eligibility counting wherever hits are summed today.
- Any **non-reversed** hit of kind `offer_declined`, `offer_no_reply` or `interview_no_show` ends the refund window immediately (change 13 in the code-check doc) — wire this into whatever currently computes refund eligibility.
- Tests: a reversed hit doesn't count toward `maxHits`; reversing raises exactly one `ReviewFlag`; a non-reversed `interview_no_show` ends refund eligibility immediately; the old `offer_rejected` value on existing rows still reads without error.

### [ ] Task 7 — Deprecate old fields, nothing removed yet
**Branch:** `phase-12/task-7-deprecate-old-fields` · **No migration**

**Acceptance:**
- Grep the codebase for every remaining read of `JobSeeker.tradeSkill`, `kycStatus`, `kycReference`. Each read site is switched to read from `JobSeekerTrade`/`IdentityVerification` instead, with a fallback to the old column only where the new table has no row yet (so old test data and not-yet-migrated real rows don't break).
- No write path writes the old columns anymore.
- This task does **not** drop the columns — that happens in the final clean-up migration (data-design §14), not before every service is confirmed off them.
- Tests: a job seeker with only old-style data (no `JobSeekerTrade` row) still returns a usable primary trade from the fallback; a job seeker with new-style data ignores the old column entirely; no test asserts the old columns still get written.

---

## Phase 12 Gate

- [ ] A job seeker cannot be matched, called for matching purposes, or have Aadhaar checked without the relevant consent granted — by test
- [ ] Consent is only ever recorded through a job seeker's own OTP-verified submission, never typed in by an agent on their behalf — by test
- [ ] `lead → consented` happens automatically and only when all five required purposes are granted — by test
- [ ] Withdrawing `call_recording` or `job_matching` pauses an active job seeker — by test
- [ ] `IdentityVerification` never stores a full Aadhaar number, by test, and only runs after `aadhaar_verification` consent — by test
- [ ] Reversing a `JobSeekerHit` removes it from `maxHits`/refund counting and raises a `ReviewFlag` — by test
- [ ] No raw Aadhaar data anywhere in a request or response — by test, reusing `assertNoRawAadhaar`
- [ ] `CallRecord.purpose` includes `consent_explain` — by test
- [ ] **End-to-end proof, recorded in the report:** a field agent registers a lead and places a `consent_explain` call; the system sends the consent SMS link; the job seeker opens it, verifies by OTP, ticks all five required purposes, and submits; status moves to `consented`; an Aadhaar verification is requested and succeeds with only `last4` stored; the job seeker later withdraws `call_recording` consent and is paused.
- [ ] All earlier phase gate items still pass; CI green on `main`; every task branch was green before merging; `LESSONS.md` updated

**When the gate passes: stop and report to Agastya.** Commits, CI links, test counts, one line per task, and the end-to-end proof. Do not start the next phase.
