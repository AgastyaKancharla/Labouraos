# Phase 5 — Placement, Replacement & Refund Lifecycle

**Goal:** a job seeker can actually be placed into a vacancy, the business is charged its placement fee plus GST, and both of the product's money-back guarantees — the business's 60-day replacement guarantee and the job seeker's 30-day refund guarantee — are enforced correctly, including the refund ladder.

**Why this is next:** everything before this phase sets the stage (people, businesses, vacancies). This phase is where Laboura actually earns money and where the two guarantees that carry the most financial risk if built wrong live. It comes after Phase 4 because a Placement needs a real Vacancy and Business to point at.

**Out of scope for Phase 5 — do not build these:** referral payouts (Phase 6 — it depends on `joinedDate`, which this phase sets, but the payout logic itself is built in Phase 6). Any UI (Phase 6).

> Read `AGENTS.md` §6 Business side and Job seeker side (both guarantees, the refund ladder table) very carefully before writing this phase's money logic. Read `LESSONS.md` first.

---

## Tasks

### [x] Task 1 — Placement creation

**Acceptance:**
- `POST /vacancies/:id/placements` — links a job seeker to the vacancy, captures the agreed monthly salary
- Creates a `Placement` (`PL-` code), `status: offered`
- The job seeker's `status` only moves to `placed` once the placement is confirmed (Task 2), not at `offered` — so a pending offer doesn't yet remove them from the active pool or from refund eligibility
- Audit logged

---

### [x] Task 2 — Offer response and confirmation

**Acceptance:**
- `POST /placements/:id/respond` — `accepted` or `rejected`, by or on behalf of the job seeker
- `rejected` → calls Phase 3's `recordHit(jobSeekerId, 'offer_rejected')`, Placement `status: rejected`
- `accepted` → Placement `status: confirmed`, job seeker `status: placed`
- Audit logged
- Test: a rejected offer increments the hit count through the same path as a manually-recorded hit

---

### [x] Task 3 — Placement fee and GST

**Acceptance:**
- Money-module functions from Phase 1 Task 4 (`calculatePlacementFee`, `calculateGst`) are used here, not reimplemented
- On `confirmed`, a `Payment` (`type: placement_fee`) is created for 50% of the agreed monthly salary, plus 18% GST on top, billed to the business — never deducted from the job seeker
- Same payment-provider/webhook/idempotency pattern as Phase 2 Task 5
- Test: GST and fee amounts are correct for a salary that doesn't divide evenly (rounding check, per AGENTS.md §9)

---

### [x] Task 4 — Candidate joining

**Acceptance:**
- `POST /placements/:id/joined` — sets `joinedDate` (the date the candidate actually started), Placement `status: active`
- This is the field Phase 6's referral payout logic will read — this task only needs to set it correctly, not pay anyone yet
- Audit logged

---

### [x] Task 5 — Dropout reporting and the 60-day replacement clock

**Acceptance:**
- `POST /placements/:id/dropout` — only valid on an `active` placement, records `dropoutReportedAt` (this is the clock start, per AGENTS.md §6 — measured from the report date, not the actual leave date), and an `eligibility` field: `employee_left` or `business_breach`
- **`business_breach` dropouts get no guarantee remedy** — the endpoint still records the dropout, but marks the placement ineligible for replacement or refund, per the locked rule
- Audit logged

---

### [x] Task 6 — Replacement flow and the 2-rejection pause

**Acceptance:**
- `POST /placements/:id/replacement-candidates` offers a new candidate against the same dropped vacancy
- Business can reject up to 2 replacement candidates (`POST /placements/:id/replacement-candidates/:candidateId/reject`) — tracked via `replacementRejectionCount`
- On the 3rd rejection, the guarantee clock **pauses**: a flag (`clockPaused: true`) stops the 60-day window from Task 5 advancing further for refund-ladder purposes, until a human resolves it
- Test: 2 rejections don't pause; the 3rd does, and elapsed-day calculations freeze from that point

---

### [ ] Task 7 — Refund ladder and refund approval (business side)

**Acceptance:**
- Uses the Phase 1 Task 4 `calculateRefund(amountPaise, daysElapsed)` function — not reimplemented
- `daysElapsed` is computed from `dropoutReportedAt` to now (or to the pause point if `clockPaused`), using injectable time
- Refund only payable if no replacement was found within 15 days of the dropout report AND `eligibility === 'employee_left'`
- `POST /placements/:id/refund` (ceo, manager approve only, per RBAC §7) — creates a `Payment` (`type: refund`) for the ladder-calculated amount, audit logged
- Tests assert the ladder amount is correct at days 0, 15, 16, 30, 31, 45, 46, 61 relative to `dropoutReportedAt`

---

### [ ] Task 8 — Job seeker 30-day refund approval (finalized)

**Acceptance:**
- This closes the loop opened in Phase 2 Task 6 and extended in Phase 3 Task 4: `isWithinRefundGuarantee` is now also checked against `status !== 'placed'` (a job seeker with a confirmed placement is not refund-eligible even within 30 days, since a suitable offer clearly existed)
- `POST /job-seekers/:id/refund` (ceo, manager approve only) — valid only when the 30 days have elapsed with no placement and no deactivation; creates a `Payment` (`type: refund`, `amount: 49900`), audit logged
- Test: a job seeker placed on day 10 cannot claim the 30-day refund on day 31; one never placed and never deactivated can

---

### [ ] Task 9 — RBAC and seed data

**Acceptance:**
- Finance can read placements and the payment ledger (masked PII) but cannot approve refunds (approval stays CEO/Manager only, per §7)
- `npm run seed` extended: a confirmed+joined placement, a dropped placement within the 15-day replacement window, one past day 60, one with 3 replacement rejections (paused)

---

## Phase 5 Gate

- [ ] Placement fee and GST are calculated correctly and billed to the business, never deducted from the job seeker, by test
- [ ] Rejecting an offer records a hit through the same path Phase 3 built, by test
- [ ] The refund ladder returns the correct amount at every day boundary (0/15/16/30/31/45/46/61), by test
- [ ] A `business_breach` dropout is correctly denied any guarantee remedy, by test
- [ ] The 3rd replacement rejection pauses the clock, and elapsed-day math respects the pause, by test
- [ ] A job seeker's 30-day refund is correctly blocked once they're placed, by test
- [ ] Only CEO/Manager tokens can approve either refund type; all others get 403, by test
- [ ] All Phase 1–4 gate items still pass
- [ ] `LESSONS.md` updated

**When the gate passes: stop. Report to Agastya. Do not start Phase 6.**