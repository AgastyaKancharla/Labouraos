# Phase 18 — Money Going Out

**Goal:** every rupee Laboura pays out — ₹499 refunds, business fee refunds, referral ₹200s and joining rewards — is approved by the CEO or Finance, sent by UPI from the company account by a person, and recorded with its UTR. It goes only to a payout account the receiver entered **on their own phone**, after a 48-hour wait if they changed it, and only after Finance has seen that the name the UPI app shows matches the receiver. Nothing leaves Laboura automatically.

**Why this is next:** step 9 of the build order in `specs/data-design.md` §16 (`PayoutAccount`, the money-out half of §10). Master Guide: "Referral partners → Bank and UPI details", "Money rules at a glance", "How money is collected (decided 2 Nov)".

**Decisions (8 Nov):**
1. **Name check = Finance, at the moment of paying (option a).** The UPI app shows the receiver's name before sending; Finance types the name it showed, and the software compares it with the receiver. No verification company for now — but the code has a `NameCheckProvider` slot with a "manual" implementation, so an automatic check can plug in later with no other change.
2. **Referral partners sign their terms and tick call-recording consent by OTP on their own phone**, like business owners (Master Guide: "The same applies to business owners and referral partners").

**Read first:** `AGENTS.md`, `LESSONS.md`, this whole spec, `specs/data-design.md` §1, §2, §10. Read in `src/modules/payment/payment.service.ts`: `createReferralPayout`, `disbursePayout`, `dispatchPayout`, `retryPayout`, `resolvePayout`, `handlePayoutWebhook`; `approveRefund` in `placement.service.ts`; `getRefundsDue` in `refund.service.ts`; `POST /job-seekers/:id/refund`; the Phase 17 joining-reward job; the Phase 12 consent link/OTP machinery and the Phase 11 `callRoutingPhone` encryption (reuse both patterns).

**Known traps in the current code (checked 8 Nov — handle them, don't stop on them):**
- Payouts today go to a payout company's API (`dispatchPayout`), with retry, manual resolve and a payout webhook. **Money is no longer sent by the software at all**, so this whole path is replaced: `POST /payments/:id/disburse`, `/retry-payout`, `/resolve-payout` and `POST /payments/payout-webhook` are removed (leave 404 tests). Old payout rows keep their old statuses, readable, never written again.
- `createReferralPayout` invents a fake `gatewayReference` (`mock_payout_ref_…`). Money-out payments have no gateway reference.
- `approveRefund` creates a refund `Payment` that is already "completed" when approved — before any money was sent. Approval and payment become two separate steps.
- **Left over from Phase 17:** `getRefundsDue` (Finance's "refunds due" list) still counts the 15 days from `dropoutReportedAt` and passes `clockPaused`, `clockPausedAt` and `eligibility`; `evaluatePlacementRefundEligibility` still checks `eligibility === 'business_breach'`. Approval correctly counts from the claim's `decidedAt`. Make the list use **exactly the same rule and function as approval**, and remove every read of those deprecated columns.

**Out of scope — do not build:** an automatic name-verification company (the slot only), a payout company, bulk bank-file uploads, billing a bypass charge.

---

## How this phase runs

One task after another, in order, each on its own branch; build on the latest `main`, push, wait for GitHub Actions green **on the branch**, fix on the branch, merge by pull request, tick. **Commit and push after every meaningful change.** GitHub Actions is the test runner. Every rule number comes from `PricingService.current()`; every outside link uses `publicLink()`; required services are never `@Optional` with a fallback. If the spec and code disagree in a way this spec doesn't answer, stop and ask.

---

### [x] Task 1 — Payout accounts, entered by the person on their own phone
**Branch:** `phase-18/task-1-payout-accounts` · **Migration folder:** `20261111100000_add_payout_account`

**Acceptance:**
- `PayoutAccount` as data-design §10, with `ownerType` extended to `referral`, `job_seeker`, **`business`** (a business's fee refund needs somewhere to go). Plus `valueHash` (a keyed hash of the normalised UPI ID or account number, for duplicate checks without decrypting) and `ownerNameAtEntry`.
- **The full UPI ID / account number is stored encrypted** (AES-256-GCM) with a key from `PAYOUT_ACCOUNT_KEY`, read through one function that **refuses to start the server** if the key is missing or under 32 characters — same pattern as `CALL_ROUTING_KEY`. Declared in `render.yaml` as generated, explained in `DEPLOY.md`. The full value is **never returned by any API** except Task 4's reveal.
- **Entered only by the owner, on their own phone:** `POST /payout-accounts/links` (call agent, field agent, Team Lead, Manager, CEO, Finance) with `{ ownerType, ownerId }` sends a single-use link by SMS (template `payout_details_link`) to that person's registered phone. They open it, verify by OTP, choose UPI (preferred) or bank account + IFSC, and submit. **No staff route can enter or change anyone's payout details.**
- First account: `status: pending_validation`, `activeFrom` = now. **A change** (a new account when one exists): the old one → `superseded`; the new one's `activeFrom` = now + `payoutDetailsCoolingHours` (48); `changeOtpRequestId` set; Finance gets an in-app notice. Nothing can be paid to an account before its `activeFrom`.
- **Fraud flags on save:** the same `valueHash` already used by a different owner → `payout_shared_account`; a UPI ID whose number part equals any staff member's phone or `callRoutingPhone` → `payout_matches_staff`. Both are `ReviewFlag`s to Finance; the account stays `flagged` and can't be paid until Finance resolves the flag.
- `maskedValue` only (part of the UPI ID, or the last 4 digits) in every list and profile.
- Tests: the server won't start without `PAYOUT_ACCOUNT_KEY`; the stored value isn't readable as a UPI ID; no API returns the full value; no staff route sets payout details; a change waits 48 hours and notifies Finance; a shared account and a staff-number UPI each raise their flag and block payment.

### [x] Task 2 — Referral partners sign their terms
**Branch:** `phase-18/task-2-referral-terms` · **No migration**

**Acceptance:**
- `POST /referrals/:id/terms-links` sends the partner a single-use link (template `referral_terms_link`) through the **same** Phase 12/13 link and OTP machinery. On their own phone they read the terms (₹200 per referred candidate who joins — amount from `referralPayoutPaise` at send time — paid manually, payout details rules), verify by OTP, and tick **terms** and **call recording**. Two `Consent` rows (`subjectType: referral`, purposes `agreement_terms`, `call_recording`, `method: sms_link`) share the OTP request.
- A referral payout can't be released until the partner's `agreement_terms` consent is active. Referrals made before signing still count; the payout simply waits.
- No staff route can sign for a partner.
- Tests: signing creates both consents with one OTP; an unsigned partner's payout can't be approved; no staff route signs.

### [ ] Task 3 — Owed, approved, paid: one release flow for all money out
**Branch:** `phase-18/task-3-release-flow` · **Migration folder:** `20261111110000_money_out_flow`

**Acceptance:**
- One flow for `refund` (job seeker ₹499 and business fee refunds), `referral_payout` and `joining_reward`:
  1. **Owed** (`pending`) — created by the existing rules (Phase 17 eligibility, the referral queue on joining, the joining-reward job). No gateway reference.
  2. **Approved** — `POST /payments/:id/approve` (CEO, Finance) re-checks eligibility at that moment (for refunds: the same function as the "refunds due" list, including the bypass and consent-withdrawal blocks; for referrals: signed terms), sets `approvedByStaffId`, `approvedAt`, status `approved`.
  3. **Paid** — `POST /payments/:id/record-payout` (CEO, Finance) with `{ bankUtr, receiverNameShown, paidAt }` after sending the money from the company UPI app. Refused unless the receiver has a payout account that is active (`activeFrom` passed), not `flagged`, and not `superseded`. The software compares `receiverNameShown` with the owner's name (case and spacing ignored; first and last name must both appear): match → `succeeded`, `bankUtr` set, `payoutAccountId` set, the account becomes `verified` with `verifiedName` and `nameMatches = true`; no match → refused, nothing recorded as paid, and a `payout_name_mismatch` `ReviewFlag` to the CEO. `bankUtr` is unique across all payments.
- **`approveRefund`** (business) and **`POST /job-seekers/:id/refund`** now create an **approved** refund, not a completed one. The business root placement's `guaranteeEndedReason: refunded` is set at approval, as Phase 17 built it.
- A `NameCheckProvider` interface with a `ManualNameCheckProvider` (returns "not checked — Finance confirms at payment"). Nothing calls an outside service.
- **Remove** `POST /payments/:id/disburse`, `/retry-payout`, `/resolve-payout` and `POST /payments/payout-webhook` and the code that sends money through a payout company; 404 tests for each. `createReferralPayout` stops inventing a gateway reference.
- **Fix the Phase 17 leftover:** `getRefundsDue` uses the claim's `decidedAt` and the same eligibility function as approval; no code reads `clockPaused`, `clockPausedAt` or `eligibility`.
- Every approval and payment is audited (who, when, which payment, the UTR — never the full UPI ID).
- Tests: a payment can't be marked paid without being approved first; only CEO and Finance can approve or record; a payout to an account in its 48-hour wait, flagged or superseded is refused; a name mismatch is refused and flagged; a matching name records the UTR and verifies the account; a UTR can't be reused; approving re-checks eligibility (a candidate who became `placed` in between can't be refunded); the old payout routes return 404; the refunds-due list and approval agree on a business refund on day 15 and day 16 after acceptance.

### [ ] Task 4 — Collecting payout details at the right moment, and paying
**Branch:** `phase-18/task-4-collect-and-pay` · **No migration**

**Acceptance:**
- When joining is confirmed (Phase 17 Task 1), the worker is sent the payout-details link automatically (for the joining reward). When a referral payout is first queued and the partner has no account, the partner is sent the link. When a refund becomes owed and the receiver has no account, they are sent the link.
- **Reveal at the moment of paying:** `POST /payments/:id/reveal-payout-details` (CEO, Finance; only for an `approved` payment with an eligible account) returns the full UPI ID or account number and IFSC once, so Finance can type it into the bank's UPI app. Every reveal is audited.
- Tests: the link goes out once at each trigger; reveal works only for CEO and Finance on an approved payment, and is audited; nobody else ever receives the full value.

### [ ] Task 5 — Screens
**Branch:** `phase-18/task-5-screens` · **No migration**

**Acceptance (existing consoles, plain styling):**
- **Finance:** money owed (by type, oldest first), waiting for approval, approved and ready to pay (with the masked account, **Reveal**, and a **Record payment** form: UTR, the name the UPI app showed, date); accounts in their 48-hour wait; payout flags.
- **Agents:** on a job seeker, referral partner or business — whether payout details are on file (masked) and a **Send payout details link** button. No way to see or edit the full details.
- Tests: screens render for the allowed roles; no agent page shows a full UPI ID or account number; only Finance and CEO see Reveal and Record payment.

---

## Phase 18 Gate

- [ ] Payout details are entered only by the owner on their own phone by OTP; stored encrypted; never returned except to CEO/Finance at the moment of paying — by test
- [ ] A changed account can't be paid for 48 hours and Finance is told; shared accounts and staff-number UPIs are flagged and blocked — by test
- [ ] Every payment out is owed → approved → paid, by CEO or Finance only, with a unique UTR; nothing is paid automatically — by test
- [ ] A name that doesn't match the receiver blocks the payment and raises `payout_name_mismatch` — by test
- [ ] Referral payouts need the partner's signed terms — by test
- [ ] The payout-company routes are gone; the refunds-due list and approval use the same rule; nothing reads `clockPaused`, `clockPausedAt` or `eligibility` — by test
- [ ] **End-to-end proof, recorded in the report:** a worker joins and receives the payout link; they enter a UPI ID on their phone by OTP; 30 days later the ₹200 reward is owed; Finance approves it, reveals the UPI ID, records the UTR with the name the app showed → paid, account verified. A referral partner signs terms by OTP; their ₹200 is approved and paid the same way. A business owed a fee refund on day 16 enters a bank account; Finance types a different name → refused and flagged; with the right name → paid. A partner changes their UPI ID → a payment the next day is refused, and allowed after 48 hours.
- [ ] All earlier phase gate items still pass; CI green on `main`; every task branch was green before merging; `LESSONS.md` updated

**When the gate passes: stop and report to Agastya.** Commits, CI links, test counts, one line per task, any tests changed and why, and the end-to-end proof. Do not start the next phase.
