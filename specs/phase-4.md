# Phase 4 — Business & Field Operations

**Goal:** a field agent can onboard a business, capture its vacancies, and the system enforces the anti-fraud controls around that visit. A call agent can also capture vacancies by phone. Nothing about placements or money changes hands yet — this phase is purely "who needs workers, and is the visit real."

**Why this is next:** Phase 5 (placements) needs a Business and a Vacancy to place someone into. This is also the first phase where the Field Agent side of the product exists at all, and where `area`-scoped RBAC (defined but not fully exercised until now) gets real data to scope against.

**Out of scope for Phase 4 — do not build these:** placements, placement fees, GST, the replacement/refund guarantee (Phase 5). Referral payouts (Phase 6). Any UI beyond the API (Phase 6) — the Field Agent app itself is a Phase 6 deliverable; Phase 4 builds the API it will call.

> Read `AGENTS.md` and Playbook §4 (Anti-Fraud Controls) before writing this phase. Read `LESSONS.md` first.

---

## Tasks

### [x] Task 1 — Business onboarding

**Acceptance:**
- `POST /businesses` (field_agent, call_agent, manager, ceo) — name, address, `area`, contact person, mobile (OTP-verified, same pattern as job seekers/referrals), GST number (optional)
- `BZ-` code issued, audit logged
- A field agent creating a business has it stamped with their own `area` automatically — they cannot set a different area
- Test: a field agent cannot read or write a business in another agent's `area` (403); a call agent (no area restriction per AGENTS.md §7) can

---

### [x] Task 2 — Vacancy capture

**Acceptance:**
- `POST /businesses/:id/vacancies` — trade/skill required, headcount, offered salary (paise), description
- `VC-` code issued, linked to the business, `status: open`
- Audit logged
- Scoped the same way as Task 1: a field agent only sees/edits vacancies on businesses in their own area; a call agent sees all

---

### [x] Task 3 — Candidate shortlist (read-only matching list)

**Acceptance:**
- `GET /vacancies/:id/candidates` returns active job seekers whose trade/skill matches the vacancy AND whose stated salary range includes the vacancy's offered salary — this is a **filter, not a ranking**: return the matching list in a stable order (e.g. by registration date), do not score or rank candidates (per AGENTS.md §1 — this software is not a matching engine)
- Test: a job seeker with a mismatched trade, or a salary range that doesn't include the vacancy's offer, is excluded

---

### [x] Task 4 — Anti-fraud controls on business visits

**Acceptance:**
- Business creation (Task 1) can optionally carry a visit record: GPS coordinates + timestamp, and a selfie image reference
- Geofence check: compare the selfie's GPS to the business's registered address coordinates — outside a configurable radius sets a `geofenceFlag: true` on the business record rather than hard-blocking creation (per Playbook §4: "flag, not hard-block")
- Duplicate detection: reject (or flag) a selfie whose image hash matches one already used for a different business record
- Camera-only capture (no gallery upload) is a client-side control, completed by the Field Agent app in Phase 6 — this task covers the **server-side checks that don't depend on the client**: geofence and duplicate detection above
- Audit logged, including flags raised
- Tests: a visit outside the geofence radius is flagged, not blocked; a reused selfie image is caught

---

### [x] Task 5 — Priority Dashboard API (read-only, calculated fresh)

**Acceptance:**
- Three read-only `GET` endpoints, accessible to field_agent, call_agent, manager, ceo:
  - `GET /priority/candidates` — active job seekers sorted by days remaining on their 30-day refund clock, soonest first, computed fresh from `paymentReceivedAt` on every request — **never stored as a column**. Within the same urgency band, tiebreak by stated salary range descending (higher expected salary = bigger fee value = sorts first). Each row includes `band` (`critical` ≤7 days, `high` 8–15, `medium` 16–23, `normal` 24+) and a `twoHitFlag` (true when `hitCount === 2`, regardless of band — one more hit loses the candidate entirely).
  - `GET /priority/vacancies` — open vacancies, with replacement vacancies (`replacementForPlacementId` not null) still inside their 15-day window sorted to the top, then by days-open descending, then by headcount × offered salary descending (same fee-value tiebreak principle).
  - `GET /priority/trades` — per trade/skill: count of active candidates vs sum of open vacancy headcount, so a field agent can see which trades are candidate-surplus (go find vacancies) vs vacancy-surplus (go find candidates).
- **`/priority/candidates` is city-wide for every field agent** — this is the one deliberate exception to this phase's area-scoping rule (Tasks 1–2). `/priority/vacancies` and `/priority/trades` stay area-scoped for field agents exactly like Tasks 1–2; call_agent/manager/ceo see all areas everywhere, as elsewhere.
- This is **urgency sorting on known dates, not a ranking/matching algorithm** — see `AGENTS.md` §1. The sort rules above are the whole feature; do not add scoring, weighting, or anything that estimates fit.
- Pure read model over existing tables — no new write paths, no new columns, nothing persisted.
- Test: a candidate's position in `/priority/candidates` changes correctly as the injectable clock (§9) advances past a day boundary; a field agent sees candidates registered in a different field agent's area; a field agent does **not** see a vacancy from outside their own area via `/priority/vacancies`.

---

### [x] Task 6 — RBAC and seed data

**Acceptance:**
- Finance's read of a business/vacancy is masked the same way as job seekers (no contact person phone number)
- Finance is denied all `/priority/*` endpoints (403) — not a finance concern
- `npm run seed` extended: 2–3 businesses in different areas, each with 1–2 vacancies, at least one flagged for geofence mismatch; at least one replacement vacancy inside its 15-day window and one outside it; job seekers spread across refund-clock days remaining (some ≤7, some >24) with at least one sitting on exactly 2 hits — enough spread to exercise every Priority Dashboard sort rule

---

## Phase 4 Gate

- [x] A field agent can create a business and vacancy only within their own area, by test
- [x] A call agent can create them anywhere, by test
- [x] The candidate shortlist filters correctly on trade and salary range and never ranks, by test
- [x] A geofence mismatch flags rather than blocks, by test
- [x] A reused selfie image across businesses is caught, by test
- [x] `/priority/candidates` is visible to a field agent city-wide, sorted soonest-refund-deadline first with the fee-value tiebreak, and flags 2-hit candidates, by test
- [x] `/priority/vacancies` puts an in-window replacement vacancy at the top, by test
- [x] `/priority/trades` correctly reports candidate/vacancy counts per trade, by test
- [x] Finance is denied `/priority/*`, by test
- [x] All Phase 1–3 gate items still pass
- [x] `LESSONS.md` updated

**When the gate passes: stop. Report to Agastya. Do not start Phase 5.**