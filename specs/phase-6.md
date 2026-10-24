# Phase 6 — Payouts, Finance & Consoles

**Goal:** referral partners get paid correctly and on the right trigger, Finance has a working ledger view, and the three human-facing interfaces — Admin Dashboard, Call Agent console, Field Agent app — exist and talk to everything built so far.

**Why this is next:** every backend capability needed to support real daily use now exists (Phases 1–5). Phase 6 is where the people actually using Laboura every day — call agents, field agents, management, finance — get an interface instead of raw API calls. Referral payouts slot in here because they're a straightforward read off Phase 5's `joinedDate`, best built alongside the Finance view that will also display them.

**Out of scope for Phase 6 — do not build these:** real telephony integration, load/scale testing, production hardening (Phase 7).

> Read `AGENTS.md` §6 Referral side (payout timing — on joining, never on ₹499 receipt) and §7 RBAC before writing this phase. Read `LESSONS.md` first.

---

## Tasks

### [x] Task 1 — Referral payout trigger

**Acceptance:**
- A scheduled job (or a hook on Phase 5 Task 4's `joined` event — either is fine, but tests must prove it fires) creates a `Payment` (`type: referral_payout`) for a job seeker's `referredById`, the moment `joinedDate` is set — **not** on ₹499 receipt
- **The exact payout amount isn't locked anywhere in `AGENTS.md` or the Playbook as of Phase 1–5. Stop and ask Agastya for the figure before hardcoding anything** — per AGENTS.md §2 rule 6 and §14, guessing this is worse than not building it yet
- Idempotent: a job seeker whose `joined` event somehow fires twice (defensive test) never produces two payouts
- Audit logged
- Test: a job seeker with no `referredById` triggers no payout; one with it does, exactly once, exactly on joining

---

### [x] Task 2 — Payout disbursement

**Acceptance:**
- Reuses the `PaymentProvider` pattern (Phase 2 Task 4), but for an outbound payout rather than an inbound charge — if the provider interface doesn't yet support payouts, extend it with a `disbursePayout` method on the same mock-then-real pattern
- `Payment.status` moves `pending` → `succeeded`/`failed` based on the (mocked) disbursement result
- Audit logged

---

### [x] Task 3 — Finance ledger view

**Acceptance:**
- `GET /payments` (finance, ceo, manager) — filterable by type, status, date range
- Finance's view shows unique IDs and amounts, masks PII exactly as the Phase 1 masking layer already does elsewhere (reuse it, don't reimplement)
- `GET /payments/:id` same masking rule

---

### [x] Task 4 — Admin Dashboard (CEO/management)

**Acceptance:**
- A web frontend (framework choice is yours — document it in `AGENTS.md` §3 once chosen) covering: job seeker/referral/business/vacancy/placement lists and detail views, the payment ledger, refund approval actions (calling Phase 5 Tasks 7/8), pricing/policy controls (CEO-only, per §7)
- Every action in the UI calls the already-built, already-RBAC-enforced API — **no new business logic lives in the frontend**, per AGENTS.md §2 rule 2
- A manager token cannot see pricing controls in the UI (and the API still enforces it server-side regardless, per Phase 1)

---

### [x] Task 5 — Call Agent console

**Acceptance:**
- Covers: job seeker/referral/business onboarding forms, OTP verification flow, payment link generation, vacancy capture, candidate shortlist view (Phase 4 Task 3), contact-attempt logging, hit recording, placement offer/response flow
- Same rule as Task 4: UI calls the API, no logic duplicated client-side

---

### [x] Task 6 — Field Agent app

**Acceptance:**
- Covers: business onboarding with camera-only selfie capture (no gallery picker exposed — this completes what Phase 4 Task 4 left to the client), vacancy capture, candidate shortlist, interview arrangement
- Area-scoping is enforced server-side already (Phase 4); the app simply shouldn't offer UI for areas the logged-in agent can't act on
- **Priority Dashboard screen** — this is a field agent's daily-use screen, not a nice-to-have (per the Playbook, every unplaced candidate and every unfilled replacement vacancy is a clock running down). Three views calling Phase 4's `/priority/*` endpoints directly, with no client-side scoring or re-sorting of what the API returns:
  - Candidate urgency list (city-wide, per Phase 4 Task 5) — shows the urgency band and flags any 2-hit candidate clearly
  - Vacancy priority list (own area) — in-window replacement vacancies visibly distinguished at the top
  - Trade supply/demand board (own area) — surplus-candidate trades vs surplus-vacancy trades, at a glance
- Nothing on this screen is cached stale across a day boundary — it re-fetches rather than reusing yesterday's sort

---

### [ ] Task 7 — RBAC, masking and seed data for this phase

**Acceptance:**
- Every console/app enforces login (Phase 1 Task 6) and reflects only what its role is permitted to see or do
- `npm run seed` extended: at least one referral with a completed, joined, paid-out placement

---

## Phase 6 Gate

- [ ] Referral payout fires exactly once, exactly on `joinedDate`, never on ₹499 receipt, by test
- [ ] A job seeker with no referral triggers no payout, by test
- [ ] Finance's ledger view never exposes PII, by test
- [ ] All three interfaces are reachable, authenticate against Phase 1's auth, and each role sees only what §7 allows — spot-checked manually and noted in the report
- [ ] The Field Agent app's Priority Dashboard screen shows live data from `/priority/*` (candidate urgency city-wide, vacancy priority and trade board area-scoped) and reflects a change correctly after a re-fetch — spot-checked manually and noted in the report
- [ ] All Phase 1–5 gate items still pass
- [ ] `LESSONS.md` updated

**When the gate passes: stop. Report to Agastya. Do not start Phase 7.**