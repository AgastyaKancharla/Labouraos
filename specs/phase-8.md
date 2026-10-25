# Phase 8 — Scale, Compliance Hardening & Launch Readiness

**Goal:** prove the system holds up at the 40-agent target headcount under
real concurrent load, and close the remaining go-live compliance gaps (GST
invoicing, data retention/erasure, and the placement-data export for the
draft Placement Agency Bill) that have had no home in any earlier phase.

**Why this is next:** Phase 7 makes every integration real. This phase is the
last one before go-live — it answers "does it hold up at full headcount" and
"are we compliant enough to actually launch," not "does another feature
exist." Nothing in this phase changes a business rule or adds a user-facing
feature; it's entirely hardening and closing documented gaps.

**Out of scope for Phase 8 — do not build these:** any new business feature,
any new role, any change to a money rule in `AGENTS.md` §6. The Laboura
Enterprise vertical (flagged in the Playbook as fully post-launch, not scoped
into any phase) — do not touch it here either.

> Read `AGENTS.md` §2 and §9 before writing this phase. Read `LESSONS.md`
> first. Read the Playbook's "Known gaps in the build plan" section (via
> Agastya if you don't have direct access to it) for the exact wording of the
> three gaps this phase closes, so the acceptance criteria below match what
> was actually promised.

---

## Tasks

### [ ] Task 1 — Load and concurrency testing at target headcount

**Acceptance:**
- A load-test script (k6, Artillery, or similar — document the choice in
  `AGENTS.md` §3) simulates the target headcount from the Playbook: ~40 staff
  accounts (≈20 call agents, ≈20 field agents) hitting the API concurrently
  across a representative mix of endpoints (onboarding writes, the Priority
  Dashboard reads, placement/payment writes)
- Report, don't just pass/fail: p50/p95/p99 response times per endpoint group,
  and whether the database connection pool or BullMQ queue saturates under
  that load
- If a bottleneck is found, fix what's clearly wrong (a missing index, an
  N+1 query, an undersized connection pool) — but if fixing it would mean
  changing a business rule or a data model relationship in a way `AGENTS.md`
  §11 says to ask first about, stop and ask rather than guessing
- Test: the load-test script itself runs in CI (or is documented as a manual
  pre-launch step if it's too slow/expensive for every CI run — your call,
  document which and why)

---

### [ ] Task 2 — GST invoice generation (closes a known gap)

**Acceptance:**
- This closes the Playbook's flagged gap: GST invoice generation has no home
  in any phase despite being promised ("Invoicing module built in," per the
  Playbook's Tech/Vendor Status section)
- `GET /placements/:id/invoice` (or equivalent, finance/ceo/manager) generates
  a GST-compliant invoice (SAC 9985 family, 18%, per `AGENTS.md` §6) for a
  confirmed placement's fee payment — reusing `calculateGst`/
  `calculatePlacementFee` from `src/common/money/money.ts`, not
  recalculating independently
- Output format: PDF is the expected deliverable for something a business
  receives, but if that's a significant lift, a structured response (the
  invoice's line items/totals as JSON) that a frontend can render is an
  acceptable first cut — note which you built and why
- Invoice numbering is sequential and auditable, same spirit as the existing
  `JS-`/`PAY-` prefixed codes (§8) — do not reuse the Payment's own code as
  the invoice number if they need to diverge for GST-filing reasons
- Test: invoice total matches `calculatePlacementFee` + `calculateGst` exactly
  for a salary that doesn't divide evenly (same rounding-edge-case spirit as
  Phase 5 Task 3)

---

### [ ] Task 3 — Data retention and erasure (closes a known gap)

**Acceptance:**
- This closes the Playbook's flagged gap: data retention/erasure was never
  built despite being a DPDP requirement
- A documented retention period per entity type that can carry PII (job
  seeker, referral, business contact, staff) — ask Agastya for the actual
  numbers if they aren't already in `AGENTS.md`; do not invent them, per §2
  rule 6's spirit (this is a compliance rule, not a money rule, but the same
  "stop and ask rather than guess" logic applies)
- A scheduled job (BullMQ, same pattern as other scheduled jobs in
  `/src/jobs/`) that identifies records past their retention window and either
  anonymizes or deletes them per the documented policy — audit logged
  regardless of which
- A manual erasure endpoint (ceo/manager only) for a DPDP data-subject
  erasure request, separate from the automatic retention job
- Test: a record past its retention window is caught by the job; one within
  the window is not touched; a manual erasure request is audit logged and
  actually removes/anonymizes the targeted record

---

### [ ] Task 4 — Placement-data export (closes a known gap)

**Acceptance:**
- This closes the Playbook's flagged gap: the Private Placement Agency
  (Regulation) Bill, 2025's draft requirement to upload placement data to a
  government portal within 60 days of recruitment has no export path
- `GET /placements/export` (ceo/manager/finance) returning placement records
  in a structured, documented format (CSV is a reasonable default unless the
  draft bill specifies otherwise) with the fields a government portal upload
  would plausibly need (placement date, trade, parties' unique IDs — not raw
  PII beyond what's already masked elsewhere for Finance)
- This is a data-shape task, not a real government-portal integration — no
  portal exists yet to integrate with; build the export, not a submission
  flow
- Test: export includes only placements, matches the existing masking rules
  for any PII fields

---

### [ ] Task 5 — Final pre-launch gate

**Acceptance:**
- Every gate item from Phases 1 through 7 is re-run and confirmed passing on
  current `main`, in one pass, with the output noted in the report — not
  re-asserted from memory of earlier phases' gates
- A written go-live checklist cross-check against the Playbook §8 Go-Live
  Checklist: which items are code-complete after this phase (most of it is
  organizational/Sanket-owned, not code — note which few actually are code)
- `LESSONS.md` reviewed end-to-end once, not just appended to, to confirm it
  still reads correctly after 8 phases (fix anything stale, don't rewrite
  history)

---

## Phase 8 Gate

- [ ] Load test report exists and is reviewed; any fixed bottleneck is
  documented in `LESSONS.md`
- [ ] GST invoice total exactly matches `calculatePlacementFee` +
  `calculateGst`, by test
- [ ] A record past its retention window is caught by the scheduled job and a
  record within the window is not, by test
- [ ] A manual DPDP erasure request is audit logged and actually
  removes/anonymizes the record, by test
- [ ] The placement-data export excludes unmasked PII beyond what Finance
  already sees elsewhere, by test
- [ ] All Phase 1–7 gate items still pass, confirmed in one pass on current
  `main`
- [ ] `LESSONS.md` updated

**When the gate passes: stop. Report to Agastya. This is the last build
phase — do not start anything further without a new spec.**
