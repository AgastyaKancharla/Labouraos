# Phase 9 — Rulebook and Foundations

**Goal:** the coding rulebook matches the Laboura Master Guide, the six problems found in the 2 November code check are fixed, every rule number lives in one settings table, and the two shared tables later phases need (status history and review flags) exist.

**Why this is next:** a review on 2 November 2026 compared the code with the Master Guide (the business's agreed rulebook). The foundation is sound, but `AGENTS.md` still carries old locked rules that the business has since changed, so any new work would be built against the wrong rules. Six problems were also found that are wrong under any version of the rules. This phase is step 1 of the build order in `specs/data-design.md` §16.

**This phase changes no business behaviour except the six fixes.** The rule changes themselves (login, calling, interviews, placements, replacements…) each come in their own later phase.

**Out of scope — do not build:** the login code screen or any login change other than Task 4 and Task 5; staff code login; calling changes; consent; new job seeker, business or vacancy fields; interviews; the new placement flow; replacement claims; UPI collection; payout accounts; the map; the field agent app; the UI restyle; the automatic data clean-up job.

> **Before starting:**
> 1. Fetch and check out the latest `main`.
> 2. Add two files given to you with this prompt: `specs/data-design.md` and this file as `specs/phase-9.md`. Commit them on the Task 1 branch.
> 3. Read `LESSONS.md`, then this whole spec, then `specs/data-design.md` §0, §1, §2 and §12.

> **Working rules for this phase (from LESSONS.md):** one branch per task. Push the branch, wait for GitHub Actions to pass **on the branch**, and only then merge to `main`. If a check fails, fix it on the branch — never push fixes straight to `main`. Phase 6.7 broke this rule twice; don't repeat it.

---

## Tasks

### [x] Task 1 — Rewrite the rulebook

**Acceptance:**
- In `AGENTS.md`, replace the "Critical framing" and "Exception" paragraphs of §1, the whole of §6, and the whole of §7 with the text in **Appendix A** of this spec, word for word. Leave every other section unchanged.
- Add `specs/data-design.md` and `specs/phase-9.md` to the repository.
- Add a `LESSONS.md` entry: "2026-11-02 — AGENTS.md §1/§6/§7 replaced from the Master Guide. Old rules that the code still follows are listed in specs/data-design.md §16; do not change existing behaviour to match the new rules unless your current task says so."
- Documentation only: no source file changes. CI must still pass.

---

### [x] Task 2 — One settings table for every rule number (fixes Problems 2 and 3)

**Today:** `PricingService` keeps its settings in memory, so a CEO's change is lost on restart, and nothing reads them anyway — the amounts are typed directly into the services (`49900` in `job-seeker.service.ts`, `money-at-risk.service.ts` and `job-seeker-refund-eligibility.ts`; `50` inside `calculatePlacementFee`; `>= 3` for hits; `>= 3` for replacement rejections; the 30/60/15-day constants in `money.ts`).

**Acceptance:**
- New `PricingPolicy` table exactly as `specs/data-design.md` §2, one row per version. A migration seeds the first row with the values in that table.
- `PricingService.current()` returns the newest row whose `effectiveFrom` is not in the future. It reads the database (no in-memory copy that can go stale between the web and worker processes).
- `PUT /pricing` (CEO only, audited) inserts a new version; it never edits an old row. `GET /pricing` for CEO and Manager. The admin dashboard's pricing form reads and writes through these.
- Every service that charges or checks a rule reads it from `PricingService.current()` instead of a literal: activation fee, placement fee percent, GST percent, referral payout, 30-day guarantee, 60-day and 15-day replacement windows, maximum hits, maximum replacement rejections.
- `calculatePlacementFee` and `calculateGst` take the percentage as an argument.
- **Behaviour stays the same** with the seeded values. In particular the replacement rule keeps today's meaning: a business may reject up to `maxReplacementRejections` (2) candidates and the clock pauses on the next one. The new meaning ("2 rejections end the guarantee") arrives in a later phase — do not change it here.
- **Old records never change:** a refund pays back the amount the person actually paid (the stored activation payment amount), not the current price. Placements keep the fee and GST they were created with.
- Tests:
  - With the seeded row, every existing test passes unchanged.
  - Changing the activation fee changes the next activation charge and not an earlier one.
  - A refund after a price change returns the original amount paid.
  - A new `PricingService` instance (simulating a restart) sees the changed values.
  - A Manager is refused `PUT /pricing`.
  - No literal `49900`, `20000` (referral), `50` (fee percent) or `18` (GST) remains in `src/` outside the seed migration and tests — add a test or lint check that fails if one is reintroduced.

---

### [x] Task 3 — Keep personal data out of the history log (fixes Problem 1)

**Today:** `JobSeekerService.erase` writes the person's name, phone and KYC reference into the audit log's `before` value, so the erased data survives in the log.

**Acceptance:**
- `AuditLog` gets two new nullable columns: `reason` (string) and `changedFields` (string array) — `specs/data-design.md` §12.
- `AuditService.log` redacts personal fields itself, for every caller: any key named `name`, `ownerName`, `contactName`, `phone`, `whatsappPhone`, `contactPhone`, `candidatePhone`, `email`, `address`, `kycReference`, `kycDetails`, `dateOfBirth` or `aadhaar*` (at any depth) is written as `"[changed]"`, and the key is added to `changedFields`. Codes, ids, statuses and amounts are kept.
- The redaction is in `AuditService`, not repeated in each caller, so a future caller can't forget it.
- `erase` passes the reason "DPDP erasure request" and no personal values.
- Tests: after erasing a job seeker, no audit row anywhere contains their name or phone; an ordinary status change still logs its before/after status; a nested personal field is redacted.

---

### [x] Task 4 — A field agent can't skip the device check (fixes Problem 4)

**Today:** in `AuthService.login`, if a field agent sends no `deviceId`, the device check is skipped entirely.

**Acceptance:**
- A `field_agent` login without a `deviceId` is refused with a clear message.
- Nothing else about devices changes in this phase (approved devices for every role come in the login phase).
- Tests: field agent login with no deviceId is refused; with the registered deviceId it succeeds; other roles are unaffected.

---

### [ ] Task 5 — The server refuses to start without a proper login secret (fixes Problem 6)

**Today:** `auth.module.ts` and `jwt.strategy.ts` fall back to a default secret written in the code if `JWT_SECRET` is missing.

**Acceptance:**
- Remove both fallbacks. Read the secret through one shared function that throws at startup if `JWT_SECRET` is missing or shorter than 32 characters — fail closed.
- The test setup sets its own `JWT_SECRET`, so CI keeps working.
- Tests: startup fails with the variable missing; fails with a 10-character value; succeeds with a 32-character value.
- `render.yaml` already generates the secret for both services — confirm, don't change.

---

### [ ] Task 6 — No payouts to a placeholder account (fixes Problem 5)

**Today:** `RealPaymentProvider.disbursePayout` falls back to a made-up fund account (`fa_test_<type>_<id>`) when none is given, so real payouts would fail at the payout company.

**Acceptance:**
- Remove the fallback. If no fund account is supplied, the real provider refuses before calling the payout company, and the payout is marked `failed` with the reason `no_verified_payout_account`, audited.
- The mock provider behaves as today, so local testing still works.
- Real payout accounts (bank and UPI details, with checks) come in a later phase — `specs/data-design.md` §10. Don't build them here.
- Tests: the real provider refuses without a fund account and sends nothing; with one it sends the payout as today.

---

### [ ] Task 7 — Status history

**Acceptance:**
- New `StatusHistory` table exactly as `specs/data-design.md` §1.
- One shared helper, called inside the same database transaction as the status change, so a status can't change without a history row.
- Wired into every place that changes the status of a job seeker, vacancy, placement, payment or staff member today. Include the system as the actor (null staff id) for changes made by the daily sweep and webhooks.
- `reason` never contains personal data.
- `GET /status-history?subjectType=&subjectId=` for CEO and Manager only.
- Tests: creating, activating, deactivating and reactivating a job seeker writes the expected rows in order; a failed transaction writes no history row; the daily sweep's deactivation is recorded with a null staff id.

---

### [ ] Task 8 — Review flags

**Acceptance:**
- New `ReviewFlag` table exactly as `specs/data-design.md` §1, with its closed list of kinds (including `payment_mismatch`).
- A `ReviewFlagService` with `raise`, `list` and `resolve`. Resolving or dismissing requires a written resolution.
- Endpoints: `GET /review-flags` (CEO and Manager: all; Team Lead: only flags whose `raisedForStaffId` is one of their own agents; everyone else refused) and `POST /review-flags/:id/resolve` (Team Lead for their team's flags, Manager, CEO). Audited.
- One producer now, to prove it works: when a business is created with a GPS mismatch (today's `geofenceFlag`), raise a `gps_mismatch` flag for the agent who created it. Other producers come with their own phases.
- Tests: the flag is raised on a mismatch and not otherwise; a Team Lead sees their own team's flag and not another team's; Finance and agents are refused; resolving without a resolution is refused.

---

## Phase 9 Gate

- [ ] `AGENTS.md` §1, §6 and §7 match Appendix A exactly; `specs/data-design.md` is in the repo
- [ ] Every rule number is read from `PricingPolicy`; a CEO change survives a restart; a Manager can't change it — by test
- [ ] A refund after a price change returns the amount actually paid — by test
- [ ] No hard-coded rule amounts remain in `src/` — by test or lint check
- [ ] After an erasure, no audit row contains the person's name or phone — by test
- [ ] A field agent login without a device id is refused — by test
- [ ] The server won't start without a proper `JWT_SECRET` — by test
- [ ] The real payout provider refuses to pay without a fund account — by test
- [ ] Status changes for job seekers, vacancies, placements, payments and staff write history rows in the same transaction — by test
- [ ] Review flags: raised on GPS mismatch, scoped per Team Lead, resolution required — by test
- [ ] All earlier phase gate items still pass
- [ ] CI green on `main`, confirmed on GitHub Actions — and every task branch was green **before** it was merged
- [ ] `LESSONS.md` updated

**When the gate passes: stop and report to Agastya** — commits, CI run links, test counts, and one line per task on what changed. Do not start the next phase.

---

## Appendix A — new text for AGENTS.md

### A1. Replaces the "Critical framing" and "Exception" paragraphs in §1

> Laboura is a staffing service in Bengaluru, India, launching city by city. It connects verified job seekers with businesses that need salaried staff, and guarantees the result on both sides: a job seeker pays ₹499 and gets an offer within 30 days or a full refund; a business pays 50% of the first month's salary and gets free replacements if the worker leaves within 60 days.
>
> **Source of truth.** The business rules are owned by Agastya in the *Laboura Master Guide*. Sections 6 and 7 of this file mirror it. `specs/data-design.md` defines every table, column and status for the redesign. If they disagree with each other, stop and ask.
>
> **Matching.** The software includes a rule-based matching engine: fixed filters and a ranking, no AI. It is built in its own phase. Until then, don't add scoring anywhere else.
>
> **Transition.** The current code still follows older rules in several places. `specs/data-design.md` §16 lists the phases that change them. Do not change existing behaviour to match §6 or §7 unless your current task says so. When a task touches an area, build it to §6 and §7.

### A2. Replaces all of §6

> ## 6. Domain rules — decided by the business (Master Guide, 2 November 2026)
>
> Every number below lives in the `PricingPolicy` table, never as a literal in code.
>
> ### Job seekers
> - **₹499** to register, flat — no GST added on top.
> - **Order:** name and mobile → consent (separate items, before payment) → profile → payment → Aadhaar verification.
> - **30-day guarantee** from the moment the payment is confirmed in Laboura's bank account.
> - **An offer is a confirmed interview** at a real business, for a vacancy that passes the suitability check done by the software: same trade, salary inside the candidate's range, within their travel distance, matching their shift preference. The candidate has **48 hours** to reply.
> - **A hit** is: no pickup (morning and evening calls unanswered plus a WhatsApp or SMS, all on the same day — reported by the phone system, never typed by an agent), declining a suitable offer, not replying to it, or not turning up to the interview. The last three also **end the refund**. A business saying "not selected" is never a hit.
> - **3 hits** → deactivated, no refund. Paying ₹499 again resets the hits and the 30-day clock.
> - A Team Lead can reverse a wrong hit, with a reason; the CEO and Manager are notified.
> - **Refunds are released by a person** (CEO or Finance), never automatically, after a check that the candidate isn't working at a business Laboura introduced.
> - Mobile verified by OTP. Calls only between **09:00 and 21:00** and inside the candidate's preferred window.
> - **Never collect** religion, caste, marital status or health conditions.
> - **Joining reward:** ₹200 to the candidate after 30 days in a job joined through Laboura, released by CEO or Finance, to a UPI ID collected at joining and name-checked.
>
> ### Businesses
> - **Fee:** 50% of the agreed first-month salary plus 18% GST, paid **the moment the candidate is selected**, within 24 hours. The joining date is confirmed only after payment. No deposit.
> - **Interviews:** walk-in, 10:30 AM–6:00 PM by default. The owner records the result in the app by OTP **by 8 PM the same day**; the candidate is asked at the same time whether they were offered the job.
> - **Account agent:** every business has one — the field agent who onboarded or verified it. Only the account agent, their Team Lead and management edit it. Call agents may add vacancies to any business by phone; the account agent is notified.
> - **A business that calls in** is a lead until a field agent's verification visit. No candidate is shown to an unverified business.
> - **No-documents businesses** (no licence, no GST): live photo, location check, and Team Lead approval before any candidate is shown.
> - **Agreement signed by OTP**, including the no-bypass clause: hiring anyone Laboura introduced within **12 months** costs the full fee **plus 50%**.
> - **60-day guarantee** from the first employee's joining date. **Up to 2 free replacements**, on the same clock. If the second replacement also leaves, the guarantee ends with no refund. If the business rejects **2 replacement candidates**, the guarantee ends with no refund.
> - No replacement within **15 days** of an accepted claim → **flat 100% refund**, released by CEO or Finance.
> - **Claims:** reported within **7 days** of the worker leaving, fee paid in full, reason from the fixed list, a recorded exit call to the worker, decision by a Team Lead or Manager within 48 hours.
>
> ### Referral partners
> - **₹200** when the referred candidate **joins** — not when they pay. Released by CEO or Finance.
> - Payout UPI or bank details are checked by name; changing them needs an OTP and a 48-hour wait.
>
> ### Money
> - All amounts in integer paise.
> - **Collected by UPI straight into the company current account**, with a separate QR code or link per payment carrying the exact amount and a reference. A payment gateway is used only when the payer chooses a card.
> - **A screenshot is never proof of payment.** A payment counts only when the bank confirms it.
> - Everything going out — refunds, payouts, rewards — is released by the CEO or Finance.
>
> ### Identity
> - Aadhaar through DigiLocker via a licensed vendor (QR scan or PAN/driving licence/voter ID as fallbacks). Store only: verified yes/no, method, vendor reference, last 4 digits, name match, 18+. **Never** the full number, the XML or PDF, the photo or the address.
>
> ### Keeping data (replaces the 25 October "never delete" rule)
> | Data | Kept | Then |
> | --- | --- | --- |
> | Payments, invoices, refunds, payouts | 8 years | deleted |
> | Job seeker, business, referral profiles | 23 months after last activity | anonymised |
> | Identity verification | result only | — |
> | Call recordings | 1 year, or until a dispute closes | deleted |
> | Login and access logs | 1 year | deleted |
>
> Personal data never goes into the audit log or status history.
>
> ### Staff
> - Everyone is salaried. No commission for anyone.
> - Monthly targets as built in Phase 6.7.

### A3. Replaces all of §7

> ## 7. Access control and login (Master Guide, 2 November 2026)
>
> Enforced server-side on every request, through the guard — never by hiding a button.
>
> | Role | Job seekers / referrals | Businesses | Vacancies / placements | Payments | Pricing | Targets |
> | --- | --- | --- | --- | --- | --- | --- |
> | CEO | all | all | all | all; releases money | **only writer** | all |
> | Manager | all | all | all | read; **does not release money** | read | all |
> | Team Lead | own team | own team's businesses | own team | none | none | own team |
> | Call Agent | create and edit | read all; create leads; add vacancies to any business | read all | none | none | own |
> | Field Agent | city-wide | read all; edit only where account agent | read all; act on own businesses | none | none | own |
> | Finance | read, personal data masked | read, masked | read | all; releases money | none | none |
>
> - **Agents never see full phone numbers.** Calls go through the calling system.
> - **Nobody below Manager** can download or export lists.
> - Every sensitive write is audited with actor, time, reason and the fields that changed.
>
> ### Login (target — built in the login phase; the current code still uses email + TOTP for everyone)
> - Staff log in with their **staff code** and password.
> - Every login by a non-management staff member needs a **6-digit code** from the login code screen, revealed by their Team Lead, a Manager or the CEO, and recorded. Codes are never stored.
> - CEO, Managers and Finance use an authenticator app (TOTP) instead.
> - **Approved devices only**, for every role, approved by a Team Lead or Manager.
> - **One login at a time.** Logout after 1 hour idle, 2 hours at most, or when the app or browser closes.
> - **5 wrong passwords** lock the account for 15 minutes or until unlocked by a Team Lead, Manager or CEO.
> - Office staff can log in only from the office network. No fixed login hours; logins at odd hours are flagged.
> - The CEO or a Manager can lock any account instantly.
> - The admin and call-agent consoles stay behind Cloudflare Access. The `/field-agent` web console exemption expires when the native field agent app ships.
