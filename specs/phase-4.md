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

### [ ] Task 4 — Anti-fraud controls on business visits

**Acceptance:**
- Business creation (Task 1) can optionally carry a visit record: GPS coordinates + timestamp, and a selfie image reference
- Geofence check: compare the selfie's GPS to the business's registered address coordinates — outside a configurable radius sets a `geofenceFlag: true` on the business record rather than hard-blocking creation (per Playbook §4: "flag, not hard-block")
- Duplicate detection: reject (or flag) a selfie whose image hash matches one already used for a different business record
- Camera-only capture (no gallery upload) is a client-side control, completed by the Field Agent app in Phase 6 — this task covers the **server-side checks that don't depend on the client**: geofence and duplicate detection above
- Audit logged, including flags raised
- Tests: a visit outside the geofence radius is flagged, not blocked; a reused selfie image is caught

---

### [ ] Task 5 — Priority Dashboard API

**Acceptance:**
- `GET /field-agent/priority-dashboard` (field_agent, call_agent, manager, ceo) returns matching opportunities for open vacancies
- Specific sort rules: refund-clock deadline first (candidates closest to their 30-day refund guarantee expiration come first), potential fee value as tiebreak (higher fee value first)
- Deliberate exception to area-scoping: candidate visibility is city-wide for field agents (candidates anywhere in the city are eligible), while vacancies and businesses remain strictly area-scoped to the field agent's assigned area
- Computed fresh on every request from existing data — nothing stored in database
- Tests: sort ordering by refund deadline first, fee value tiebreak, area-scoping on vacancies, and city-wide inclusion of candidates

---

### [ ] Task 6 — RBAC and seed data

**Acceptance:**
- Finance's read of a business/vacancy is masked the same way as job seekers (no contact person phone number)
- `npm run seed` extended: 2–3 businesses in different areas, each with 1–2 vacancies, at least one flagged for geofence mismatch

---

## Phase 4 Gate

- [ ] A field agent can create a business and vacancy only within their own area, by test
- [ ] A call agent can create them anywhere, by test
- [ ] The candidate shortlist filters correctly on trade and salary range and never ranks, by test
- [ ] A geofence mismatch flags rather than blocks, by test
- [ ] A reused selfie image across businesses is caught, by test
- [ ] Priority dashboard sorts by refund-clock deadline first with fee value tiebreak, area-scoped vacancies and city-wide candidates, by test
- [ ] All Phase 1–3 gate items still pass
- [ ] `LESSONS.md` updated

**When the gate passes: stop. Report to Agastya. Do not start Phase 5.**