# Phase 13 — Businesses and Vacancies

**Goal:** no candidate is ever shown to a business until that business is verified — visited in person, owner confirmed, agreement signed by the owner on their own phone, and checked by a Team Lead. Businesses with licences give them; households and small shops without them are still allowed and are marked for a closer check. Vacancies carry everything the matching engine will need. Field agents work on the businesses they are responsible for (the account agent), not on an "area". Job seekers can withdraw consent through an agent, safely.

**Why this is next:** step 5 of the build order in `specs/data-design.md` §16 (§5, §6, §15), plus the consent-withdrawal flow deferred from Phase 12 (see `LESSONS.md`).

**Decisions confirmed with Agastya (5 Nov):**
1. The business owner ticks **call recording** consent in the same OTP step in which they sign the agreement.
2. **Households and businesses without licences are in.** Registration numbers are taken when the business has them and are optional when it doesn't. Nobody is turned away; `documentsStatus = no_documents` only tells the Team Lead to check more carefully.
3. **Job seekers withdraw consent by calling an agent**, never by a self-service page (for now). Because this is the one place an agent changes a person's consent, it is locked to a recorded, answered call with that person, confirmed to them by SMS, and audited. Agents still can **never grant** consent for anyone.

**Read first:** `AGENTS.md`, `LESSONS.md`, this whole spec, `specs/data-design.md` §1 (`Consent`, `ReviewFlag`), §2, §5, §6, §14, §15. Read `src/modules/consent/` (Phase 12 token, OTP and page machinery — reuse it, do not build a second one), `src/modules/call/recording-storage.ts` (reuse the storage interface pattern), `src/common/rbac/rbac.types.ts` and `rbac.guard.ts`, `src/modules/business/business.service.ts`, `src/modules/vacancy/`.

**Known traps in the current code (checked 5 Nov — handle them, don't stop on them):**
- `Business.area` is `String` **NOT NULL** and `createBusiness` throws "area is required". It must become nullable by migration, exactly like `JobSeeker.tradeSkill` in Phase 12 Task 7.
- `Vacancy.offeredSalary` is `Int` **NOT NULL**. It is replaced by `salaryMinPaise`; it must become nullable by migration so writes can stop.
- `Staff.area` is already nullable. Only stop reading it.
- `POST /payments/:id/disburse`, `/retry-payout` and `/resolve-payout` currently allow `manager`. §15 says Managers never release money.
- `GET /vacancies/:id/shortlist` exists (`vacancy.controller.ts`) and has its own tests in `candidate-shortlist.spec.ts`.

**Out of scope — do not build:** the matching engine and the map (Phase 14), interviews, offers and placements (Phase 15), referral-partner agreements, a real GST lookup company (mock only), the field agent native app (photos taken in the web console are recorded as not live), a self-service consent withdrawal page.

---

## How this phase runs

One task after another, in order. Each task has its own branch and, where needed, a fixed migration folder name. Build on the latest `main`, push, wait for GitHub Actions to pass **on the branch**, fix failures on the branch, then merge and tick. Locally run only the tests for your own change; GitHub runs the full suite. If the spec and the code disagree in a way this spec does not answer, stop and ask.

---

### [x] Task 1 — Consent withdrawal through an agent
**Branch:** `phase-13/task-1-agent-withdrawal` · **Migration folder:** `20261106100000_consent_withdrawal_by_agent`

**Acceptance:**
- New `Consent` columns: `withdrawnMethod` (`agent_call`; room for `sms_link` later), `withdrawnByStaffId`, `withdrawnCallRecordId`. New `PricingPolicy` column `consentWithdrawalCallWindowMinutes`, default **60**.
- Add `consent_withdraw` to the `CallRecord.purpose` closed list.
- `POST /consent/withdraw` (`call_agent`, `field_agent`, `team_lead`, `manager`, `ceo`) with `{ jobSeekerId, purposes[], callRecordId }`. Accepted **only if** that `CallRecord`:
  - has `answered = true` (from the webhook — Phase 11),
  - has `staffId` = the agent making the request,
  - has `subjectType = job_seeker` and `subjectId` = this job seeker,
  - ended no more than `consentWithdrawalCallWindowMinutes` ago.
  Otherwise refused with a clear message. Inbound calls from the job seeker count the same as outbound ones.
- Each purpose is withdrawn through the existing `ConsentService.withdraw`, which now also records `withdrawnMethod`, `withdrawnByStaffId` and `withdrawnCallRecordId`. The Phase 12 pause rule is unchanged (withdrawing `call_recording` or `job_matching` pauses an active job seeker).
- After a successful withdrawal the system sends the job seeker an SMS through `MessagingService` (template `consent_withdrawn`) naming what was withdrawn and how to undo it. An audit entry records who, which call and which purposes — no personal data.
- **Giving consent back:** the agent sends the Phase 12 consent link again; the job seeker re-grants through the same OTP page. Because `(subjectType, subjectId, purpose, noticeVersion)` is unique, re-granting the same purpose **updates that row**: new `grantedAt`, new `otpRequestId`, `withdrawnAt` and the three withdrawal columns cleared — and **before** clearing them, an `AuditLog` entry records the earlier withdrawal (time, method, staff, call) so the history is never lost. When a `paused` job seeker has all five required purposes active again, they return to `active` and `pausedAt` is cleared, with a `StatusHistory` row.
- The rule "no agent can ever **grant** consent" is unchanged and still proven by test.
- Tests: withdrawal with no call, an unanswered call, another agent's call, another job seeker's call, or a call older than the window is refused; a valid withdrawal pauses an active job seeker, sends one `consent_withdrawn` SMS, and is audited; re-granting through the link restores `active`; the withdrawal history survives the re-grant in `AuditLog`; there is still no staff route that grants consent.

### [x] Task 2 — Business profile, documents and households
**Branch:** `phase-13/task-2-business-fields` · **Migration folder:** `20261106110000_business_profile_fields`

**Acceptance:**
- All new `Business` columns from data-design §5, nullable, no backfill: `legalName`, `ownerName`, `additionalContactName`, `additionalContactPhone`, `businessType`, `employeeCount`, `staffNeeded`, `licenceNumber`, `shopEstablishmentNumber`, `udyamNumber`, `pan`, `gstVerified`, `gstLegalName`, `gstStatus`, `gstCheckedAt`, `yearsInOperation`, `hiringFrequency`, `billingName`, `billingAddress`, `storefrontPhotoPath`, `storefrontPhotoHash`, `storefrontPhotoLive`, `documentsStatus`, `verificationStatus` (default `lead` for new rows), `verifiedAt`, `verifiedByStaffId`, `accountAgentId`, `accountAgentAssignedAt`, `leadCreatedByStaffId`, `leadChannel`, `locality`.
- **`Business.area` becomes nullable** in this migration. Creation no longer requires or sets it; `locality` is filled from the business's GPS position. `area`, `contactName` and `Business.selfieUrl`/`selfieHash` are marked `@deprecated` and no longer written (selfies live only on `BusinessVisit`). Columns are not dropped (§14 does that).
- `businessType` closed list: `restaurant`, `retail`, `factory`, `office`, `warehouse`, `household`, `other`.
- **Documents are optional for everyone.** `documentsStatus` is computed at every save: `documented` if any of `gstNumber`, `licenceNumber`, `shopEstablishmentNumber`, `udyamNumber` or `pan` is present, otherwise `no_documents`. A `household` is never asked for registration numbers.
- A `GstLookupProvider` interface with a mock (like the telephony and SMS providers). When a `gstNumber` is saved, the provider is called and `gstVerified`, `gstLegalName`, `gstStatus`, `gstCheckedAt` are stored. A failed lookup never blocks the save.
- Storefront photo upload: stored in private storage through the same storage-interface pattern as recordings, with its hash; `storefrontPhotoLive = false` for anything uploaded from the web console (only the future app can set it true).
- **Duplicate check before saving** (Master Guide, "What is recorded about a business"): the same phone, the same GST, licence, Shop and Establishment or Udyam number, the same storefront photo hash, or a business within **`duplicateBusinessRadiusMeters`** (new `PricingPolicy` column, default **50**) with a similar name (case- and space-insensitive, one contains the other) → the save goes through but raises a `duplicate_business` `ReviewFlag` naming the other business. An exact phone match is still refused, as today, because `Business.phone` is unique.
- `leadCreatedByStaffId` and `leadChannel` (`field_visit`, `phone_call`) are set at creation from the logged-in staff member.
- Tests: a business with only a Udyam number is `documented`; a household with nothing is `no_documents` and is created successfully; a business can be created with no `area`; no new code writes `area`, `contactName` or `Business.selfieUrl`; a GST lookup failure still saves the business; a reused storefront photo, a reused GST or licence number, and a similar name within 50 m each raise `duplicate_business`; a similar name 200 m away does not.

### [x] Task 3 — Vacancy fields and interview slots
**Branch:** `phase-13/task-3-vacancy-fields` · **Migration folder:** `20261106120000_vacancy_fields_and_slots`

**Acceptance:**
- All new `Vacancy` columns from data-design §6: `roleTitle`, `salaryMinPaise`, `salaryMaxPaise`, `salaryPeriod`, `extras`, `workingHours`, `shift`, `weeklyOff`, `latitude`, `longitude`, `locality`, `experienceRequiredYears`, `educationRequired`, `languagesRequired`, `licencesRequired`, `ageMin`, `ageMax`, `genderRequirement`, `genderReason`, `startDate`, `urgency`, `probationDays`, `interviewType`, `interviewContactName`, `capturedChannel`.
- **`offeredSalary` → `salaryMinPaise`:** the migration adds `salaryMinPaise`, copies each row's `offeredSalary` into it (a straight copy, not a guess), and makes `offeredSalary` **nullable** and `@deprecated`. Every read switches to `salaryMinPaise`; nothing writes `offeredSalary` any more. `Vacancy.tradeSkill` stays exactly as it is.
- `genderRequirement` other than none requires `genderReason`, or the save is refused.
- `extras` closed list: `overtime`, `incentives`, `food`, `accommodation`, `transport`, `uniform`, `pf_esi`. `interviewType`: `walk_in` (default), `scheduled`.
- `VacancyInterviewSlot`: `vacancyId`, `startsAt`, `endsAt`, `capacity`. New `PricingPolicy` columns `walkInStart` (`"10:30"`) and `walkInEnd` (`"18:00"`) — never typed as literals. Choosing a walk-in day creates one slot from `walkInStart` to `walkInEnd` IST on that day; scheduled slots can be added by hand.
- If the vacancy has no own location, `latitude`/`longitude`/`locality` default to the business's.
- When a call agent adds a vacancy to a business whose account agent is someone else, the account agent is notified (an in-app notice is enough — reuse whatever notification the consoles already have, or a `ReviewFlag`-style list; do not invent an SMS to staff), and `capturedByStaffId` stays the call agent so the vacancy counts towards their "vacancies captured".
- Tests: an existing vacancy's salary is readable as `salaryMinPaise` after migration; a new vacancy never writes `offeredSalary`; a gender requirement without a reason is refused; a walk-in day creates a 10:30–18:00 IST slot read from `PricingPolicy`; `Vacancy.tradeSkill` is still required.

### [x] Task 4 — The agreement, signed by the owner on their own phone
**Branch:** `phase-13/task-4-business-agreement` · **Migration folder:** `20261106130000_add_business_agreement`

**Acceptance:**
- `BusinessAgreement` exactly as data-design §5: `businessId`, `version`, `termsHash`, `noBypassMonths`, `noBypassPenaltyPercent`, `feePercent`, `signedName`, `signedPhone` (masked), `otpRequestId`, `signedAt`, `documentStoragePath`.
- The terms are rendered from a versioned template with the numbers taken from `PricingService.current()` at the moment the link is sent (`noBypassMonths` 12, `noBypassPenaltyPercent` 50, `placementFeePercent` 50, plus GST). Those numbers are copied onto the agreement row, so a later price change never alters a signed agreement. `termsHash` is the hash of the exact text shown.
- `POST /businesses/:id/agreement-links` (`call_agent`, `field_agent`, `team_lead`, `manager`, `ceo`) sends the owner a single-use link by SMS through `MessagingService` (template `agreement_link`), to `Business.phone`. **Reuse the Phase 12 token, OTP and page machinery** — one shared mechanism, not a copy.
- The owner opens the link on their own phone, reads the agreement in their language (kn, hi, en), verifies by OTP, types their name, and ticks two boxes: **agreement terms** and **call recording**. Submitting creates the `BusinessAgreement` row and two `Consent` rows (`subjectType: business`, purposes `agreement_terms` and `call_recording`, `method: sms_link`), all tied to the same `otpRequestId`.
- A rendered copy of the signed agreement (HTML is fine) is stored in private storage; `documentStoragePath` is set.
- **No staff route can sign an agreement or grant a business's consent.**
- Tests: a full sign creates one agreement and two consent rows sharing one OTP request; a used or expired link is refused; the numbers on the agreement match `PricingPolicy` at send time and don't change when the policy changes later; no staff route signs; the stored copy's hash matches `termsHash`.

### [x] Task 5 — Verification visits, check-ins and the verified gate
**Branch:** `phase-13/task-5-verification` · **Migration folder:** `20261106140000_visits_and_checkins`

**Acceptance:**
- `VisitAssignment` and `FieldCheckIn` exactly as data-design §5; `BusinessVisit` gets `purpose`, `ownerOtpRequestId`, `photoLive`, `assignmentId`. Existing GPS, selfie and duplicate-selfie checks stay.
- `POST /field-agent/check-in` records a `FieldCheckIn` (location at events only — never continuous tracking). If a check-in endpoint already exists in `src/modules/field-agent/`, convert it to write `FieldCheckIn` rather than adding a second one.
- **Suggested agent:** when a `verification` assignment is created, `suggestedStaffId` is the field agent, checked in today (IST) and not locked, whose latest known position today (latest `FieldCheckIn` or `BusinessVisit`) is nearest the business by straight-line distance. If nobody is checked in, it is left empty. A Team Lead confirms or changes it (`assignedStaffId`, `assignedByStaffId`).
- **Owner presence at the visit:** during a visit the system sends an OTP to the owner's phone; the owner reads it to the agent, who enters it. This proves the agent was with the owner — it is **presence**, not consent, and is stored as `ownerOtpRequestId`.
- **Verification status flow** (each move writes `StatusHistory`):
  - `lead` → `pending_visit` when a verification assignment is created;
  - → `pending_tl_check` when the verification visit is done (GPS + photo + owner OTP) **and** a `BusinessAgreement` is signed;
  - → `verified` when a Team Lead (own team), Manager or CEO approves; sets `verifiedAt`, `verifiedByStaffId`;
  - → `rejected` with a required reason.
  A `no_documents` business reaching `pending_tl_check` raises a `no_documents_check` `ReviewFlag`, resolved by the approval. **Approving a `no_documents` business also requires the approver to have called the owner through the system** — an answered `CallRecord` with `purpose: verification`, made by the approver to that business after it reached `pending_tl_check` (Master Guide, "Businesses with no licence and no GST"). Without it, approval is refused with a clear message.
- **Account agent:** on approval, `accountAgentId` is the field agent who did the verification visit, unless the approver picks another field agent; `accountAgentAssignedAt` is set. A Team Lead, Manager or CEO can reassign later (audited).
- **The verified gate:** `GET /vacancies/:id/shortlist`, and anything else that shows candidates to or for a business, returns nothing for a business that is not `verified`, with a clear reason. Existing shortlist tests change their fixtures to verified businesses — say so in the report; that is a rule change, not weakening.
- Tests: the nearest checked-in agent is suggested; a locked or not-checked-in agent is never suggested; a visit without the owner OTP doesn't complete verification; an unsigned business can't reach `pending_tl_check`; a `no_documents` business raises the flag and can't be approved until the approver has an answered verification call to it; a non-verified business's shortlist is empty; approval sets the account agent.

### [x] Task 6 — Permissions: account agent instead of area, and who releases money
**Branch:** `phase-13/task-6-permissions` · **No migration**

**Acceptance:**
- Remove the `own_area` scope everywhere (`rbac.types.ts`, `rbac.guard.ts`, `business.service.ts` and any other reader of `Staff.area`). Add `own_account`: a business whose `accountAgentId` is the staff member, and the vacancies, placements and (later) interviews of that business.
- New matrix, per data-design §15:
  - `field_agent` — business, vacancy, placement: **read all**; **write own_account**. Also may write a business they hold an open (`assigned`) `VisitAssignment` for, until that visit is done, and a lead they created while it is still `lead` or `pending_visit`.
  - `call_agent` — business: read all; write **only** to create a lead and to edit a lead they created while it is still `lead`. May add vacancies to **any** business.
  - `team_lead` — business, vacancy, placement: own team = the account agent or lead creator is in their team.
  - `manager`, `ceo` — unchanged (all).
- **Releasing money is CEO and Finance only.** `POST /payments/:id/disburse`, `/retry-payout` and `/resolve-payout` drop `manager`. Managers keep read access.
- `Staff.area` is marked `@deprecated` and nothing reads it.
- Tests: a field agent can read any business but can edit only their own account businesses (plus the visit and lead exceptions above); a call agent can create a lead and add a vacancy to someone else's business but can't edit a verified business; a manager is refused on all three money-release routes; finance and CEO succeed; nothing reads `Staff.area` or `Business.area`.

### [x] Task 7 — Screens
**Branch:** `phase-13/task-7-screens` · **No migration**

**Acceptance (existing consoles, plain styling):**
- Business registration form: type (including household), owner, optional registration numbers with a short "only if they have it" note, storefront photo, billing details. Shows `documented` or `no documents`.
- Business profile: verification status with the next step ("send agreement", "assign visit", "approve"), a **Send agreement** button, the signed agreement link (Team Lead and above), account agent.
- Team Lead view: pending visit assignments with the suggested agent and a way to confirm or change; businesses waiting for approval, with the `no_documents` ones marked.
- Field agent view: **Check in** button; my assignments; the owner-OTP step during a visit.
- Vacancy form with the new fields, walk-in day or scheduled slots.
- Job seeker profile: **Withdraw consent** — appears only when the agent has an answered call with that job seeker inside the window, lists the purposes to withdraw, and shows what will happen (paused, SMS sent).
- Tests: screens render for the allowed roles; the withdraw button is absent without a qualifying call; no full phone number appears in any agent page.

---

## Phase 13 Gate

- [x] A business can't reach `verified` without a done verification visit with the owner's OTP, an agreement signed by the owner on their own phone, and a Team Lead/Manager/CEO approval — by test
- [x] No candidate is shown for a business that isn't `verified` — by test
- [x] Households and businesses with no registration numbers can register; they are `no_documents` and raise `no_documents_check` — by test
- [x] The agreement's numbers come from `PricingPolicy` at send time and never change afterwards; no staff route can sign it — by test
- [x] The owner's `call_recording` consent is created in the same OTP step as the agreement — by test
- [x] A job seeker's consent can be withdrawn by an agent only inside an answered, recent call with that job seeker; the job seeker gets an SMS; it is audited; no agent can grant consent — by test
- [x] `own_area` is gone; `own_account` works; Managers can't release money — by test
- [x] `Business.area` and `Vacancy.offeredSalary` are nullable and no longer written; `Vacancy.tradeSkill` is untouched — by test
- [x] **End-to-end proof, recorded in the report:** a call agent creates a household lead with no documents; a Team Lead creates a verification assignment and the nearest checked-in field agent is suggested and confirmed; the agent visits, enters the owner's OTP, uploads a photo; the owner signs the agreement and call-recording consent on their own phone; the `no_documents_check` flag is raised; the Team Lead approves, the visiting agent becomes account agent; a vacancy is added with a walk-in day; the shortlist that was empty before approval now works. Separately: a job seeker calls in, the agent withdraws `call_recording` inside the call window, the job seeker is paused and gets the SMS, re-grants by link and is active again.
- [x] All earlier phase gate items still pass; CI green on `main`; every task branch was green before merging; `LESSONS.md` updated

**When the gate passes: stop and report to Agastya.** Commits, CI links, test counts, one line per task, any tests changed and why, and the end-to-end proof. Do not start the next phase.
