# Phase 2 — Job Seeker & Referral Pipeline

**Goal:** a call agent can fully onboard a job seeker or a referral by phone: capture their details, verify their number by OTP, take the ₹499 activation payment, and have the system record when their 30-day refund guarantee expires — without anyone touching the database directly.

**Why this is next:** Phase 1 built the spine (who can log in, who can touch what, audit trail). Phase 2 is the first phase that does real Laboura business: it is the front door every job seeker and referral walks through. Nothing in later phases works without it.

**Out of scope for Phase 2 — do not build these:** the 3-hit cycle and deactivation (Phase 3), businesses and vacancies (Phase 4), placements (Phase 5), referral payouts (Phase 6), the Admin Dashboard / Call Agent console / Field Agent app UI (Phase 6) — this phase is API only. Real OTP/SMS and payment vendors are not available yet (blocked on Phase 0 company registration) — build against a pluggable provider interface with a sandbox/mock implementation that behaves like the real thing; swapping in live credentials later should mean changing environment variables, not code.

> Read `AGENTS.md` first, especially §6 Job seeker side and Referral side. Read `LESSONS.md` before fixing any bug.

---

## Tasks

### [x] Task 1 — OTP provider interface and mock implementation

A pluggable interface so the real SMS/OTP vendor can be swapped in later without touching calling code.

**Acceptance:**
- An `OtpProvider` interface: `sendOtp(phone): Promise<{requestId}>` and `verifyOtp(requestId, code): Promise<boolean>`
- A `MockOtpProvider` implementation: generates a 6-digit code, logs it (never SMS'd for real), accepts it once, rejects reuse and wrong codes
- Provider selected via environment variable, defaulting to mock
- Tests: correct code verifies once; wrong code fails; a verified code cannot be reused; an expired request (configurable TTL) fails

---

### [x] Task 2 — Job seeker registration

**Acceptance:**
- `POST /job-seekers` (call_agent, manager, ceo only) accepts: mobile number, trade/skill, minSalary, maxSalary, preferredCallWindowStart/End, city
- `preferredCallWindowStart/End` must fall inside 09:00–21:00 IST; anything outside is rejected with a clear error, not silently clamped
- `minSalary <= maxSalary`, both positive integers in paise
- Record created with `status: pending_payment`, a `JS-` code issued
- Mobile number must pass OTP verification (Task 1) before the record is created — `POST /job-seekers` without a verified OTP request is rejected
- Test: a call_agent token can create one; a field_agent or finance token cannot (403)
- Audit log entry on creation

---

### [x] Task 3 — Referral registration

**Acceptance:**
- `POST /referrals` (call_agent, manager, ceo) — name, mobile number, type (individual/business)
- Same OTP-verification requirement as job seekers
- `RF-` code issued, audit logged
- A job seeker created later can optionally carry a `referredById` pointing at a referral's id — validate it exists if provided

---

### [x] Task 4 — Payment provider interface and mock implementation

**Acceptance:**
- A `PaymentProvider` interface: `createCharge(amountPaise, subjectType, subjectId): Promise<{paymentLink, gatewayReference}>` and a webhook verification method
- A `MockPaymentProvider`: returns a fake link, and exposes a test-only endpoint to simulate the webhook firing (success/failure) — used by tests and by you manually while no real gateway exists
- Provider selected via environment variable
- Every `gatewayReference` is unique at the database level (already in the Payment schema from Phase 1) — a second webhook with the same reference is a no-op, not a new Payment row

---

### [x] Task 5 — ₹499 activation payment and webhook

**Acceptance:**
- `POST /job-seekers/:id/activation-payment` creates a `Payment` row (`type: activation`, `amount: 49900`, `status: pending`) and returns the payment link
- Webhook endpoint receives the payment provider's callback, verifies its signature/authenticity, and on success:
  - sets the `Payment.status` to `succeeded`
  - sets the job seeker's `status` to `active`
  - records `paymentReceivedAt` (UTC) on the job seeker
  - audit logs the activation
- **Idempotency test, mandatory**: fire the exact same webhook payload twice — assert exactly one `Payment` row, one audit entry, and the job seeker activated exactly once (no duplicate side effects)
- A webhook for a payment that already failed, or an unknown reference, is rejected cleanly (no crash, no 500)

---

### [x] Task 6 — 30-day refund-guarantee clock

**Acceptance:**
- A money-module function `refundGuaranteeDeadline(paymentReceivedAt)` → `paymentReceivedAt + 30 days`, using injectable time (never `new Date()` inline, per AGENTS.md §9)
- A function `isWithinRefundGuarantee(paymentReceivedAt, now)` → boolean
- This phase only **computes** the deadline and exposes it (e.g. on `GET /job-seekers/:id`); it does **not** approve or process refunds — that happens in Phase 5, once Placement exists to check whether a suitable offer was made
- Tests assert the boundary at day 29, 30, and 31 relative to `paymentReceivedAt`

---

### [ ] Task 7 — Offline Aadhaar e-KYC stub

**Acceptance:**
- `POST /job-seekers/:id/kyc` accepts a KYC vendor reference and result (`verified` / `failed`), sets `kycStatus` and `kycReference`
- **No field anywhere in the request/response/schema stores a raw Aadhaar number.** A test asserts that submitting a 12-digit number under any field name is rejected, not silently stored
- A `MockKycProvider` behind the same pluggable-interface pattern as Tasks 1 and 4
- Audit logged

---

### [ ] Task 8 — RBAC, masking and seed data for this phase

**Acceptance:**
- Finance's read of a job seeker shows the `JS-` code and payment amounts, never the phone number or KYC reference (reuses the Phase 1 masking layer)
- Field agent access to job seekers/referrals is scoped the same way the RBAC matrix intends once an `area` concept applies to them — if this phase's data doesn't yet carry an `area` to scope by, add it via migration, or confirm with a denial test that field agents simply have no access to this module yet
- `npm run seed` extended: a few job seekers in different cities, at least one each in `pending_payment` and `active` status, one referral

---

## Phase 2 Gate

- [ ] A call agent can register a job seeker, verify OTP, and the activation payment webhook (simulated) activates them — proven end to end by an automated test
- [ ] The exact-same webhook fired twice produces exactly one `Payment` row and one activation, by test
- [ ] `preferredCallWindowStart/End` outside 09:00–21:00 IST is rejected, by test
- [ ] No raw Aadhaar number can be stored under any field name, by test
- [ ] Refund-guarantee deadline is correct at day 29/30/31, by test
- [ ] Finance's view of a job seeker never includes phone or KYC reference, by test
- [ ] All Phase 1 gate items still pass (no regressions)
- [ ] `LESSONS.md` updated with anything non-obvious

**When the gate passes: stop. Report to Agastya. Do not start Phase 3.**