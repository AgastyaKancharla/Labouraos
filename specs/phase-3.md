# Phase 3 — Hit Cycle, Deactivation & Reactivation

**Goal:** the system enforces the 3-hit deactivation cycle on its own, driven by logged contact attempts and scheduled jobs — not by a human manually flipping a status field.

**Why this is next:** Phase 2 gets job seekers into the active pool. Phase 3 is what keeps the pool honest — unreachable or uninterested candidates get cycled out automatically, and reactivation brings them back in cleanly with a fresh clock. This has to exist before Phase 5, because Phase 5's refund approval needs to know a job seeker's current hit status.

**Out of scope for Phase 3 — do not build these:** businesses, vacancies, placements (Phase 4/5) — hit reasons like "rejected a suitable offer" are logged here as a plain event with a reason code and free-text note, with no foreign key to a Vacancy, because Vacancy doesn't exist yet. Refund approval and payout (Phase 5). Any UI (Phase 6).

> Read `AGENTS.md` §6 Job seeker side (3-hit cycle rules) before writing any logic here. Read `LESSONS.md` first.

---

## Tasks

### [x] Task 1 — Contact-attempt logging

**Acceptance:**
- `POST /job-seekers/:id/contact-attempts` (call_agent, manager, ceo) — records `channel` (call/whatsapp/sms), `outcome` (picked_up/no_pickup), `attemptedAt`, `timeOfDay` (am/pm)
- No business logic here yet — this is pure record-keeping that Task 2 reads
- Audit logged (it's a write staff makes that affects a job seeker's standing)

---

### [x] Task 2 — Hit recording

**Acceptance:**
- A service function `recordHit(jobSeekerId, reason, note?)` where `reason` is one of: `no_pickup` (requires AM + PM `no_pickup` contact attempts logged for the same day, plus a WhatsApp/SMS attempt — the function verifies these exist before accepting the hit; reject with a clear error if the prerequisite attempts aren't there), `offer_rejected`, `interview_no_show`
- Increments `hitCount`, stores the hit with its reason, timestamp, and the staff member who recorded it (or `system` if from the scheduled job in Task 3)
- Audit logged
- Tests: a `no_pickup` hit without the required logged attempts is rejected; one with them succeeds; `offer_rejected` and `interview_no_show` can be recorded directly by a call/field agent without the attempt prerequisite

---

### [x] Task 3 — Scheduled no-pickup evaluation job

**Acceptance:**
- A BullMQ job, run daily, that scans active job seekers: for any with a qualifying AM+PM no-pickup pattern plus WhatsApp/SMS logged (per Task 2's rule) that hasn't already been converted into a hit, calls `recordHit(..., 'no_pickup')` automatically
- Idempotent: running the job twice on the same day's data does not record the same hit twice
- Test: seed the qualifying attempts, run the job twice, assert exactly one hit recorded

---

### [ ] Task 4 — 3-hit deactivation

**Acceptance:**
- On the 3rd hit, `recordHit` transitions the job seeker's `status` to `deactivated` in the same transaction
- A deactivated job seeker has **no refund entitlement**, regardless of how many days have passed since payment — the eligibility function from Phase 2 Task 6 is extended here: `isWithinRefundGuarantee` must also check `status !== 'deactivated'`
- Audit logged as a status change (before/after)
- Test: 3rd hit flips status and is reflected in refund eligibility immediately; a 2nd hit does not deactivate

---

### [ ] Task 5 — Reactivation

**Acceptance:**
- `POST /job-seekers/:id/reactivate` (call_agent, manager, ceo) only valid on a `deactivated` job seeker — triggers a fresh ₹499 activation payment (reuses Phase 2 Task 5's flow with a `reactivation: true` flag on the Payment)
- On that payment's webhook success: `hitCount` resets to 0, `status` → `active`, `paymentReceivedAt` updated to the new payment's timestamp (so the 30-day clock restarts from zero)
- Audit logged
- Test: reactivate a deactivated job seeker, simulate the webhook, assert hit count is 0, status active, and the refund-guarantee deadline is 30 days from the *new* payment, not the old one

---

### [ ] Task 6 — RBAC and seed data

**Acceptance:**
- Field agent access to contact attempts and hits is scoped the same way as Phase 2 Task 8's note on job seeker access
- `npm run seed` extended: one job seeker with 1 hit, one with 2 hits, one deactivated (3 hits), one reactivated

---

## Phase 3 Gate

- [ ] A job seeker with the right logged attempts gets an automatic no-pickup hit from the scheduled job, by test
- [ ] Running the scheduled job twice never double-records a hit, by test
- [ ] The 3rd hit deactivates and zeroes out refund eligibility in the same transaction, by test
- [ ] Reactivation resets hit count to 0 and restarts the 30-day clock from the new payment, by test
- [ ] A 2-hit job seeker is still refund-eligible (if otherwise within 30 days); a deactivated one never is, by test
- [ ] All Phase 1 and Phase 2 gate items still pass
- [ ] `LESSONS.md` updated

**When the gate passes: stop. Report to Agastya. Do not start Phase 4.**