# Phase 1 — Skeleton & Spine

**Goal:** a running, deployed-able backend where a staff member can log in and
the system provably enforces who can see what, with every sensitive action
recorded. No business features yet.

**Why this is first:** access control and audit logging are the two things that
are painful and expensive to retrofit later. Everything built after this
inherits them for free. The data model is laid down here so later phases add
behaviour, not tables.

**Out of scope for Phase 1 — do not build these:** job seeker onboarding,
payments, KYC, telephony, the hit cycle, refunds, the field app, matching,
the admin dashboard. They are later phases.

> Read `AGENTS.md` first. All rules there apply. Work one task at a time, in order.

---

## Tasks

### [x] Task 1 — Project skeleton

Set up the NestJS + TypeScript project.

**Acceptance:**
- `npm install`, `npm run dev`, `npm test`, `npm run lint` all work
- TypeScript `strict: true`
- `.nvmrc` pins the Node version
- `.env.example` committed listing every required variable; real `.env` gitignored
- A health endpoint `GET /health` returns `{ "status": "ok" }`
- One test exists and passes: it calls `/health` and asserts the response
- Exact installed versions written back into the `AGENTS.md` stack table

---

### [ ] Task 2 — CI pipeline

A GitHub Action that runs on every push and pull request.

**Acceptance:**
- `.github/workflows/test.yml` exists
- On push it: installs dependencies, runs `npm run lint`, runs `npm test`
- It runs against a throwaway PostgreSQL service container, not a real database
- A deliberately broken test makes the run go **red** — verify this once by
  pushing a failing test, confirming red, then fixing it
- A green tick shows on the commit in GitHub

**Note:** this task is what makes every later gate trustworthy. Do not skip or defer it.

---

### [ ] Task 3 — Data model

Write `prisma/schema.prisma` covering all core entities. Tables and relationships
only — no business logic.

**Entities:** `JobSeeker`, `Referral`, `Business`, `Vacancy`, `Placement`,
`Staff`, `Payment`, `AuditLog`

**Acceptance:**
- All money fields are `Int` (paise). No `Float`, no `Decimal` for money
- All timestamps `DateTime` stored UTC
- Every entity has: database `id`, public prefixed `code` (unique), `createdAt`, `updatedAt`, `city`
- `JobSeeker` includes: `tradeSkill`, `minSalary`, `maxSalary`, `preferredCallWindowStart/End`, `status`, `hitCount`, `kycStatus`, `kycReference`, nullable `referredById`
- **No `aadhaarNumber` field exists anywhere in the schema**
- `Placement` links `vacancyId`, `jobSeekerId`, `businessId`; includes `placementFee`, `gstAmount`, nullable `joinedDate`, `status`, `replacementRejectionCount`
- `Payment` has `type` (activation / placement_fee / referral_payout / refund), `amount`, `status`, `gatewayReference` (unique, for idempotency), and a polymorphic link to its subject
- `Staff` has `role` (ceo / manager / team_lead / call_agent / field_agent / finance), `teamLeadId`, `area`
- `AuditLog` has `actorId`, `action`, `entityType`, `entityCode`, `before`, `after`, `createdAt`
- Migration runs clean on an empty database
- A test asserts every relationship can be created and read back

---

### [ ] Task 4 — Money helpers

A single module every other module must use for money. Nothing anywhere else
does money arithmetic.

**Acceptance:**
- `toPaise()`, `toRupees()`, `formatINR()` for display
- `calculateGst(amountPaise)` → 18%, rounded to the nearest paisa
- `calculatePlacementFee(monthlySalaryPaise)` → 50% of first month salary
- `calculateRefund(amountPaise, daysElapsed)` → implements the §6 ladder exactly
- Tests assert the refund ladder at days **0, 15, 16, 30, 31, 45, 46, 61**
- Tests assert GST on an amount that doesn't divide evenly (verify rounding)
- Test asserts no function returns or accepts a non-integer

---

### [ ] Task 5 — Unique ID generation

Generate the human-readable codes (`JS-00001`, `BZ-00042`, …).

**Acceptance:**
- Correct prefix per entity type
- Sequential, zero-padded to 5 digits, rolls over cleanly past 99999
- Collision-safe when two records are created at the same moment — prove it
  with a test that creates 50 concurrently and asserts 50 distinct codes

---

### [ ] Task 6 — Staff authentication

Login for staff only. Job seekers and businesses never log in.

**Acceptance:**
- `POST /auth/login` takes email + password, returns a token
- Passwords hashed with bcrypt or argon2 — never stored or logged in plain text
- Token carries the staff member's `id` and `role`
- Tokens expire; an expired token is rejected
- Tests: valid login succeeds; wrong password fails; expired token rejected;
  password never appears in any response body or log line

---

### [ ] Task 7 — RBAC guard

One reusable guard enforcing the §7 matrix. Not per-endpoint hand-written checks.

**Acceptance:**
- A single guard applied across the API, driven by the role matrix
- Role and scope both enforced: a Field Agent is limited to their own `area`,
  a Team Lead to their own team — not just to their role
- Finance responses mask PII (phone, KYC fields) at the serialization layer,
  so masking cannot be forgotten per-endpoint
- **Tests must assert denial, not just access.** At minimum:
  - a call_agent token on a finance endpoint → `403`
  - a field_agent requesting another area's business → `403`
  - a team_lead requesting another team's agent → `403`
  - a finance token reading a job seeker → `200`, but phone is masked
  - a ceo token on a pricing endpoint → `200`; a manager token → `403`

---

### [ ] Task 8 — Audit logging

Every sensitive write records who did what, when, and what changed.

**Acceptance:**
- Implemented as an interceptor or service wrapper, not copy-pasted per endpoint
- Captures actor, action, entity type + code, before-value, after-value, UTC timestamp
- Audit rows are **append-only**: no API path can update or delete one
- Test: perform a sensitive write, assert exactly one audit row with correct before/after
- Test: assert there is no route that mutates an existing audit row

---

### [ ] Task 9 — End-to-end walking skeleton

One complete path through every layer, proving the stack works together.

**Acceptance:**
- A seeded call agent logs in, calls `GET /job-seekers`, receives an empty list
- The same call to `GET /payments` returns `403`
- Covered by an end-to-end test that runs in CI against the throwaway database

---

### [ ] Task 10 — Seed data

Repeatable seed script for development and tests.

**Acceptance:**
- `npm run seed` creates one staff member of **each** role, plus a couple of
  businesses and job seekers in different cities and areas
- Safe to run repeatedly without duplicating or erroring
- Refuses to run if `NODE_ENV=production`

---

## Phase 1 Gate

Every item must be objectively true. If any one fails, Phase 1 is not done —
fix it rather than proceeding.

- [ ] CI is green on `main`
- [ ] `npm test` passes locally from a clean `npm install`
- [ ] A deliberately failing test has been proven to turn CI **red**
- [ ] A call agent token is **denied** (`403`) on finance endpoints, by automated test
- [ ] A field agent is **denied** another area's data, by automated test
- [ ] Refund ladder returns 100/50/25/0% correctly at the day boundaries, by test
- [ ] Every money value in the schema is an integer; `grep` for `Float` in `schema.prisma` returns nothing
- [ ] `grep -ri "aadhaar" prisma/` shows no field storing the number itself
- [ ] A sensitive write produces exactly one audit row, by test
- [ ] Login → list → `403` path works end to end in CI
- [ ] `AGENTS.md` stack table lists exact installed versions
- [ ] `LESSONS.md` exists (may be empty if nothing was learned)

**When the gate passes: stop. Report to Agastya. Do not start Phase 2.**
Phase 2's spec will be written once this gate is confirmed.