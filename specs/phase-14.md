# Phase 14 — Matching and the Map

**Goal:** for each vacancy the app finds the right candidates by fixed rules (no AI), ranks them, and shows the agent the best 3 at a time with a reason for each match — never a phone number. Every profile shown to a business is logged, which is Laboura's proof of introduction under the no-bypass clause. The map shows businesses and vacancies at their exact spot and candidates only as an area-level dot.

**Why this is next:** step 6 of the build order in `specs/data-design.md` §16 (§7). Rules from the Master Guide, "Matching, calling and the map" → "Matching" and "The map".

**Read first:** `AGENTS.md`, `LESSONS.md`, this whole spec, `specs/data-design.md` §2, §4, §6, §7. Read the current `GET /vacancies/:id/shortlist` in `src/modules/vacancy/vacancy.service.ts` (today it only filters trade and salary and sorts by date — it is **replaced**, not extended) and `candidate-shortlist.spec.ts`. Read the Phase 12 trade fallback helper (`JobSeekerTrade` first, old column only when no row) and the existing 30-day clock helper — use them, don't write second copies.

**Interviews don't exist yet** (Phase 15). Two checks the matching rules need — "already in a live interview or offer" and "this business already rejected them" — are written as **one helper each**, reading today's tables (`Placement`, `ReplacementCandidate`). Phase 15 extends those two helpers to read `Interview` too; nothing else changes.

**Out of scope — do not build:** interviews and offers (Phase 15), any AI ranking, Google Maps, live location of anyone, the field agent app.

---

## How this phase runs

One task after another, in order, each on its own branch; build on the latest `main`, push, wait for GitHub Actions green **on the branch**, fix on the branch, merge, tick. Locally run only your own tests. If the spec and code disagree in a way this spec doesn't answer, stop and ask.

---

### [x] Task 1 — The matching engine
**Branch:** `phase-14/task-1-matching-engine` · **Migration folder:** `20261107100000_matching_policy`

**Acceptance:**
- New `PricingPolicy` columns: `matchPageSize` (default **3**), `salaryDaysPerMonth` (default **26** — only for comparing a daily salary with a monthly one), `matchingWeights` (json, defaults below). Never typed as literals.
- One `MatchingService.match(vacancyId, { page })`, used by `GET /vacancies/:id/shortlist` (replacing today's query). Pure rules, computed on read, nothing stored except Task 3's introductions.
- **Step 1 — who can appear.** A job seeker appears only if **all** are true:
  1. `JobSeeker.status = active`;
  2. `job_matching` **and** `profile_sharing` consents are active (Phase 12 `ConsentService`);
  3. not in a live offer or interview — helper `hasLiveOffer(jobSeekerId)`; today: a `Placement` in `offered` or `confirmed`, or a `ReplacementCandidate` in `offered`;
  4. trade matches: any of their trades (Phase 12 fallback helper) equals `Vacancy.tradeSkill`, case-insensitive;
  5. salary ranges overlap, after converting any daily figure to monthly with `salaryDaysPerMonth` (vacancy range is `salaryMinPaise`–`salaryMaxPaise`, or just `salaryMinPaise` if no max);
  6. straight-line distance from the job seeker's home point to the vacancy's point is within the job seeker's `travelDistanceKm`;
  7. has every `languagesRequired` (as `speaks` in `JobSeekerLanguage`) and every `licencesRequired` (`drivingLicenceType` / `certificates`);
  8. `availableFrom` is on or before `startDate`, when both are set;
  9. is 18+ from `dateOfBirth`, and inside `ageMin`/`ageMax` when the vacancy sets them;
  10. matches `genderRequirement` when the vacancy sets one;
  11. `shiftPreference` is `any` or equals the vacancy's `shift` (shift is part of "suitable" in the 30-day guarantee, so an unsuitable shift must not be shown);
  12. this business hasn't already rejected them — helper `businessRejected(businessId, jobSeekerId)`; today: a `Placement` with this business in `rejected`, or a `ReplacementCandidate` for this business's placement in `rejected`;
  13. the business is `verified` (Phase 13).
- **A job seeker or vacancy with no location can't be distance-checked**, so the job seeker is left out — but the response includes counts of who was left out and why (`no_location`, `no_travel_distance`, `consent_missing`), so the agent knows profiles need completing. Counts only, no names.
- **Step 2 — order.** Score = sum of each factor (0 to 1) × its weight. Default `matchingWeights`: `clock` 30, `distance` 20, `experience` 15, `salary` 15, `reliability` 10, `completeness` 5, `pastResults` 5.
  - `clock`: fewer days left on their 30-day clock scores higher — `(30 − daysLeft) / 30`, clipped to 0–1; past day 30 and still owed a refund = 1. Use the existing clock helper; 30 comes from `jobSeekerGuaranteeDays`.
  - `distance`: `1 − distance / travelDistanceKm`.
  - `experience`: years in the matched trade ÷ `experienceRequiredYears`, capped at 1; 1 if the vacancy asks for none.
  - `salary`: 1 if their expected minimum is at or below the vacancy minimum, falling in a straight line to 0 at the vacancy maximum.
  - `reliability`: `1 − (non-reversed hits / maxHits)`.
  - `completeness`: the existing computed profile completeness (0–1); if none exists, the share of the optional §4 profile fields that are filled.
  - `pastResults`: selected ÷ (selected + not selected) from past results; 0.5 if none yet.
  - Ties broken by job seeker id, so the order is stable.
- `matchReasons` for each candidate: short plain phrases, e.g. "Electrician, 4 yrs", "3 km away", "Salary fits", "Day 24 of 30". No personal data beyond what the card shows.
- Pages of `matchPageSize`: page 1 is the best 3, **Show next 3** is page 2, and so on.
- Tests: each of the 13 rules excludes the right person, one test each; a daily-salary seeker matches a monthly vacancy correctly with 26 days; a seeker with no location is excluded and counted; a paused seeker or one without `profile_sharing` never appears; ranking puts a day-27 seeker above an identical day-5 seeker; weights come from `PricingPolicy` (changing them changes the order); paging returns 3, then the next 3, with no repeats.

### [x] Task 2 — Candidate cards and photos
**Branch:** `phase-14/task-2-candidate-cards` · **No migration**

**Acceptance:**
- Each shortlist entry is a **card**: first name only, photo, age (not date of birth), matched trade and years, languages, distance rounded to the nearest km, expected salary, `matchReasons`. **Never** phone, WhatsApp number, last name, exact address, Aadhaar result or date of birth. Same masking rules as Phase 11 for every role.
- `POST /job-seekers/:id/photo` (field agent, call agent, team lead, manager, CEO): stores the photo in private storage through the existing storage-interface pattern, sets `photoStoragePath` and `photoTakenAt`, and is **refused unless `profile_sharing` consent is active**. The current code lets a client set `photoStoragePath` directly in the profile update — remove that; the path is only ever set by this upload.
- The card's photo is a signed link valid for 5 minutes, never a permanent URL.
- Tests: a card contains none of the forbidden fields for any role; a photo upload without `profile_sharing` is refused; `photoStoragePath` can no longer be set through the profile update; the photo link expires.

### [x] Task 3 — Showing candidates to a business, and the proof of introduction
**Branch:** `phase-14/task-3-introductions` · **Migration folder:** `20261107110000_add_candidate_introduction`

**Acceptance:**
- `CandidateIntroduction` exactly as data-design §7: `businessId`, `vacancyId`, `jobSeekerId`, `shownByStaffId`, `shownAt`, `rank`, `score`, `matchReasons`. No unique constraint — every showing is logged. Add `channel`: `share_link` or `in_person`, and `messageLogId` for links.
- **Two ways to show a business candidates**, both logged:
  1. `POST /vacancies/:id/introductions` with `{ jobSeekerIds[] }` — sends the owner a single-use link by SMS/WhatsApp through `MessagingService` (template `candidates_shared`) to a page showing those cards (Task 2 fields only). One `CandidateIntroduction` per candidate, `channel: share_link`.
  2. `POST /vacancies/:id/introductions/in-person` with `{ jobSeekerIds[] }` — the agent showed the cards on their own phone at the business; one row each, `channel: in_person`.
- Only candidates who pass the Task 1 rules **right now** can be shown; anyone else is refused with the reason.
- Who can show: the business's account agent, any call agent, their Team Leads, Manager, CEO.
- Helper `firstIntroduction(businessId, jobSeekerId)` returns the earliest `shownAt` — the start of the 12-month no-bypass window (`noBypassMonths`). Phase 17 uses it.
- `CandidateIntroduction` is never editable or deletable by anyone, like `AuditLog`.
- Tests: sharing 3 candidates writes 3 rows and one message; showing in person writes rows with no message; a candidate who no longer passes the rules can't be shown; `firstIntroduction` returns the first showing after several; no route edits or deletes an introduction; the share page shows no forbidden field.

### [x] Task 4 — The map
**Branch:** `phase-14/task-4-map` · **No migration**

**Acceptance:**
- `GET /map/points?bbox=&trade=` returns, inside the box: businesses (exact point, name, verification status, account agent's name), open vacancies (exact point, role, trade, salary range), and **candidate dots** — active job seekers with `job_matching` consent, grouped into area cells with coordinates **rounded on the server to 2 decimal places** (about 1 km), each cell with a count and the trades in it. **A job seeker's exact location is never sent to the browser**, for any role.
- Who sees the map: CEO, Manager, Team Lead, call agent, field agent — everyone sees all businesses (so two agents don't onboard the same shop). Finance doesn't need it.
- The console page uses an OpenStreetMap-based map (Leaflet, pinned version, from an allowed CDN); no Google Maps. Clicking a business opens its profile; clicking a vacancy opens its shortlist.
- Tests: no response contains a job seeker coordinate with more than 2 decimal places; a paused or no-consent job seeker never appears as a dot; finance is refused; a business pin opens the right profile id.

### [ ] Task 5 — Screens
**Branch:** `phase-14/task-5-screens` · **No migration**

**Acceptance (existing consoles, plain styling):**
- Vacancy page: the shortlist as cards, best 3 first, **Show next 3**, the "left out" counts with what to fix, tick boxes and **Send to owner** / **Shown in person** buttons.
- Business page: list of candidates shown to it, when and by whom (Team Lead and above).
- Map page as Task 4.
- Tests: the screens render for the allowed roles; no full phone number, exact candidate location or date of birth appears on any of them.

---

## Phase 14 Gate

- [ ] Each of the 13 matching rules is enforced, one test per rule; nothing outside the rules appears — by test
- [ ] Ranking follows the weights in `PricingPolicy`; changing a weight changes the order — by test
- [ ] Cards and the share page never show phone, last name, address, date of birth or Aadhaar data — by test
- [ ] Every showing to a business, by link or in person, is logged and can't be edited or deleted; `firstIntroduction` gives the earliest — by test
- [ ] The map never sends a candidate's exact location — by test
- [ ] Photos need `profile_sharing` consent and are only ever served by short-lived links — by test
- [ ] **End-to-end proof, recorded in the report:** a verified business has a walk-in vacancy for an electrician at ₹15,000–18,000 a month; five job seekers exist — one fits perfectly on day 26, one fits on day 4, one is too far, one has paused consent, one wants night shift; the shortlist shows the day-26 one first, then the day-4 one, and none of the other three; the left-out counts are right; the agent sends the top two to the owner; two introductions are logged with the message id; the map shows the business and vacancy pins and the candidates only as rounded dots.
- [ ] All earlier phase gate items still pass; CI green on `main`; every task branch was green before merging; `LESSONS.md` updated

**When the gate passes: stop and report to Agastya.** Commits, CI links, test counts, one line per task, any tests changed and why, and the end-to-end proof. Do not start the next phase.
