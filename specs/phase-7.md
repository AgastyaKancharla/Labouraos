# Phase 7 — Real Telephony, Messaging, Payment & KYC Integration

**Goal:** swap every provider that has been running on a mock since earlier phases
(OTP/SMS, WhatsApp, telephony, payment collection, referral payout disbursement,
Aadhaar e-KYC) for a real vendor integration, behind the same provider-interface
pattern already established — and close the consent-capture gap that real call
recording makes unavoidable.

**Why this is next:** everything through Phase 6 is a complete, correctly-RBAC'd,
correctly-tested system of record — but every "send a message," "make a call,"
"move money," or "verify an identity" action in it is still a mock. Agastya's
company registration, GST, payment gateway and telephony vendor are all expected
to be finalized within about two weeks of this phase starting. This phase makes
the swap a config change plus a round of integration testing, not a redesign —
if real credentials land mid-phase, nothing here should need to be rebuilt to
use them.

**Out of scope for Phase 7 — do not build these:** load/concurrency testing for
40 agents, observability, security hardening, backup/disaster recovery, GST
invoice generation, data retention/erasure, the placement-data export for the
draft Placement Agency Bill, and the final Go-Live Checklist close-out (all
Phase 8). Any new business rule — if a real vendor's behavior conflicts with a
rule in `AGENTS.md` §6, stop and ask; do not quietly adjust the rule to fit the
vendor.

> Read `AGENTS.md` §1, §2 (especially rule 7 — idempotency — and rule 8 — no
> secrets in code), and §6 before writing this phase. Read `LESSONS.md` first.
> Read the existing `OtpProvider` (`src/common/otp/otp.interface.ts`,
> `src/common/otp/mock-otp.provider.ts`), `PaymentProvider`
> (`src/modules/payment/payment-provider.interface.ts`), and `KycProvider`
> (Phase 2 Task 7) — every task in this phase follows that exact
> mock-then-real, dependency-injected pattern. Do not invent a different
> pattern for telephony or WhatsApp.

---

## Tasks

### [ ] Task 1 — Provider switching, config and secrets

**Acceptance:**
- A single, documented mechanism (environment variable per provider, e.g.
  `OTP_PROVIDER_MODE=mock|real`, `PAYMENT_PROVIDER_MODE=mock|real`,
  `TELEPHONY_PROVIDER_MODE=mock|real`, `WHATSAPP_PROVIDER_MODE=mock|real`,
  `KYC_PROVIDER_MODE=mock|real`) selects which implementation NestJS's DI
  container binds to each provider token (`OTP_PROVIDER`, the payment provider
  token, the existing KYC provider token, and the two new ones this phase
  introduces — name them consistently with the existing ones)
- Defaults to `mock` everywhere if the env var is unset, so existing tests and
  local dev keep working untouched
- Real vendor API keys/secrets are read only from environment variables, never
  committed — per `AGENTS.md` §2 rule 8. Add the new variable names (not
  values) to `.env.example`
- Document the switch mechanism in `AGENTS.md` §3 (already noted there as of
  this spec being written — confirm it still matches what you actually build)
- Test: with the mode env var unset or set to `mock`, the mock provider is
  injected; this is testable by checking which concrete class the DI token
  resolves to, without needing real credentials

---

### [ ] Task 2 — Real SMS/OTP provider (DLT-compliant)

**Acceptance:**
- A second implementation of `OtpProvider` wired to a real DLT-registered SMS
  vendor's API, selected by Task 1's switch
- Reuses the existing `OtpProvider` interface and `OTP_PROVIDER` DI token
  exactly as-is — do not change the interface's shape to fit the vendor; adapt
  the vendor's API to the interface
- Commercial-message timing (`AGENTS.md` §6 — 09:00–21:00 IST) is enforced the
  same way regardless of which provider is active
- If real credentials aren't available yet when this task is built, implement
  against the vendor's documented API and write tests against a stubbed HTTP
  layer (mock the HTTP call, not the provider) — don't block the task on
  having live credentials in hand
- Audit logged (send attempts, not OTP codes themselves)
- Test: a failed/undeliverable send surfaces as a clear error, not a silent
  swallow

---

### [ ] Task 3 — WhatsApp Business API provider

**Acceptance:**
- New `WhatsAppProvider` interface (`sendTemplateMessage(phone, templateName,
  params)` at minimum) with a `MockWhatsAppProvider` (records the attempt,
  same style as `MockOtpProvider`) and a real implementation using the
  WhatsApp Business API with pre-approved templates, switched per Task 1
- This is the "whatsapp" leg already referenced in
  `src/modules/job-seeker/job-seeker.service.ts`'s contact-attempt recording
  and `src/jobs/no-pickup-evaluation.job.ts`'s 3-hit evaluation — wire the
  no-pickup job's WhatsApp leg to actually call this provider (currently that
  leg is only ever manually logged by a call agent through the console; this
  task makes it real for the automated path, without changing the manual
  logging path call/field agents already use)
- Only pre-approved template messages are sent — no free-form text (WhatsApp
  Business API policy)
- Audit logged
- Test: template send success/failure is recorded; a job seeker's automated
  WhatsApp leg of the 3-hit cycle fires through this provider, not a direct
  HTTP call buried in the job

---

### [ ] Task 4 — Telephony provider (toll-free calling)

**Acceptance:**
- New `TelephonyProvider` interface covering, at minimum: receiving an
  inbound-call/missed-call webhook event, and initiating a click-to-call
  outbound call for a call agent — with a `MockTelephonyProvider` and a real
  implementation against the chosen vendor's API, switched per Task 1
- Inbound missed-call webhook creates (or surfaces to) a call agent's dial
  queue — reuse the existing job-seeker/referral/business onboarding entry
  points rather than inventing a new one; this is the production version of
  the "missed call to toll-free" step already described in the Playbook's
  core flows
- Idempotent per `AGENTS.md` §2 rule 7 — the same webhook delivered twice must
  not create two queue entries or two onboarding attempts
- Webhook signature/auth verification against the vendor's spec
- Confirm with the vendor contract that concurrent-line capacity covers 40
  agents calling at once (Playbook §7) — if this can't be verified in code,
  document the confirmation as a manual sign-off item in the gate below
  rather than skipping it silently
- Audit logged
- Test: a duplicate webhook delivery is a no-op; an inbound call with no
  matching existing record creates exactly one new dial-queue entry

---

### [ ] Task 5 — Call recording and consent capture (closes a known gap)

**Acceptance:**
- This closes the Playbook's flagged gap: consent capture was never built in
  Phase 2 despite being required by DPDP and part of the stated onboarding
  flow. Real call recording (this phase) is what makes it non-optional, so it
  belongs here rather than being retrofitted later.
- When a call is recorded (per Playbook §4/§5 — legal when a participant
  records, DPDP requires a consent announcement), log: that a consent
  announcement was played/stated, a timestamp, and the call/record it's
  attached to. Store this as its own auditable record, not a free-text note.
- `isConsentLogged` (or equivalent) is checked before a recorded call's
  reference is retained; if consent wasn't logged, the recording reference
  itself is not persisted (only the fact that the call happened)
- **Retention (LOCKED in `AGENTS.md` §6 — resolved 2026-10-25):** no automatic
  expiry. Call recordings are kept indefinitely by default, same as every
  other record in this system. Do not build a scheduled deletion/expiry job
  for recordings. The only way a recording's PII gets touched is the manual,
  explicit erasure mechanism (same one as Phase 8 Task 3) invoked for a
  specific record on a specific request — never automatically, never in
  bulk.
- Audit logged
- Test: a call recorded without logged consent does not retain the recording
  reference; one with logged consent does, and is retrievable by the
  call/placement it's attached to

---

### [ ] Task 6 — Real payment gateway (collection)

**Acceptance:**
- A second implementation of the existing `PaymentProvider` interface
  (`src/modules/payment/payment-provider.interface.ts`) wired to the real
  collection gateway, switched per Task 1 — covers the ₹499 activation payment
  (Phase 2 Task 5) and the placement-fee-plus-GST payment (Phase 5 Task 3)
- Webhook idempotency (already required by `AGENTS.md` §2 rule 7 and already
  tested against the mock in earlier phases) is re-verified against the real
  gateway's actual webhook delivery semantics — vendors differ on retry
  behavior, so don't assume the mock's tests fully cover the real one
- No change to the interface shape; adapt the vendor to it
- Test: a real-gateway webhook retried twice does not double-charge or
  double-record

---

### [ ] Task 7 — Real payout API (referral disbursement)

**Acceptance:**
- A second implementation of `PaymentProvider.disbursePayout` (added in Phase
  6 Task 2) wired to a real payout API (e.g. RazorpayX/Cashfree payouts, per
  the Playbook — confirm which with Agastya if not already decided), switched
  per Task 1
- This is a separate vendor/product from Task 6's collection gateway per the
  Playbook — do not assume one vendor does both unless Agastya confirms it
- Same idempotency and audit requirements as Phase 6 Task 2
- Test: a disbursement retried against the real provider's webhook does not
  pay out twice

---

### [ ] Task 8 — Real Aadhaar e-KYC vendor

**Acceptance:**
- `KycProvider` (Phase 2 Task 7) gets a real implementation against the
  licensed OVSE vendor Agastya has chosen (Surepass / Signzy / HyperVerge per
  the Playbook's Tech/Vendor Status), switched per Task 1
- Re-run the Phase 2 Task 7 "no raw Aadhaar number stored" test
  (`AGENTS.md` §2 rule 3, §6 Identity) against the real vendor's actual
  response shape — vendor responses sometimes echo more fields than
  expected; verify nothing beyond the verification result and vendor
  reference is ever persisted
- No change to the `KycProvider` interface shape; adapt the vendor to it
- Test: a real-vendor KYC response is stored with only the result and
  reference ID, never a raw Aadhaar number, even if the vendor's raw
  response includes one

---

### [ ] Task 9 — RBAC and seed data for this phase

**Acceptance:**
- No RBAC surface changes in this phase (no new roles, no new permission
  shapes) — this task is about proving the existing RBAC still holds with
  real providers wired in, and about seed data for manual QA
- `npm run seed` extended: at least one of each provider's mock-mode record
  (OTP send, WhatsApp template send, inbound telephony webhook, consent-logged
  recording, KYC verification) so a reviewer can see the shapes without
  needing live credentials

---

## Phase 7 Gate

- [ ] Every provider introduced in this phase defaults to its mock
  implementation when the mode env var is unset, by test
- [ ] Switching a provider's mode env var to `real` changes which concrete
  class is injected, by test (without requiring live credentials to prove the
  wiring itself)
- [ ] A duplicate inbound telephony webhook is a no-op, by test
- [ ] A call recording is retained only when consent was logged, by test
- [ ] A duplicate payment-collection webhook does not double-charge, by test
- [ ] A duplicate payout webhook does not double-pay, by test
- [ ] The real KYC vendor's response is stored without ever persisting a raw
  Aadhaar number, by test
- [ ] The telephony vendor's concurrent-line capacity for 40 agents is
  confirmed — either verified in code or explicitly noted as a manual
  sign-off in the report
- [ ] No vendor secret or API key appears anywhere in the committed code — spot-checked and noted in the report
- [ ] All Phase 1–6 gate items still pass
- [ ] `LESSONS.md` updated

**When the gate passes: stop. Report to Agastya. Do not start Phase 8.**
