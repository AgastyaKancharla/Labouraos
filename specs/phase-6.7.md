# Phase 6.7 — Targets, Achievements and Money at Risk

**Goal:** every agent has a monthly target, the system measures what they actually did from records it already holds, and the rupee value of money currently on the clock is visible to the agent, their Team Lead and the CEO. At the end of this phase the UI pass has real data for every panel in the Command Center design.

**Why this is next:** `target` has existed as a resource in the RBAC matrix since Phase 1, guarding nothing — there is no targets table, module or endpoint. The Playbook promises every agent sight of their own targets and achievements, the Team Lead role is defined almost entirely around aggregated team targets, and the admin dashboard design has a Team Performance panel. None of it exists. The metric set was locked on 2026-10-31 (Playbook §2) and is not open for redesign here.

**A blocker found on 2026-11-01 that Task 1 exists to fix:** four of the six metrics cannot be computed, because the data does not record which agent did what. `JobSeeker` has no registering-agent column and `Placement` has no creating-agent column. Only `Vacancy` carries `capturedByStaffId`. Attribution is also what makes the §4 anti-fraud controls auditable — a selfie, a GPS fix or a duplicate-reuse flag is only investigable if the record names who created it — so Task 1 is worth having whether or not targets is ever finished.

**A correction to record:** Playbook §4 states "Field-agent commission tied to paid placements, not businesses onboarded." **There is no commission.** Agents are salaried (Playbook §7, Agent employment — LOCKED), a mix of interns and paid employees. That §4 line is stale and must be corrected rather than built against. Nothing in this phase assumes variable pay.

**Out of scope for Phase 6.7 — do not build these:** the UI restyle (separate phase, design already done), the native Field Agent app, any form of commission or variable pay calculation (there is none — agents are salaried), any change to the locked metric set, and calls dialled or calls connected as metrics — those are explicitly and permanently excluded, see Task 3.

> Read `AGENTS.md` §7 (RBAC) and the Playbook §2 Targets & Performance before writing this phase. Read `LESSONS.md` first.
>
> **The metric set is locked.** If a metric looks wrong or hard, say so and stop — do not substitute a different one.

---

## Tasks

### [x] Task 1 — Agent attribution, and the unimplemented `own_captured` scope

**Acceptance:**
- Migration adds `registeredByStaffId` (nullable, `SetNull` on delete, indexed) to `JobSeeker`, set to the acting staff member on creation
- Migration adds `createdByStaffId` (nullable, `SetNull` on delete, indexed) to `Placement`, set to the acting staff member on creation
- Nullable and **no backfill** — existing rows are test data, and a guessed attribution is worse than an honest null. Every metric must treat null as "unattributed" and exclude it rather than assigning it to someone
- **The `own_captured` scope is declared in `RBAC_MATRIX` for Call Agents on vacancies and placements but is not implemented anywhere in `rbac.guard.ts`.** Either implement it against the new and existing attribution columns, or change the matrix to the scope that is actually enforced. Do not leave a declared scope that does nothing — report which you chose and why
- Rationale for the doc comment: these columns are what make per-agent measurement possible at all, and they are what makes the §4 anti-fraud controls investigable — a geofence flag or a duplicate-selfie detection is only actionable if the record names who created it. They are **not** for pay: agents are salaried, there is no commission
- Test: creating a job seeker and a placement records the acting staff member
- Test: a record with null attribution is excluded from every metric rather than counted against anyone
- Test: whichever `own_captured` decision was taken is enforced, by test

---

### [ ] Task 2 — The Target model and setting targets

**Acceptance:**
- Migration adds a `Target` model: staff member, period (year and month), the target value per metric, who set it, timestamps. One row per agent per month, uniquely constrained
- **Stored per agent, not as a per-role constant** — this holds today's flat number and allows variation later without a schema change
- `POST` and `PATCH` restricted to **CEO and Manager only**. Team Leads may read their team's targets and may not change them, so figures stay comparable between teams. `RBAC_MATRIX.team_lead.target.write` is already `none` — confirm it is enforced at the endpoint too
- **Interns and paid agents carry identical targets. No scaling by tenure.** A two-week-old agent and a six-month veteran are held to the same figure
- **Pro-rate for mid-month joiners:** an agent whose account was created part-way through the month has their effective target scaled by the days they were actually present, so someone starting on the 20th is not measured against a full month. Pro-rating is applied at read time against the stored full-month figure — never by storing a reduced number, so the original intent stays visible
- **Pro-rating formula (inclusive of start day):** `factor = (daysInMonth - creationDay + 1) / daysInMonth`. An agent created on the 20th of a 30-day month worked the 20th through the 30th = 11 days, so the factor is `11/30`
- **Rounding is FLOOR (`Math.floor`), not nearest.** Rounding down favours the part-month joiner. Where the effective target computes to 0 (such as an agent joining on the last day), return an explicit state meaning `"not measured this period"` (`isMeasured: false`, or `status: 'not_measured'`) rather than an effective target of 0 — a zero target reads as having no expectation, which is not the same thing. Make that state explicit in the response shape so the UI can render it honestly
- Note in the doc comment: `Staff.createdAt` is the only available start-date signal, and it is account creation rather than first working day. Close enough, and stated so nobody later mistakes it for an HR record
- All writes audited
- Test: a Manager can set a target; a Team Lead, Call Agent, Field Agent and Finance cannot
- Test: an agent created on the 20th of a 30-day month has an effective target of `Math.floor(storedTarget * 11 / 30)`
- Test: an agent whose pro-rated target computes to 0 returns the explicit `"not measured this period"` state
- Test: the unique constraint prevents two targets for the same agent and month

---

### [ ] Task 3 — Call Agent metrics

**Acceptance:**
Three metrics, computed from existing records, **nothing self-reported**:

| Metric | Definition |
|---|---|
| Candidates activated | Job seekers with `registeredByStaffId` = this agent whose ₹499 was received within the period |
| Refund rate on own registrations | Of job seekers this agent registered whose 30-day deadline has passed, the share that were refunded. A rate, not a count — lower is better |
| Vacancies captured | Vacancies with `capturedByStaffId` = this agent created within the period |

- The refund rate's denominator is only candidates whose deadline has **actually passed** — a candidate registered three days ago cannot yet count for or against the agent
- Where the denominator is zero, return null rather than zero percent. An agent with no matured registrations has no refund rate, and showing 0% would read as perfect performance
- **Calls dialled and calls connected are NOT metrics and must not be added.** Both are gamed within a fortnight by dialling and hanging up, and neither predicts revenue. Record this prohibition in the doc comment so a future request to add them meets the reasoning rather than a blank page
- Computed fresh on every request; no stored aggregate column
- Test each metric against a fixture with known values, including the zero-denominator case

---

### [ ] Task 4 — Field Agent metrics

**Acceptance:**
Three metrics, same rules:

| Metric | Definition |
|---|---|
| Placements closed | Placements with `createdByStaffId` = this agent where the candidate joined **and** the business paid, within the period |
| Replacement vacancies filled inside 15 days | Replacement vacancies (those with `replacementForPlacementId` set) filled by a placement that reached joined, within 15 days of the parent placement's `dropoutReportedAt`. Attributed to the agent who created the replacement placement |
| Repeat businesses | Businesses where this agent closed a placement and the business already had an earlier joined placement |

- "Placements closed" must require **both** joined and paid — a candidate who joined but whose business never paid earned Laboura nothing, so counting it would reward work that produced no revenue
- The 15-day replacement metric is margin protection, not volume: filling one of these prevents a 100% placement-fee refund. It is deliberately a separate number from placements closed
- Computed fresh on every request
- Test each metric, including a placement that joined but was not paid (must not count) and a replacement filled on day 16 (must not count)

---

### [ ] Task 5 — Money at risk

**Acceptance:**
- One rupee figure: `(₹499 × active candidates approaching their day-30 deadline) + (placement fee × open replacement vacancies approaching their day-15 deadline)`
- **Reuse the eligibility logic from Phase 6.5's `/refunds/due`** — this is the same query shifted a few days earlier. Extract and share rather than reimplement, exactly as Task 9 of Phase 6.5 did for the refund endpoints. If the two can ever disagree about who is at risk, it is wrong
- "Approaching" needs a window: default to candidates within 7 days of their deadline and replacement vacancies within 5 days of theirs. Make both constants, named and documented, not inline numbers
- Available at three scopes: per agent (their own list), per team (a Team Lead's agents), and city-wide (CEO and Manager)
- Each entry names the candidate or placement, the rupees at stake, and days remaining. Sorted soonest-deadline first
- Computed fresh on every request. **Never a stored column** — it turns over at midnight, same rule and same reason as the Priority Dashboard
- Rationale for the doc comment: the Priority Dashboard already computes urgency. Attaching rupees is what turns a refund clock into a daily operating priority rather than an abstraction, and a climbing city-wide figure is the CEO's early warning of a supply or demand imbalance before it surfaces in the refund numbers
- Test: a candidate at 8 days out is absent, at 6 days out is present; the sum matches the rows

---

### [ ] Task 6 — Three visibility levels and behind-pace flagging

**Acceptance:**
- **Agent:** their own target, their own achieved figures, and their own money-at-risk list
- **Team Lead:** each of their agents' figures plus a team total, and a flag per agent who is behind pace
- **CEO and Manager:** everything, plus city-wide money at risk
- Every level enforced server-side on the query, not by hiding interface elements — a Team Lead calling the API directly still gets only their own team
- **Metric direction:** Mark each metric's direction in the model or a constant — `higher_is_better` (volume/margin floors: candidates activated, vacancies captured, placements closed, replacements in 15 days, repeat businesses) versus `lower_is_better` (ceiling: refund rate on own registrations)
- **Behind-pace flagging fires mid-month, not at month end**, when there is still time to correct. Expected pace is the target scaled by days elapsed in the month. Flag an agent whose achieved figure is below 80% of expected pace, and **only from day 8 onward** so a slow first week does not flag the whole team. Both numbers are named constants, documented and adjustable
- **Pace flagging applies ONLY to higher-is-better metrics.** Applying pace to a ceiling metric is meaningless and would falsely flag low refund rates
- **Refund rate gets its own breach flag:** flagged as breached when the actual rate EXCEEDS the threshold, and **only once the denominator is non-zero** (zero denominator has no refund rate and is never flagged)
- Finance has no access to targets at all — confirm `RBAC_MATRIX.finance.target` is `none` and that the endpoints enforce it
- Test: an agent sees only themselves; a Team Lead sees their team and not another's; a Finance user is refused entirely
- Test: an agent at 50% of pace on day 15 is flagged; the same agent on day 5 is not
- Test: behind-pace flagging applies only to higher-is-better metrics; refund rate is not flagged as behind pace
- Test: refund rate breach flag fires when actual rate exceeds threshold with non-zero denominator, and does not fire when denominator is zero

---

### [ ] Task 7 — Placements leaderboard

**Acceptance:**
- A leaderboard on **placements closed**, visible to agents as well as management — this is a deliberate choice, since the team is a mix of interns and paid staff where visible standing works
- Current month by default, with a previous-month view
- Shows agent name, placements closed, and position. **Does not show anyone's target** — an agent on a pro-rated target would otherwise look artificially good or bad next to a full-month peer
- Ranks only agents with a target set for that period, so a newly created account does not appear at the bottom on day one
- Test: ordering is correct, ties are handled deterministically, and an agent with no target for the period is absent

---

## Phase 6.7 Gate

- [ ] Creating a job seeker and a placement records the acting staff member, by test
- [ ] A record with null attribution is excluded from every metric rather than counted against anyone, by test
- [ ] The `own_captured` scope is either implemented or removed from the matrix, with the choice stated in the report, and enforced by test
- [ ] A Manager can set a target; Team Lead, Call Agent, Field Agent and Finance cannot — by test
- [ ] An agent created mid-month has a correctly pro-rated effective target (inclusive start day, floor rounding, explicit "not measured this period" state if target floors to 0), by test
- [ ] All three Call Agent metrics match a known fixture, including the zero-denominator refund rate returning null, by test
- [ ] All three Field Agent metrics match a known fixture, including a joined-but-unpaid placement not counting and a day-16 replacement not counting, by test
- [ ] Money at risk shares its eligibility logic with `/refunds/due` rather than duplicating it, by test
- [ ] Money at risk respects its two windows and the sum matches its rows, by test
- [ ] An agent sees only their own figures; a Team Lead only their team's; Finance is refused — by test
- [ ] Behind-pace flagging applies only to higher-is-better metrics (day 15 at 50% pace flagged, day 5 not flagged); refund rate breach flag fires only when actual rate exceeds threshold with non-zero denominator, by test
- [ ] The leaderboard excludes agents with no target for the period and shows no targets, by test
- [ ] **End-to-end proof, recorded in the report:** set a target for a Call Agent and a Field Agent. Register a candidate, take the ₹499, capture a vacancy, create a placement, mark it joined and paid. Confirm each metric moves by exactly the expected amount and is attributed to the right agent. Then confirm a second agent's figures are unaffected.
- [ ] No stored aggregate or eligibility column was added anywhere
- [ ] All Phase 1–6.6 gate items still pass
- [ ] CI green on `main` — confirmed on GitHub Actions, not locally
- [ ] `LESSONS.md` updated

**When the gate passes: stop. Report to Agastya. Do not start the UI restyle.**

---

## Notes for whoever builds this

**Task 1 is the prerequisite for everything else.** Do not start Task 3 or 4 before it, because the metrics have nothing to attribute to without it.

**The metric set is locked and reasoned.** Each one exists because of a specific feature of how Laboura makes or loses money: the ₹499 is not earned revenue until the candidate is placed, so volume is always paired with a quality or margin-protection number. If a metric looks odd, read Playbook §2 before proposing a change, and raise it rather than substituting.

**These targets do not affect anyone's pay.** Agents are salaried. Targets exist so an agent knows what is expected, a Team Lead can spot someone struggling mid-month, and the CEO can see where the operation is losing money. Nothing in this phase should calculate, imply or store variable compensation.

**Nothing is self-reported.** Every figure comes from records the system already holds. If a metric seems to need an agent to type a number in, it has been misunderstood.

**Verify against `origin/main`.** Confirm every commit is pushed and the GitHub Actions run for it is green. A local `npm test` pass is not evidence — the local environment has no PostgreSQL, so most suites fail there for unrelated reasons.
