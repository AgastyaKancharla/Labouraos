# Phase 19 — Corrections, Keeping Data, and the Final Clean-up

**Goal:** mistakes can be corrected, but every correction is traceable and money-touching records lock once money is involved. Personal data is kept only as long as the agreed periods, then anonymised or deleted automatically — the business figures are never lost. And the old columns left over from the redesign are removed for good.

**Why this is next:** step 10 of the build order in `specs/data-design.md` §16 (§12, §13, §14) — the last code phase before testing. Master Guide: "Correcting mistakes", "Data, privacy and how long data is kept".

**Interpretation to confirm with Agastya:** the Master Guide says "every edit needs a reason". This spec requires a reason for **changing a value that was already saved**; filling in an empty field (for example while completing a new profile) needs none.

**Read first:** `AGENTS.md`, `LESSONS.md`, this whole spec, `specs/data-design.md` §12, §13, §14. Read the two `erase` endpoints (`POST /job-seekers/:id/erase`, `POST /businesses/:id/erase`) and their services, the audit service (and how it already writes personal fields as `"[changed]"`), and the storage classes for photos, recordings, storefront photos and agreement documents.

**Known traps in the current code (checked 9 Nov — handle them, don't stop on them):**
- There is **no shared "money involved" edit guard** yet. Build it once and use it everywhere (Task 1).
- `erase` writes `name: 'ANONYMIZED_CANDIDATE'`, a fake phone and `erasedAt`, separately per entity. It becomes "anonymise now", sharing one service with the daily job, and `anonymisedAt` replaces `erasedAt` (Task 2).
- `src/modules/target/field-agent-metrics.service.ts` still selects `clockPaused` and `clockPausedAt`. Every remaining reader of a column being dropped must be switched **before** the drop migration (Task 4).
- `Payment.payoutAttempts` has no remaining readers since Phase 18. `Placement.dropoutReportedAt` and `dropoutDateCallerSupplied` are **still written** by the claim flow and shown in the refunds-due list — **keep them**. `Vacancy.tradeSkill` is **not** deprecated — **keep it**.
- The word "eligibility" appears in function names like `evaluatePlacementRefundEligibility`. Only the **column** `Placement.eligibility` is removed; don't rename unrelated code.

**Out of scope — do not build:** a self-service data request page for job seekers, staff-record retention (employment law, handled outside the software), the field agent app.

---

## How this phase runs

One task after another, in order, each on its own branch; build on the latest `main`, push, wait for GitHub Actions green **on the branch**, fix on the branch, merge by pull request, tick. **Commit and push after every meaningful change.** GitHub Actions is the test runner. Every test closes the Nest app in `afterAll` inside `try … finally`. If the spec and code disagree in a way this spec doesn't answer, stop and ask.

---

### [x] Task 1 — Who can edit what, and why
**Branch:** `phase-19/task-1-edit-rules` · **No migration**

**Acceptance:**
- **One shared guard** (`EditPolicyService`) used by every update route for job seekers, businesses, vacancies, placements, referral partners and call notes:
  - The staff member who created a record (or the business's account agent) can edit it **until money is involved**.
  - **Money is involved** when: for a job seeker, any `Payment` for them has `succeeded`; for a placement, its status is `confirmed` or later; for a business or vacancy, any of its placements is `confirmed` or later; for a referral partner, any payout to them is `approved` or later.
  - After that, only a Team Lead (own team), Manager or CEO can edit.
  - A Team Lead can edit any record their team created, at any time.
- **Reasons:** changing a value that was already saved requires a `reason` (refused without one); filling an empty field does not. Stored on `AuditLog.reason` with `changedFields` and before/after — **personal fields written as `"[changed]"`, never their values** (keep and test the existing rule).
- **Never editable by anyone, through any route:** `Payment`, `BankCredit` once matched, `CallRecord` provider fields and recordings, `Consent`, `CandidateIntroduction`, `AuditLog`, `StatusHistory`, `IdentityVerification` results, signed `BusinessAgreement`s. A test lists every update/patch/delete route in the app and asserts none of them can change these.
- Tests: an agent edits their own job seeker before payment; the same edit after the ₹499 succeeds is refused for the agent and allowed for their Team Lead with a reason; a change without a reason is refused, a first fill without one is allowed; the audit entry shows `"[changed]"` for a phone change; the never-editable list holds across all routes.

### [x] Task 2 — One way to anonymise
**Branch:** `phase-19/task-2-anonymise` · **Migration folder:** `20261112100000_anonymised_at`

**Acceptance:**
- The migration copies each existing `erasedAt` into `anonymisedAt` (a straight copy, not a guess). Nothing writes `erasedAt` any more; it is dropped in Task 4.
- **One `AnonymisationService.anonymise(subjectType, subjectId, reason)`** used by both "anonymise now" (the existing `erase` endpoints, same roles as today) and the daily job (Task 3). Idempotent.
  - **Job seeker:** name → `"Anonymised"`, `phone`/`whatsappPhone` → a non-reachable placeholder unique per record, `dateOfBirth`, `gender`, `photoStoragePath` (file deleted from storage), `cvStoragePath` (file deleted), exact `latitude`/`longitude`, `lastEmployer`, free-text notes → cleared. Kept: code, trades, languages, locality, pincode, salary range, statuses, hits, interviews, placements, payments — the business figures.
  - **Business:** `ownerName`, `phone`, `additionalContactName`, `additionalContactPhone`, `billingName`, `billingAddress` → cleared or placeholder. Kept: trading name, type, locality, vacancies, placements, payments.
  - **Referral partner:** name and phone → placeholder.
  - **Payout accounts** of the subject: encrypted value wiped, `verifiedName` cleared; `maskedValue` and status kept (payments still point at them).
  - `anonymisedAt` set; one audit entry (no personal values).
- **Refused** (with the reason) while the subject has an open replacement claim, an open `bypass_suspected` flag, or money owed to or by them that is not yet paid (`pending` or `approved`).
- Tests: anonymising a job seeker removes every listed field and deletes the photo and CV files; their placements and payments still add up in reports; running it twice changes nothing; a subject with an open claim or unpaid refund is refused; the `erase` endpoints now call this service.

### [ ] Task 3 — The daily keeping-data job
**Branch:** `phase-19/task-3-retention-job` · **No migration**

**Acceptance:**
- The periods live in **one file**, `src/modules/retention/retention.policy.ts`, as named constants next to a comment pointing to the Master Guide table (they change only on the lawyer's advice, through code review — not in `PricingPolicy`): profiles **23 months** after last activity; call recordings **12 months**; login and access logs **12 months**; payments, invoices, bank credits, payout records and signed agreement documents **8 years**.
- A daily `retention-cleanup` job (on the worker, like the other jobs):
  - **Profiles:** anonymises job seekers, businesses and referral partners whose **last activity** — the latest of the profile's own update, any call, message, interview, placement, consent change or payment for them — is more than 23 months ago, through Task 2's service (its refusals apply).
  - **Recordings:** deletes the stored file of every recording older than 12 months and sets `recordingDeletedAt` — **unless** that call is linked to a placement with an open claim or an open `bypass_suspected` flag (kept until it closes).
  - **Login and access logs:** deletes `StaffSession` and `LoginCodeRequest` rows older than 12 months.
  - **Money records:** deletes `Payment`, `BankCredit` and invoice data, and signed agreement documents (file and row), older than 8 years from their last change.
  - Writes one summary per run (counts per category, no personal data) visible to the CEO, and a `dryRun` flag that reports what it *would* do without changing anything.
- Tests: a job seeker inactive for 23 months and a day is anonymised, one inactive for 22 months isn't; a recent call resets the clock; a 13-month recording is deleted, one linked to an open claim isn't; 13-month sessions are deleted; a dry run changes nothing and reports the right counts; the job is idempotent.

### [ ] Task 4 — The final clean-up: removing the old columns
**Branch:** `phase-19/task-4-final-cleanup` · **Migration folder:** `20261112110000_final_cleanup`

**Acceptance:**
- First switch every remaining reader (`field-agent-metrics.service.ts` and any other found by grep) to the new fields, in the same branch.
- Then one migration drops: `JobSeeker.tradeSkill`, `kycStatus`, `kycReference`, `erasedAt`; `Business.area`, `contactName`, `selfieUrl`, `selfieHash`, `erasedAt`; `Staff.area`, `registeredDeviceId`; `Placement.clockPaused`, `clockPausedAt`, `replacementRejectionCount`, `eligibility`; `Vacancy.offeredSalary`; `Payment.payoutAttempts`. Remove their indexes and every DTO field and fallback that mentioned them (the Phase 12 old-column fallbacks go too).
- **Keep:** `Vacancy.tradeSkill`, `Placement.dropoutReportedAt`, `Placement.dropoutDateCallerSupplied`, `Payment.gatewayReference`.
- A test greps the source (outside migrations) and fails if any dropped column name is referenced.
- Tests: the migration applies cleanly on a fresh database and on one with Phase 18 data; the whole suite passes with the columns gone; the grep test passes.

### [ ] Task 5 — Screens
**Branch:** `phase-19/task-5-screens` · **No migration**

**Acceptance (existing consoles, plain styling):**
- Edit forms show a **Reason** box when a saved value is changed, and a clear "Locked — money involved, ask your Team Lead" when the agent can no longer edit.
- Record pages show the change history (who, when, which fields, reason) to Team Leads and above — personal values shown as "changed".
- CEO: the latest retention run summary, and the dry-run button.
- Tests: screens render for the allowed roles; the history never shows a personal value; the reason box appears only for changes.

---

## Phase 19 Gate

- [ ] Agents edit their own records until money is involved; then only Team Lead or above; changing a saved value needs a reason; personal values never appear in the history — by test
- [ ] Payments, call results, recordings, consents, introductions, audit and status history can't be edited through any route — by test
- [ ] One anonymise service, used by "anonymise now" and the daily job; it keeps the business figures and refuses while a claim, bypass flag or unpaid money is open — by test
- [ ] Profiles are anonymised 23 months after last activity, recordings deleted after 12 months unless a dispute is open, logs after 12 months, money records after 8 years; dry run changes nothing — by test
- [ ] Every old column is gone, nothing references them, and the kept columns are untouched — by test
- [ ] **End-to-end proof, recorded in the report:** an agent registers a job seeker and corrects a typo with no reason needed on first fill; changes the phone later with a reason; after the ₹499 is confirmed the agent's next edit is refused and the Team Lead's succeeds with a reason; the history shows "[changed]" for the phone. With the clock moved forward 23 months and a day, a dry run reports the job seeker; the real run anonymises them, deletes their photo and their 13-month-old recordings, while the placement and payment totals in reports are unchanged. A second job seeker with an open claim is left alone.
- [ ] All earlier phase gate items still pass; CI green on `main`; every task branch was green before merging; `LESSONS.md` updated

**When the gate passes: stop and report to Agastya.** Commits, CI links, test counts, one line per task, any tests changed and why, and the end-to-end proof. Do not start anything else.
