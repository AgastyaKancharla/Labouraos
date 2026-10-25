# AGENTS.md — Laboura

Project instructions for every coding agent working in this repository
(Antigravity, Claude Code, Cursor). Read this fully before writing any code.

Built by **AgastyaOne** for the client **Laboura**.

---

## 1. What this project is

Laboura is a blue-collar staffing marketplace operating in Bengaluru, India.
It connects job seekers (workers) with businesses that need to hire them.

**Critical framing: this software is a system of record and a rule enforcer —
not a matching engine.** Human call agents and field agents do the actual
matching. The software's job is to record what they do and enforce the money
rules correctly. Do not build ranking algorithms, ML matching, or
recommendation engines. A filtered list an agent reads is correct and
sufficient.

**Exception — not a contradiction:** the Priority Dashboard (API in Phase 4,
field agent screen in Phase 6) sorts candidates and vacancies by dates the
system already knows — a refund-guarantee deadline, a replacement-window
deadline — with a fixed, stated tiebreak rule. Sorting by a known date is not
the same as estimating how good a match is, so it does not violate the rule
above. Do not extend it into scoring, weighting, or anything that estimates
fit between a candidate and a vacancy — that would cross back into "matching
engine" territory and is still off-limits.

Four kinds of people use it:
- **Call agents** — onboard job seekers, referrals and businesses by phone
- **Field agents** — visit businesses in person, capture vacancies, arrange interviews
- **Management** (CEO, Manager, Team Leads) — oversight and targets
- **Finance** — invoices, refunds, GST ledger

Job seekers and businesses do **not** log in. There is no public-facing app.

---

## 2. Non-negotiables

These are the quality floor. Breaking any of these is a defect regardless of
whether tests pass.

1. **Money is stored as integer paise. Never floats.** `₹499` is `49900`.
   Floating-point money causes silent rounding corruption. There is no
   exception to this rule.
2. **All access control is enforced server-side**, in the API layer, on every
   request. Never rely on the UI hiding a button.
3. **Never store a raw Aadhaar number.** Store only the verification result
   and the vendor's reference ID. This is a legal requirement, not a preference.
4. **Every sensitive write is audit-logged** (see §7) with actor, timestamp,
   before-value and after-value.
5. **All timestamps are stored in UTC.** Convert to IST (UTC+05:30) only for display.
6. **Never invent a business rule.** If a rule isn't written in §6 or in the
   current phase spec, stop and ask. Guessing a refund percentage is worse
   than not writing the code.
7. **Every external call is idempotent.** Payment and telephony webhooks will
   be delivered more than once. A repeat must be a no-op, never a double charge.
8. **No secrets in code or in git.** Use environment variables. If you find a
   secret committed, stop and report it.

---

## 3. Tech stack

| Layer | Choice | Notes |
| --- | --- | --- |
| Runtime | Node.js 24.21.0 | Pinned in `.nvmrc` |
| Language | TypeScript 5.7.3, `strict: true` | `strict` is mandatory, never disable it |
| Framework | NestJS 11.2.7 | Pinned in `package.json` |
| Database | PostgreSQL 17+ | Managed (Supabase / Neon / cloud provider) |
| ORM | Prisma 6.19.3 | `schema.prisma` is the single source of truth for the data model |
| Tests | Jest 29.7.0 (NestJS default) | Pinned in `package.json` |
| CI | GitHub Actions | `.github/workflows/test.yml` |
| Jobs | BullMQ on Redis | For schedulers and webhook retries |
| Frontend Consoles | HTML5 / Vanilla TS / CSS SPAs | Admin Dashboard, Call Agent console, Field Agent app served via NestJS |

**Exact versions pinned above.**
Do not leave version ranges like `^11.0.0` in this file.

**Provider switching (mock vs real, from Phase 7 onward):** every external
integration (OTP/SMS, WhatsApp, telephony, payment collection, payout
disbursement, Aadhaar e-KYC) is bound through NestJS DI to an interface — `OtpProvider`,
`PaymentProvider`, `WhatsAppProvider`, `TelephonyProvider`, and `KycProvider` —
with a mock implementation and a real one. Which one gets injected is
controlled by a per-provider environment variable (`OTP_PROVIDER_MODE`,
`PAYMENT_PROVIDER_MODE`, `WHATSAPP_PROVIDER_MODE`, `TELEPHONY_PROVIDER_MODE`,
`KYC_PROVIDER_MODE`), each defaulting to `mock` when unset. Never add a second way to pick a
provider implementation — extend this one.

---

## 4. Project structure

```
/prisma/schema.prisma      ← the data model, single source of truth
/src/
  /modules/                ← one folder per entity, self-contained
    /job-seeker/
    /referral/
    /business/
    /vacancy/
    /placement/
    /payment/
    /staff/                ← call agents, field agents, leads, finance
  /common/
    /auth/                 ← login, tokens
    /rbac/                 ← permission guards
    /audit/                ← audit logging
    /money/                ← paise helpers, GST calculation
  /jobs/                   ← scheduled jobs and queue workers
/test/                     ← end-to-end tests
/specs/                    ← phase specs and architecture; read before working
/.github/workflows/        ← CI
LESSONS.md                 ← known bugs and their fixes
```

A module owns its own controller, service, DTOs and tests. Modules talk to
each other through services, never by reaching into another module's internals.

---

## 5. Commands

```bash
npm install          # install dependencies
npm run dev          # start the API locally
npm test             # run all tests  ← must pass before any task is done
npm run test:watch   # tests in watch mode while developing
npm run lint         # lint and format check
npx prisma migrate dev --name <name>   # create a migration after schema change
npx prisma studio    # browse the database visually
```

**`npm test` must pass before you mark any task complete.** Not "should" — must.

---

## 6. Domain rules — these are LOCKED, do not change or invent

### Job seeker side
- Activation fee: **₹499** (`49900` paise), one-time, paid before entering the candidate pool.
- **30-day guarantee**: if no suitable offer within 30 days of the ₹499 being *received*, full refund. The clock starts at payment receipt, not at signup.
- **"Suitable offer"** means BOTH: (a) same trade/skill as the candidate's, AND (b) salary within the candidate's own stated minimum–maximum range captured at onboarding. An offer failing either test does not count against the guarantee.
- **3-hit deactivation cycle.** One hit is any of:
  - no pickup, after next-day morning AND evening call attempts plus a WhatsApp/SMS
  - an explicit rejection of a suitable offer
  - a no-show at an arranged interview
- At **3 hits the profile is deactivated** and carries **no refund entitlement**.
- **Reactivation** requires paying ₹499 again. On reactivation: hit counter resets to 0 and a **fresh 30-day refund clock** starts from the new payment.
- Mobile number must be **OTP-verified** at registration (job seekers and referrals both).
- Capture **preferred call window**, which must fall inside **09:00–21:00 IST** (legal requirement, TRAI).

### Business side
- Placement fee: **50% of the placed candidate's first month salary**, plus **18% GST** on top. Never deducted from the employee's salary.
- **60-day replacement guarantee.** Free replacement is the default remedy. Cash refund only if no replacement is found within **15 days of the dropout being reported**.
- **Refund amount (simplified, LOCKED 2026-10-20 — supersedes any earlier tapered ladder):** flat. Before day 15, no cash refund is payable at all (Laboura is still searching for a free replacement). From day 15 onward with no replacement found, the refund is a **flat 100%** of the placement fee — no 50%/25%/tapering. This is a deliberate simplification pending real-world data; it may be revisited later, but until it is, `calculateRefund(amountPaise, daysElapsed)` must implement exactly this: `daysElapsed < 15` → not yet eligible (the caller rejects the request rather than returning a partial amount), `daysElapsed >= 15` → full `amountPaise`.

- **Eligibility**: applies only when the **employee leaves**. A business-side breach (didn't pay, changed the role, mistreated the worker) does **not** qualify.
- A business may reject up to **2 replacement candidates**; from the 3rd rejection the guarantee clock **pauses** as unreasonable.

### Referral side
- Any individual or business can be a referral partner. OTP-verified number required.
- **Referral payout fires when the referred candidate JOINS THE JOB** — i.e. on the Placement's `joined_date`. It does **not** fire on receipt of the ₹499. This is deliberate anti-fraud; do not "fix" it.
- **Payout amount (LOCKED 2026-10-24):** flat **₹200** (`20000` paise) per placement, same figure regardless of trade, salary, or placement fee size.

### Identity
- Aadhaar verification is **offline e-KYC via a licensed vendor only**. Store the result and the vendor reference. **Never the Aadhaar number itself.** PAN is the fallback.

### Data retention (LOCKED 2026-10-25)
- **No record is ever automatically deleted or anonymized.** Business records
  (job seekers, referrals, businesses, vacancies, placements, payments, hit
  history, call recordings) are kept indefinitely by default — there is no
  retention-expiry scheduled job anywhere in this system, and none should be
  added. Agastya's explicit call: "nothing should be deleted, everything
  should be retrievable" — this is a deliberate choice, not an oversight.
- The one exception is an **explicit DPDP erasure request from a specific
  person** (or a specific call recording's retention being invoked, same
  mechanism). That is handled by a manual, CEO/Manager-only endpoint that
  anonymizes only the directly-identifying PII fields (name, phone, Aadhaar
  reference, exact address) on the targeted record — the record itself, and
  every number/history/relationship tied to it, is kept exactly as before,
  just with the personal-identity link severed. Audit logged. Never a bulk
  or scheduled operation — always one specific record, on one specific
  request.
- Call recordings follow the same rule: kept indefinitely, no automatic
  expiry, anonymized/erasure-handled only on an explicit request through the
  same mechanism.
- Do not build an automatic retention job "to be safe" or because a draft of
  this spec once asked for one — this section supersedes any earlier mention
  of a retention period or scheduled erasure job in `/specs/`.

---

## 7. Access control (RBAC)

Enforced server-side on every request. Build this as a guard, not as per-endpoint hand-written checks.

| Role | Job Seeker / Referral / Business | Vacancy / Placement | Payment ledger | Pricing & policy | Targets |
| --- | --- | --- | --- | --- | --- |
| CEO | full read/write | full read/write | full read, approve refunds | **sole write access** | all |
| Manager | full read/write | full read/write | full read, approve refunds | read-only | all |
| Team Lead | own team's only | own team's only | none | none | own team |
| Call Agent | full create/edit | own captured vacancies | none | none | own only |
| Field Agent | own area only | own area only | none | none | own only |
| Finance | read-only, **PII masked** | read-only | full read/write | none | none |

**PII masking for Finance** means: Finance sees the unique ID (`JS-04821`) and
amounts, never the phone number or KYC details.

**Audit-logged writes**: refund approval, deactivation, reactivation, payout
release, pricing change, placement creation, any role change.

### Login and session hardening (LOCKED 2026-10-25 — Phase 8 Task 6, do not
redesign or ask again)

This is about *getting into the system in the first place*, separate from
the role permissions above.

- **Mandatory 2FA on every staff login, all four roles, via TOTP
  (RFC 6238)** — an authenticator app (Google Authenticator, Microsoft
  Authenticator, Authy, etc.), set up once per staff account. Deliberately
  not the SMS-based `OtpProvider` (Phase 2/7) — that stays reserved for
  job-seeker/referral/business-facing flows where no app install can be
  assumed. No SIM-swap exposure, no per-message cost, at this staff scale.
- **Short-lived access tokens + a visible, revocable session list**
  (`GET /staff/sessions`, `POST /staff/sessions/:id/revoke`) — solves a
  different problem than 2FA (how long a token stays valid afterward, and
  letting a manager cut access immediately), not a substitute for it. Both
  are required.
- **Field Agent app (Play Store distribution, no device control
  possible):** first login registers the device; an unrecognized device on
  an account that already has one requires a step-up TOTP code before a
  token is issued.
- **Admin Dashboard and Call Agent console (browser-based office consoles
  only):** gated by Cloudflare Access in front of them — identity-gated
  (no valid company login, no reach to the login page at all), not
  device-gated. Pre-approved new external service for this phase — do not
  ask again.
- **Explicitly not built anywhere:** MDM/Android Enterprise managed-device
  enrollment, IP allowlisting.

Full detail and acceptance tests: `specs/phase-8.md` Task 6.

---

## 8. Unique IDs

Every core record carries a human-readable prefixed ID that agents read aloud
on phone calls. Generate sequentially, zero-padded to 5 digits.

`JS-00001` job seeker · `RF-` referral · `BZ-` business · `VC-` vacancy ·
`PL-` placement · `FA-` field agent · `CA-` call agent

These are in addition to the database primary key, not a replacement for it.

---

## 9. Testing

Tests are the contract. The rule: **code is not done until it compiles clean
and `npm test` passes.**

**Must have tests, no exceptions:**
- Every money calculation (fees, GST, refund ladder, payouts)
- Every state machine transition (hit cycle, placement lifecycle)
- Every RBAC rule — specifically, tests that assert a role is **denied**
- Every webhook handler, including being called twice with the same payload

**Time-based logic must use injectable time**, never `new Date()` inline, so
tests can fast-forward the clock. Refund-ladder tests must assert the correct
amount at day 15, 16, 30, 31, 45, 46 and 61.

Write the test in the same task as the code. Do not batch tests for later.

---

## 10. Git workflow

- One branch per task: `phase-1/task-3-rbac-guard`
- Commit when a task's tests pass, not before
- Commit message: what changed and why, one line, present tense
- Never force-push. Never commit directly to `main`
- Never commit `.env`, keys, or credentials

---

## 11. Boundaries

**Do freely:**
- Write code, tests and migrations for the current phase's tasks
- Refactor within a module you're already working in
- Add dependencies that are clearly needed and widely used

**Ask first:**
- Changing `prisma/schema.prisma` in a way that drops or renames a column
- Adding a new external service or paid API
- Changing anything in §2 or §6
- Starting work on a task from a different phase
- Any change touching how money is calculated

**Never:**
- Change a business rule in §6 to make a test pass
- Disable, skip or comment out a failing test
- Set TypeScript `strict: false`, or add `any` to silence a type error
- Store raw Aadhaar numbers or commit secrets
- Delete migration files that have already been applied

---

## 12. How to work a phase

1. Read `/specs/phase-N.md` — the current phase only. Ignore later phases.
2. Read `LESSONS.md` before fixing any bug; the answer may already be there.
3. Take **one task at a time**, in order. Do not start task 4 while task 3 is open.
4. For each task: write the code, write its tests, run `npm test`.
5. If tests fail, fix them. If you cannot after a genuine attempt, stop and report — do not disable the test.
6. When green, commit, then tick the task's checkbox in the phase spec.
7. Append any non-obvious bug and its fix to `LESSONS.md`.
8. When every task is ticked, run the **phase gate** at the bottom of the spec.
9. **Do not begin the next phase.** Report that the gate passed and stop.

---

## 13. LESSONS.md protocol

Before fixing an error, search `LESSONS.md` for it. After fixing a non-obvious
one, append:

```
## <short description of the error>
**Symptom:** what you saw
**Cause:** what was actually wrong
**Fix:** what resolved it
```

This stops the same bug being solved three different ways in three sessions.

---

## 14. When in doubt

Stop and ask. On this project, an agent that stops and asks about a refund
rule is doing its job correctly. An agent that guesses one is creating a
financial liability for the client.