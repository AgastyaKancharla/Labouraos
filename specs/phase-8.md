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

### [x] Task 1 — Load and concurrency testing at target headcount

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

### [x] Task 2 — GST invoice generation (closes a known gap)

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
- **Company GSTIN (LOCKED 2026-10-25 — build now, don't wait):** AgastyaOne's
  company registration/GST filing for Laboura is still in progress. Read the
  company's GSTIN, legal name and registered address from environment
  variables (e.g. `COMPANY_GSTIN`, `COMPANY_LEGAL_NAME`,
  `COMPANY_ADDRESS`), same mock-then-real spirit as the Phase 7 providers —
  use a clearly-fake placeholder value (e.g. `GSTIN_PENDING_REGISTRATION`)
  when unset, so the invoice still renders correctly end-to-end and the real
  values drop in later as a config change, not a rebuild. Do not block this
  task on registration completing.
- Test: invoice total matches `calculatePlacementFee` + `calculateGst` exactly
  for a salary that doesn't divide evenly (same rounding-edge-case spirit as
  Phase 5 Task 3)

---

### [x] Task 3 — Manual DPDP erasure endpoint (closes a known gap)

**Acceptance:**
- This closes the Playbook's flagged gap, but **not with an automatic
  retention job** — per `AGENTS.md` §6 Data retention (LOCKED 2026-10-25),
  Agastya's explicit call is that nothing is ever automatically deleted or
  anonymized. Every record (job seeker, referral, business, vacancy,
  placement, payment, hit history, call recording) is kept indefinitely by
  default. **Do not build a scheduled retention-expiry job. There is no
  retention period to configure per entity type — this is intentional, not
  a missing number to chase down.**
- Build only the manual side: a CEO/Manager-only endpoint
  (`POST /<entity>/:id/erase` or equivalent, scoped per entity type that
  carries PII) for a DPDP data-subject erasure request. It anonymizes only
  the directly-identifying PII fields (name, phone, Aadhaar reference, exact
  address) on the one targeted record — the record itself, and every
  number/history/relationship tied to it (payments, placements, hit counts),
  is kept exactly as before, just with the personal-identity link severed
- Always one specific record on one specific explicit request — never bulk,
  never scheduled, never triggered by age or dormancy
- Audit logged
- Test: an erasure request anonymizes only the PII fields on the targeted
  record, leaves every other field and every related record untouched, and
  is audit logged; a second erasure request on an already-erased record is a
  safe no-op, not an error

---

### [x] Task 4 — Placement-data export (closes a known gap)

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

### [x] Task 5 — Observability

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

### [x] Task 6 — Security hardening

**Acceptance:**
- Dependency vulnerability scan (`npm audit` or equivalent) clean, or every
  remaining finding documented with a reason it's accepted (not silently
  ignored):
  * Documented audit findings:
    1. `@eslint/plugin-kit`, `ajv`, `@angular-devkit/*`, `@nestjs/cli`, `picomatch`: Dev-dependencies used strictly in development and build-time tooling. Not deployed to production runtime.
    2. `deepmerge-ts`: Transitive dependency of `@prisma/config` (Prisma CLI migration and schema tool). Not imported or executed in runtime production app.
    3. `multer`: Transitive dependency in `@nestjs/platform-express`. Laboura API does not expose file upload endpoints or multipart upload routes; accepted as unused attack surface.
    4. `body-parser`, `fast-uri`: Express core dependencies pinned to NestJS 11 release train.
- Rate limiting on auth and OTP endpoints specifically (brute-force
  protection) — implemented via `AuthThrottlerGuard` tracking identity and client IP; exceeding 5 requests/minute triggers HTTP 429 Too Many Requests.
- Secrets audit: confirmed zero live or test keys committed past or present across git history.
- `.env` and all credentials confirmed never committed (only `.env.example` templates committed).
- Test: verified by `src/common/auth/security-hardening.spec.ts` (12/12 passing).

**Access-control hardening (LOCKED 2026-10-25 — see `AGENTS.md` §7, do not
redesign or ask again, the approach is decided):**
- **Mandatory 2FA on every staff login, all four roles — via TOTP
  (RFC 6238), not SMS OTP.** Staff set up an authenticator app (Google
  Authenticator, Microsoft Authenticator, Authy, or similar) once, by
  scanning a QR code / entering a secret generated at account
  creation/first login. From then on, login requires password + the
  current 6-digit code from that app before a token is issued. This is a
  deliberately separate mechanism from the existing SMS-based
  `OtpProvider` (Phase 2/7) — that one stays as-is for job-seeker/referral/
  business-facing flows (no app to install, no setup friction expected of
  them). Do not reuse `OtpProvider` for staff 2FA and do not route staff
  codes through SMS — TOTP has no SIM-swap exposure and no per-message
  vendor cost, which matters at a ~40-person staff scale. Use a standard,
  audited TOTP library (e.g. `otplib`) rather than a hand-rolled
  implementation; store only the TOTP secret, never OTP codes themselves.
- **Short-lived access tokens with a visible, revocable session list.**
  `GET /staff/sessions` (self, plus ceo/manager can see any staff member's)
  lists active sessions with device/login metadata; `POST /staff/sessions/
  :id/revoke` (self, or ceo/manager for anyone) immediately invalidates that
  session's token. This is the mechanism Task 9's staff deactivation should
  also call when a staff member is deactivated — don't build two separate
  "kick someone out" paths. TOTP (above) and this session control solve
  different problems and are both required, not alternatives: TOTP proves
  who is logging in; short sessions + revocation limit how long a token
  stays valid afterward and let a manager cut access off immediately.
- **Device binding for the Field Agent app specifically.** The Field Agent
  app is distributed via the Play Store — there is no way to control or
  enroll the physical device (confirmed with Agastya; do not attempt an
  MDM/managed-device approach for it). Instead: the first successful login
  from a device registers that device's identifier against the staff
  account. A login attempt from an *unrecognized* device for an account that
  already has a registered device requires a step-up TOTP code (same
  authenticator app, re-entered) before a token is issued — this limits the
  damage of a leaked password without needing any control over the device
  itself. Admin Dashboard and Call Agent console logins (browser-based, no
  stable device identifier) are exempt from device binding — they're
  covered by the Cloudflare Access gateway below instead.
- **Cloudflare Access in front of the Admin Dashboard and Call Agent
  console only** (not the Field Agent app's API routes, which must stay
  reachable from field agents' own phones on any network). This gates by
  *identity* — a request with no valid company login never reaches the
  app's own login page at all — not by device or browser; a device-posture
  check would require Cloudflare's WARP client on every machine, which is
  the managed-device approach already ruled out below. Free tier covers up
  to 50 users, sufficient for this staff size. This is the one new external
  service this phase is explicitly pre-approved to add — per `AGENTS.md`
  §11's "ask first" rule for new external services, Agastya has already
  approved this one, do not ask again. Document the specific routes gated
  in `AGENTS.md` §3.
- **Explicitly out of scope — do not build:** MDM/Android Enterprise
  managed-device enrollment (ruled out for the Field Agent app — Play
  Store distribution means no control over the physical device, confirmed
  with Agastya); IP allowlisting (field agents need access from anywhere).
- Test: a login from a new, unrecognized device on a Field Agent account
  requires a step-up TOTP code before issuing a token; revoking a session
  via either endpoint above immediately invalidates that token on the very
  next request; 2FA via TOTP is enforced for all four roles, by test; a
  correct password with an incorrect/missing TOTP code does not issue a
  token, by test

---

### [x] Task 7 — Backup and disaster recovery

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

### [x] Task 9 — Staff account management (closes a real gap)

**Acceptance:**
- This closes a gap found while reviewing Phase 7: there is currently no way
  through the running API to create a staff account — every `Staff` record
  that exists was created by `npm run seed`. If Laboura hires a new call
  agent or field agent today, nobody can actually add them without hand-
  editing the database.
- `POST /staff` (ceo, manager only) creates a new staff account: name, email,
  role, area (for field agents), teamLeadId (where applicable). Password is
  set via a one-time invite flow, not sent in plaintext in the request/
  response — generate a one-time setup token, return/log it (not the
  password), and build a `POST /staff/accept-invite` (or similar) endpoint
  that lets the new staff member set their own password using that token
  before they can log in. Do not have the CEO/Manager set the new hire's
  password directly.
- `GET /staff` (ceo, manager) lists staff, filterable by role/area/team —
  reuse existing masking conventions, no new PII exposure beyond what the
  RBAC table in `AGENTS.md` §7 already allows CEO/Manager to see
- A way to deactivate a staff account (ceo, manager only) so an exited
  employee can no longer log in — this does not delete the `Staff` record
  (per `AGENTS.md` §6 Data retention) and does not affect any of their past
  audit-logged actions or attributed work
- Audit logged: staff creation, invite acceptance, deactivation
- Test: a newly created staff account cannot log in until the invite is
  accepted; a deactivated staff account's valid credentials are rejected at
  login; a non-CEO/Manager role gets 403 on all of these endpoints
- **Confirmed decisions (LOCKED 2026-10-25, raised during the build):**
  - Only a CEO (not a Manager) may create or deactivate a `ceo` or `manager`
    account — otherwise a Manager could create a CEO account. Correct as
    built; do not relax this.
  - Invite tokens expire after **72 hours**.
  - New passwords set via accept-invite must be **at least 12 characters**.
  - Invite token is stored only as a SHA-256 hash (`inviteTokenHash`), never
    in plaintext — the one-time token itself is returned/logged exactly
    once, at creation, and never again.

---

## Phase 8 Gate

- [ ] Load test report exists and is reviewed; any fixed bottleneck is
  documented in `LESSONS.md`
- [ ] GST invoice total exactly matches `calculatePlacementFee` +
  `calculateGst`, by test
- [ ] A manual DPDP erasure request anonymizes only the targeted record's PII
  fields, leaves everything else (including related records) untouched, and
  is audit logged, by test
- [ ] No automatic retention-expiry job exists anywhere in `/src/jobs/` —
  confirmed by the agent in the report, not just by omission
- [ ] The placement-data export excludes unmasked PII beyond what Finance
  already sees elsewhere, by test
- [ ] A request ID is traceable across every log line for a single request,
  including inside a job it triggers, by test
- [ ] Dependency vulnerability scan is clean or every exception is
  documented and accepted
- [ ] Exceeding the login/OTP rate limit is throttled cleanly, by test
- [ ] 2FA via TOTP (not SMS OTP) is enforced on login for all four staff
  roles, by test
- [ ] A login from an unrecognized device on a Field Agent account requires
  a step-up TOTP code before issuing a token, by test
- [ ] Revoking a session immediately invalidates that session's token on
  the next request, by test
- [ ] Cloudflare Access gates the Admin Dashboard and Call Agent console
  specifically, and the Field Agent app's routes remain reachable without
  it, confirmed and noted in the report
- [ ] No MDM/managed-device enrollment and no IP allowlisting were built
  anywhere in this phase, confirmed in the report
- [ ] A real backup has been restored successfully at least once, with a
  documented sanity check, noted in the report
- [ ] Every item on the Playbook's §8 Go-Live Checklist is either
  done-with-evidence or explicitly flagged as a remaining blocker, in the
  report
- [ ] A new staff account cannot log in before accepting its invite, and a
  deactivated staff account's credentials are rejected at login, by test
- [ ] All Phase 1–7 gate items still pass, confirmed in one pass on current
  `main`
- [ ] `LESSONS.md` updated

**This is the last build-phase gate. When it passes: stop. Report to
Agastya — Laboura is ready for a go/no-go call, not an automatic launch.**
