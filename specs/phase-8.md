# Phase 8 — Scale, Observability, Security & Launch Readiness

**Goal:** prove the system holds up at the 40-agent target headcount under
real concurrent load, add the observability and security hardening a
production system needs, prove backups are actually restorable, close the
remaining go-live compliance gaps (GST invoicing, data retention/erasure, the
placement-data export for the draft Placement Agency Bill), and walk the
Playbook's Go-Live Checklist line by line. This is the last build phase
before a go/no-go call.

**Why this is next:** Phase 7 makes every integration real. This phase
answers "does it hold up at full headcount," "can we see and respond to
problems in production," "is it secure," and "are we actually compliant
enough to launch" — not "does another feature exist." Nothing in this phase
changes a business rule, adds a user-facing feature, or touches the Laboura
Enterprise vertical (flagged in the Playbook as fully post-launch, not
scoped into any phase).

**Out of scope for Phase 8 — do not build these:** any new business feature,
any new role, any change to a money rule in `AGENTS.md` §6, the Laboura
Enterprise vertical.

> Read `AGENTS.md` §2 and §9 before writing this phase. Read `LESSONS.md`
> first. Read the Playbook's "Known gaps in the build plan" section and §8
> Go-Live Checklist (via Agastya if you don't have direct access to it) so
> Tasks 2–4 and Task 8 below match what was actually promised.

---

## Tasks

### [ ] Task 1 — Load and concurrency testing at target headcount

**Acceptance:**
- A load-test script (k6, Artillery, or similar — document the choice in
  `AGENTS.md` §3) simulates the target headcount from the Playbook: ~40 staff
  accounts (≈20 call agents, ≈20 field agents) performing realistic mixed
  traffic (onboarding writes, payments, vacancy capture, placement actions,
  Priority Dashboard reads) concurrently against a staging environment
- No RBAC check, money calculation, or audit log entry is dropped or
  corrupted under concurrent load — specifically re-test concurrent webhook
  delivery (Phase 2/5/6/7) and concurrent unique-ID generation (Phase 1
  Task 5) at higher volume than their original single-threaded tests used
- Report, don't just pass/fail: actual response times (p50/p95/p99) and
  error rate per endpoint group, not a guess
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

### [ ] Task 5 — Observability

**Acceptance:**
- Structured logging (not `console.log`) across all modules, with a request
  ID generated per request and threaded through everything that request
  touches, so a single call/webhook can be traced end to end in the logs
- Error tracking/alerting wired to something the team will actually monitor
  (even a simple webhook-to-Slack/email is acceptable — document the choice)
- A basic uptime/status dashboard beyond the Phase 1 `/health` endpoint —
  doesn't need to be elaborate, needs to answer "is it up and responding"
  at a glance without reading logs
- Test: a request ID appears consistently across every log line generated
  while handling one request, including inside a BullMQ job it triggers

---

### [ ] Task 6 — Security hardening

**Acceptance:**
- Dependency vulnerability scan (`npm audit` or equivalent) clean, or every
  remaining finding documented with a reason it's accepted (not silently
  ignored)
- Rate limiting on auth and OTP endpoints specifically (brute-force
  protection) — a login or OTP-verify attempt beyond a reasonable threshold
  from the same identity/IP is throttled, not silently allowed forever
- Secrets audit: confirm nothing from Phase 7's real-vendor work ever leaked
  a key into logs, error messages, or version control — re-check git
  history with something like `git log -p` / a secret-scanning tool, not
  just the current working tree, since a secret committed and later removed
  still lives in history
- `.env` and all credentials confirmed never committed, past or present
- Test: exceeding the rate limit on login/OTP-verify returns a clear
  throttled response, not a 500 or a silent pass-through

---

### [ ] Task 7 — Backup and disaster recovery

**Acceptance:**
- Automated database backups on a defined, documented schedule
- A written restore procedure that has actually been exercised once against
  a scratch/staging database — not merely assumed to work because the
  backup job reports success. Document what was restored, how long it took,
  and any manual step required
- Test/verification: confirm a restored database passes a basic sanity check
  (e.g. `npm run seed`'s invariants, or a known record count) after the
  restore, so "restore succeeded" means something concrete

---

### [ ] Task 8 — Go-Live Checklist close-out and final pre-launch gate

**Acceptance:**
- Walk the Playbook's §8 Go-Live Checklist line by line. For every technical
  item, confirm it's done and link the evidence (a passing test, a config
  value, a documented manual sign-off per Phase 7 Task 4's telephony-capacity
  note). For every non-technical item (company registration, legal review,
  contracts, vendor selection), confirm its status is accurately reflected
  per Agastya and flag anything still genuinely blocking go-live — don't mark
  something done that's actually still pending on his side
- Every gate item from Phases 1 through 7 is re-run and confirmed passing on
  current `main`, in one pass, with the output noted in the report — not
  re-asserted from memory of earlier phases' gates
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
- [ ] A request ID is traceable across every log line for a single request,
  including inside a job it triggers, by test
- [ ] Dependency vulnerability scan is clean or every exception is
  documented and accepted
- [ ] Exceeding the login/OTP rate limit is throttled cleanly, by test
- [ ] A real backup has been restored successfully at least once, with a
  documented sanity check, noted in the report
- [ ] Every item on the Playbook's §8 Go-Live Checklist is either
  done-with-evidence or explicitly flagged as a remaining blocker, in the
  report
- [ ] All Phase 1–7 gate items still pass, confirmed in one pass on current
  `main`
- [ ] `LESSONS.md` updated

**This is the last build-phase gate. When it passes: stop. Report to
Agastya — Laboura is ready for a go/no-go call, not an automatic launch.**
