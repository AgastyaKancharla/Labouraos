# Phase 16 — Collecting Money (UPI straight to the bank)

**Goal:** every payment into Laboura — the ₹499 registration and the placement fee — is a UPI payment straight into the company current account, through a QR code and link made for that one payment, with the exact amount and its own reference. A payment counts **only when the money is seen in the bank**: by the bank's automatic notice if it offers one, otherwise by Finance matching the UTR from the statement. **A screenshot is never proof.** Card payments go through the payment gateway, only when the payer chooses card.

**Why this is next:** the money-in half of `specs/data-design.md` §10 (`Payment` changes), and the Master Guide's "How money is collected (decided 2 Nov)" and "Money rules at a glance". Phase 15 left the placement fee on the old gateway path "until Phase 16" — this phase replaces that one step.

**The bank isn't chosen yet.** Build against a `BankFeedProvider` interface with a mock, exactly like the telephony and SMS providers. Finance's manual matching works with **any** bank from day one; the automatic notice plugs in later with no change elsewhere.

**Read first:** `AGENTS.md`, `LESSONS.md`, this whole spec, `specs/data-design.md` §1, §2, §10. Read `src/modules/payment/payment.service.ts` (`createCharge`, `handleWebhook` — how a succeeded payment activates a job seeker or confirms a placement today), `payment-provider.interface.ts`, `createActivationPayment` in `job-seeker.service.ts`, the Phase 15 placement creation in `placement.service.ts`, and `getInvoice`.

**Known traps in the current code (checked 7 Nov — handle them, don't stop on them):**
- `Payment.gatewayReference` is `String` **NOT NULL `@unique`**. A UPI payment has no gateway reference. It must become nullable by migration (unique still applies to non-null values), set only for card payments.
- What happens on success (job seeker active and 30-day clock started; placement confirmed, job seeker `placed`, joining date sent) lives inside the gateway webhook handler. It must run **identically** whichever way the money is confirmed — move it into one function, don't copy it three times.
- `getInvoice` computes GST from today's `policy.gstPercent`. It must use the placement's `gstPercentAtCreation` (an old invoice never changes when GST changes).
- The payout code (`createReferralPayout`, `disbursePayout`, `retryPayout`, `resolvePayout`, payout webhook) is **money out** — leave it exactly as it is. Phase 18 replaces it.

**Out of scope — do not build:** refunds, referral payouts and joining rewards going out (Phase 18), `PayoutAccount` (Phase 18), the joining reward itself (Phase 17), statement file upload (manual entry is enough for now), a real bank integration (mock only).

---

## How this phase runs

One task after another, in order, each on its own branch; build on the latest `main`, push, wait for GitHub Actions green **on the branch**, fix on the branch, merge by pull request, tick. **Commit and push the task branch after every meaningful change** so a crash never loses work. Use GitHub Actions as the test runner. Every rule number comes from `PricingService.current()`; every link sent outside the app uses `publicLink()`. If the spec and code disagree in a way this spec doesn't answer, stop and ask.

---

### [x] Task 1 — Payment records for UPI, and one place where success is handled
**Branch:** `phase-16/task-1-payment-columns` · **Migration folder:** `20261109100000_payment_upi_columns`

**Acceptance:**
- New `Payment` columns from data-design §10: `method` (`upi_direct` default, `gateway_card`), `upiReference` (unique), `expectedAmountPaise`, `bankUtr` (unique), `confirmedBy` (`bank_feed`, `finance_manual`, `gateway`), `confirmedByStaffId`, `confirmedAt`, `approvedByStaffId`, `approvedAt`, `payoutAccountId` (unused until Phase 18). Plus `payerUtrHint` (string?) — a UTR the payer typed in, only a hint. Add `joining_reward` to the `type` list (used in Phase 17).
- **`gatewayReference` becomes nullable.** Existing rows keep theirs.
- **One function, `onPaymentSucceeded(paymentId, { confirmedAt, confirmedBy, confirmedByStaffId? })`**, does everything that happens when money is confirmed, idempotently (a second call changes nothing):
  - `activation` (and reactivation): the job seeker becomes active exactly as today, and **the 30-day clock starts at `confirmedAt`** (whatever field the existing clock reads, e.g. `paymentReceivedAt`, is set from `confirmedAt`);
  - `placement_fee`: everything Phase 15 wired — placement `confirmed`, `paidAt`, job seeker `placed`, joining date sent once.
  The existing gateway webhook now calls this function with `confirmedBy: gateway`. Nothing else changes about the gateway webhook.
- `StatusHistory` for every payment status change; `AuditLog` never contains a UTR's owner, a UPI ID or a name.
- Tests: calling `onPaymentSucceeded` twice changes nothing the second time; an activation confirmed through it starts the clock at `confirmedAt`; a placement fee confirmed through it sets `placed` and sends the joining date once; the existing gateway tests still pass unchanged; a payment can be saved with no `gatewayReference`.

### [x] Task 2 — A QR code and link for every payment
**Branch:** `phase-16/task-2-upi-request` · **No migration**

**Acceptance:**
- Two new environment variables, `COMPANY_UPI_VPA` (Laboura's business UPI ID) and `COMPANY_UPI_PAYEE_NAME`, declared in `render.yaml` with no values and explained in `DEPLOY.md`. They are **not** required for the server to start (a missing UPI ID doesn't weaken security, and staff must still be able to log in before the bank account exists); instead, creating a payment request without them fails with a clear message, and the existing health check reports "UPI collection not configured".
- `UpiCollectionService.createRequest({ type, subjectType, subjectId, amountPaise, ... })` creates a `pending` `Payment` with `method: upi_direct`, `expectedAmountPaise` = the exact amount, and `upiReference` = the payment's own code plus a short random suffix (unique, safe for a UPI note).
- The UPI link follows the standard UPI format — `upi://pay?pa=<VPA>&pn=<payee name>&am=<amount in rupees with 2 decimals>&tn=<short note>&tr=<upiReference>&cu=INR` — and the QR code encodes exactly that link (use a QR library, pinned version).
- **One request per obligation.** Sending the link again re-sends the same request; it never creates a second payment with a new reference for the same thing.
- **The payment page** (public, single-use-token link via `publicLink()`, sent by SMS and WhatsApp with template `payment_request`): shows what it's for, the amount, the payee name, the QR code, a **Pay with a UPI app** button (the `upi://` link), a **Pay by card** option (Task 4), and an optional box: "Paid already? Enter your UPI reference number (12 digits) to help us find it faster" → saved as `payerUtrHint`. **There is no screenshot upload anywhere**, and the page says payment is confirmed once it reaches Laboura's bank.
- Tests: the UPI link has the exact amount and reference; the QR decodes to the same link; re-sending doesn't create a second payment; a request without `COMPANY_UPI_VPA` fails clearly while the server still starts; a typed UTR hint never marks a payment succeeded; no route accepts an image as payment proof.

### [x] Task 3 — Confirming the money: the bank's notice, or Finance
**Branch:** `phase-16/task-3-confirmation` · **Migration folder:** `20261109110000_add_bank_credit`

**Acceptance:**
- **New table `BankCredit`** (not in data-design §10 — added because both the bank's notice and Finance's manual entry need one place to record money that arrived, including money that matches nothing): `id`, `bankUtr` (unique), `amountPaise`, `receivedAt`, `payerName`, `payerVpaMasked` (part of the UPI ID only), `remark` (the note the payer's app carried), `source` (`bank_feed`, `finance_manual`), `enteredByStaffId`, `status` (`unmatched`, `matched`, `ignored`), `matchedPaymentId`, `ignoredReason`, `createdAt`. Never editable after `matched`.
- **The bank's notice:** a `BankFeedProvider` interface with a mock. `POST /payments/bank-feed/webhook` checks the signature (secret `BANK_FEED_WEBHOOK_SECRET`, declared in `render.yaml`), stores a `BankCredit` (idempotent by `bankUtr` — a repeat changes nothing), then tries to match it: a `pending` `upi_direct` payment whose `upiReference` appears in the remark **and** whose `expectedAmountPaise` equals the amount → `succeeded` through `onPaymentSucceeded` with `confirmedBy: bank_feed`, `bankUtr` set, credit `matched`.
- **Anything that doesn't match exactly is never confirmed automatically.** Right reference but wrong amount, an unknown reference, or no reference → the credit stays `unmatched` and a `payment_mismatch` `ReviewFlag` is raised (add it to the closed list) for Finance.
- **Finance by hand** (CEO and Finance only): `POST /payments/bank-credits` records a credit from the bank statement (UTR, amount, date, payer name, remark) as `source: finance_manual`; `POST /payments/:id/confirm` with `{ bankCreditId }` matches it to a pending payment **only if the amounts are equal** → `succeeded` through `onPaymentSucceeded`, `confirmedBy: finance_manual`, `confirmedByStaffId`. `POST /payments/bank-credits/:id/ignore` with a required reason (e.g. money unrelated to Laboura). Every one is audited.
- Finance sees the payer's `payerUtrHint` next to each pending payment to speed matching; a hint that equals a credit's UTR is highlighted, but still needs Finance to press confirm.
- A UTR can be matched to one payment only, ever.
- Tests: a bank notice with the right reference and amount confirms the payment and starts the clock; the same notice twice changes nothing; a wrong amount raises `payment_mismatch` and confirms nothing; an unknown reference stays unmatched; Finance can confirm only equal amounts; a manager, team lead or agent is refused on every Finance route; a UTR can't be used twice; a bad webhook signature is refused.

### [x] Task 4 — Card payments, only when the payer chooses card
**Branch:** `phase-16/task-4-card` · **No migration**

**Acceptance:**
- **Pay by card** on the payment page switches that same payment to `method: gateway_card` and starts the existing gateway charge (`createCharge`) for the same amount; `gatewayReference` is set then. The gateway's success webhook confirms it through `onPaymentSucceeded` with `confirmedBy: gateway`.
- If a UPI credit for that payment's reference arrives after the payer switched to card (they paid twice), it is **not** confirmed again: the credit stays `unmatched` with a `payment_mismatch` flag so Finance can refund it in Phase 18.
- The gateway is never used unless the payer picks card.
- Tests: choosing card creates one gateway charge and sets `gatewayReference`; the card webhook confirms through the shared function; a later UPI credit for the same payment raises a flag instead of a second confirmation; nothing calls the gateway for a UPI payment.

### [x] Task 5 — Registration and placement fees move to UPI; the invoice is automatic
**Branch:** `phase-16/task-5-switch-to-upi` · **No migration**

**Acceptance:**
- **₹499 registration and re-registration:** `createActivationPayment` creates a UPI request through `UpiCollectionService` (amount from `activationFeePaise`) and sends the payment link to the job seeker, instead of a gateway charge. Re-registration after 3 hits works the same way.
- **Placement fee:** when Phase 15 creates the `awaiting_payment` placement, the fee request goes out at once as a UPI request to the owner (`Business.phone`) for `placementFee + gstAmount`, replacing the temporary gateway call. `paymentDueAt` and the `payment_overdue` flag stay as Phase 15 built them.
- **The GST invoice is created automatically** when a placement fee is confirmed: the invoice number is assigned then (reusing `getInvoice`'s numbering), and a link to it is sent to the owner. **`getInvoice` uses the placement's `gstPercentAtCreation`**, never today's policy, so an old invoice never changes.
- The ₹499 gets a simple receipt link, no GST invoice (no GST is added to it; the CA will confirm how GST sits inside it).
- Tests: an activation request is UPI, not a gateway charge, and starts the clock only when confirmed; a selected interview sends the owner one UPI request for fee plus GST; confirming it creates the invoice number and sends the link once; changing GST in `PricingPolicy` doesn't change an existing invoice.

### [x] Task 6 — Screens
**Branch:** `phase-16/task-6-screens` · **No migration**

**Acceptance (existing consoles, plain styling):**
- **Finance:** pending payments (amount, reference, due time, payer's UTR hint); unmatched bank credits; **Add bank credit**, **Match**, **Ignore** with reason; `payment_mismatch` flags.
- **Agents and Team Leads:** on a job seeker or placement, the payment status (waiting, paid, overdue) and a **Resend payment link** button — never a "mark as paid" button for anyone but Finance's match action.
- The public payment page from Task 2 renders on a phone screen.
- Tests: screens render for the allowed roles; no agent page offers any way to mark a payment paid; the payment page shows no screenshot upload.

---

## Phase 16 Gate

- [ ] Every registration and placement fee is a UPI request with its own reference and exact amount; re-sending never creates a second payment — by test
- [ ] A payment becomes `succeeded` only from the bank's notice with an exact match, Finance matching a recorded bank credit of the same amount, or the card gateway — never from a screenshot, a typed UTR or an agent — by test
- [ ] A wrong amount or unknown reference is never confirmed and raises `payment_mismatch` — by test
- [ ] Success is handled in one function, idempotently, whatever confirmed it; the 30-day clock starts when the money is confirmed — by test
- [ ] Only CEO and Finance can record, match or ignore bank credits — by test
- [ ] The GST invoice is created automatically on confirmation and uses the placement's own GST percent — by test
- [ ] **End-to-end proof, recorded in the report:** a job seeker is sent a ₹499 UPI link; they type a UTR hint (nothing changes); the mock bank sends a credit with the right reference and ₹499 → the payment succeeds, the job seeker is active and the clock starts at the credit time. An owner selects a candidate at ₹16,000 → a UPI request for ₹8,000 + ₹1,440 goes to the owner; the bank sends ₹9,000 by mistake → nothing is confirmed and Finance sees a mismatch; Finance records the correct ₹9,440 credit from the statement and matches it → the placement is confirmed, the job seeker `placed`, the joining date sent, and the invoice created with 18% GST. A second owner pays by card through the gateway and is confirmed the same way.
- [ ] All earlier phase gate items still pass; CI green on `main`; every task branch was green before merging; `LESSONS.md` updated

**When the gate passes: stop and report to Agastya.** Commits, CI links, test counts, one line per task, any tests changed and why, and the end-to-end proof. Do not start the next phase.
