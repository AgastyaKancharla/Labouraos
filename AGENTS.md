# AGENTS.md — Laboura

Project instructions for every coding agent working in this repository
(Antigravity, Claude Code, Cursor). Read this fully before writing any code.

Built by **AgastyaOne** for the client **Laboura**.

---

## 1. What this project is

Laboura is a staffing service in Bengaluru, India, launching city by city. It connects verified job seekers with businesses that need salaried staff, and guarantees the result on both sides: a job seeker pays ₹499 and gets an offer within 30 days or a full refund; a business pays 50% of the first month's salary and gets free replacements if the worker leaves within 60 days.

**Source of truth.** The business rules are owned by Agastya in the *Laboura Master Guide*. Sections 6 and 7 of this file mirror it. `specs/data-design.md` defines every table, column and status for the redesign. If they disagree with each other, stop and ask.

**Matching.** The software includes a rule-based matching engine: fixed filters and a ranking, no AI. It is built in its own phase. Until then, don't add scoring anywhere else.

**Transition.** The current code still follows older rules in several places. `specs/data-design.md` §16 lists the phases that change them. Do not change existing behaviour to match §6 or §7 unless your current task says so. When a task touches an area, build it to §6 and §7.

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
| Frontend Consoles | React 19 + TypeScript + Vite 7 web app in `web/` (decided 11 Nov) | CEO, Manager, Team Lead and Finance portals, call agent console and public job seeker pages, served by NestJS at `/app`. Conventions: `web/README.md`. The old HTML-string consoles (`/admin`, `/call-agent`, `/field-agent`) stay until their screens are rebuilt. |
| Hosting | Render (LOCKED 2026-10-25) | Web service (API + consoles) + a separate Background Worker service for BullMQ + managed Postgres + managed Redis. Chosen over Vercel because Vercel's serverless model doesn't support BullMQ's always-on worker process. Domain DNS managed via Cloudflare (also fronts Admin Dashboard / Call Agent console with Cloudflare Access, per §7). |
| Cloudflare Access Gating | Identity-gated office consoles | Gated routes: Admin Dashboard (`/admin`, `/console/admin`) and Call Agent console (`/call-agent`, `/console/call-agent`). Field Agent app (`/field-agent`, `/console/field-agent`) and API routes are explicitly exempt. **Expiry condition for `/field-agent` exemption:** The exemption exists strictly because field agents reach the browser console from mobile phones outside the Cloudflare Access perimeter; that reason disappears the moment the native Field Agent app ships. When the native app ships, this exemption expires and `/field-agent` must either be retired or gated behind Cloudflare Access; future maintainers must revisit this rather than blindly inheriting it. |
| Load Testing | Node.js Concurrency Harness / Artillery | Simulates ~40 concurrent staff sessions (20 call agents, 20 field agents) performing realistic mixed traffic |

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

## 6. Domain rules — decided by the business (Master Guide, 2 November 2026)

Every number below lives in the `PricingPolicy` table, never as a literal in code.

### Job seekers
- **₹499** to register, flat — no GST added on top.
- **Order:** name and mobile → consent (separate items, before payment) → profile → payment → Aadhaar verification.
- **30-day guarantee** from the moment the payment is confirmed in Laboura's bank account.
- **An offer is a confirmed interview** at a real business, for a vacancy that passes the suitability check done by the software: same trade, salary inside the candidate's range, within their travel distance, matching their shift preference. The candidate has **48 hours** to reply.
- **A hit** is: no pickup (morning and evening calls unanswered plus a WhatsApp or SMS, all on the same day — reported by the phone system, never typed by an agent), declining a suitable offer, not replying to it, or not turning up to the interview. The last three also **end the refund**. A business saying "not selected" is never a hit.
- **3 hits** → deactivated, no refund. Paying ₹499 again resets the hits and the 30-day clock.
- A Team Lead can reverse a wrong hit, with a reason; the CEO and Manager are notified.
- **Refunds are released by a person** (CEO or Finance), never automatically, after a check that the candidate isn't working at a business Laboura introduced.
- Mobile verified by OTP. Calls only between **09:00 and 21:00** and inside the candidate's preferred window.
- **Never collect** religion, caste, marital status or health conditions.
- **Joining reward:** ₹200 to the candidate after 30 days in a job joined through Laboura, released by CEO or Finance, to a UPI ID collected at joining and name-checked.

### Businesses
- **Fee:** 50% of the agreed first-month salary plus 18% GST, paid **the moment the candidate is selected**, within 24 hours. The joining date is confirmed only after payment. No deposit.
- **Interviews:** walk-in, 10:30 AM–6:00 PM by default. The owner records the result in the app by OTP **by 8 PM the same day**; the candidate is asked at the same time whether they were offered the job.
- **Account agent:** every business has one — the field agent who onboarded or verified it. Only the account agent, their Team Lead and management edit it. Call agents may add vacancies to any business by phone; the account agent is notified.
- **A business that calls in** is a lead until a field agent's verification visit. No candidate is shown to an unverified business.
- **No-documents businesses** (no licence, no GST): live photo, location check, and Team Lead approval before any candidate is shown.
- **Agreement signed by OTP**, including the no-bypass clause: hiring anyone Laboura introduced within **12 months** costs the full fee **plus 50%**.
- **60-day guarantee** from the first employee's joining date. **Up to 2 free replacements**, on the same clock. If the second replacement also leaves, the guarantee ends with no refund. If the business rejects **2 replacement candidates**, the guarantee ends with no refund.
- No replacement within **15 days** of an accepted claim → **flat 100% refund**, released by CEO or Finance.
- **Claims:** reported within **7 days** of the worker leaving, fee paid in full, reason from the fixed list, a recorded exit call to the worker, decision by a Team Lead or Manager within 48 hours.

### Referral partners
- **₹200** when the referred candidate **joins** — not when they pay. Released by CEO or Finance.
- Payout UPI or bank details are checked by name; changing them needs an OTP and a 48-hour wait.

### Money
- All amounts in integer paise.
- **Collected by UPI straight into the company current account**, with a separate QR code or link per payment carrying the exact amount and a reference. A payment gateway is used only when the payer chooses a card.
- **A screenshot is never proof of payment.** A payment counts only when the bank confirms it.
- Everything going out — refunds, payouts, rewards — is released by the CEO or Finance.

### Identity
- Aadhaar through DigiLocker via a licensed vendor (QR scan or PAN/driving licence/voter ID as fallbacks). Store only: verified yes/no, method, vendor reference, last 4 digits, name match, 18+. **Never** the full number, the XML or PDF, the photo or the address.

### Keeping data (replaces the 25 October "never delete" rule)
| Data | Kept | Then |
| --- | --- | --- |
| Payments, invoices, refunds, payouts | 8 years | deleted |
| Job seeker, business, referral profiles | 23 months after last activity | anonymised |
| Identity verification | result only | — |
| Call recordings | 1 year, or until a dispute closes | deleted |
| Login and access logs | 1 year | deleted |

Personal data never goes into the audit log or status history.

### Staff
- Everyone is salaried. No commission for anyone.
- Monthly targets as built in Phase 6.7.

---

## 7. Access control and login (Master Guide, 2 November 2026)

Enforced server-side on every request, through the guard — never by hiding a button.

| Role | Job seekers / referrals | Businesses | Vacancies / placements | Payments | Pricing | Targets |
| --- | --- | --- | --- | --- | --- | --- |
| CEO | all | all | all | all; releases money | **only writer** | all |
| Manager | all | all | all | read; **does not release money** | read | all |
| Team Lead | own team | own team's businesses | own team | none | none | own team |
| Call Agent | create and edit | read all; create leads; add vacancies to any business | read all | none | none | own |
| Field Agent | city-wide | read all; edit only where account agent | read all; act on own businesses | none | none | own |
| Finance | read, personal data masked | read, masked | read | all; releases money | none | none |

- **Agents never see full phone numbers.** Calls go through the calling system.
- **Nobody below Manager** can download or export lists.
- Every sensitive write is audited with actor, time, reason and the fields that changed.

### Login
- Staff log in with their **staff code** and password.
- Every login by a non-management staff member needs a **6-digit code** from the login code screen, revealed by their Team Lead, a Manager or the CEO, and recorded. Codes are never stored.
- CEO, Managers and Finance use an authenticator app (TOTP) instead.
- **Approved devices only**, for every role, approved by a Team Lead or Manager.
- **One login at a time.** Logout after 1 hour idle, 2 hours at most, or when the app or browser closes.
- **5 wrong passwords** lock the account for 15 minutes or until unlocked by a Team Lead, Manager or CEO.
- Office staff can log in only from the office network. No fixed login hours; logins at odd hours are flagged.
- The CEO or a Manager can lock any account instantly.
- The admin and call-agent consoles stay behind Cloudflare Access. The `/field-agent` web console exemption expires when the native field agent app ships.

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