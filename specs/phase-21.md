# Phase 21 — Attendance, Leave, Reporting Lines, Bells and the Refund Priority

**Goal:** every staff member marks attendance in the software, and salaries can be worked out from it:
- the day runs on a status clock;
- late logins, shortfall and half days are worked out automatically;
- leave and corrections go through the right approver.

Also:
- Everyone sits in one reporting line (agent → Team Lead → Manager → CEO), and requests follow that line by themselves.
- Each role has a notification bell that clears itself when the work is done.
- Anyone within 15 days of a refund is listed first wherever work is planned.

**Why this is next:** Laboura starts using the software on 20 November. On day one, staff need to log in, mark attendance, take breaks and ask for leave. Team Leads and Managers need to see who is working and what is waiting for them. Payroll is worked out only from attendance (Master Guide).

**This phase is API only.** The screens are built separately, in parallel, from the approved designs. **Do not edit** `src/modules/console/templates/**` or anything under `public/`. Document every new endpoint in `docs/api/phase-21.md` (route, who may call it, request, response, errors, one example each).

**This phase runs after Phase 20 (merged 10 Nov at c52e4fa), in the same folder, one task after another.** Branch names start with `phase-21/`, migration folders start with `20261114`, and new notes go at the end of `LESSONS.md`.

**Read first:** `AGENTS.md`, `LESSONS.md`, this whole spec, and the "Attendance", "Leave", "Reporting lines", "Requests" and "Refund priority and bells" parts of the Master Guide, quoted below. Then read:
- `src/modules/staff/staff.service.ts` (how `teamLeadId` is set);
- `src/modules/login-code/login-code.service.ts` and `src/modules/staff/staff-device.service.ts` (how Team Lead and Manager approvals work today);
- `src/modules/target/money-at-risk.service.ts`;
- the telephony call-status webhook, which writes `CallRecord.startedAt`, `answeredAt` and `endedAt`;
- the job runner in `src/jobs/`.

**Known traps in the current code (checked 10 Nov; handle them, don't stop on them):**
- **There is no staff attendance anywhere** (the word appears only for interviews and in console text). Everything in Tasks 2–5 is new.
- `Staff.teamLeadId` exists but only for call agents and field agents. **A Team Lead has no Manager link**, and Finance has none either. Today Managers act on everyone. Task 1 adds the missing links.
- `MoneyAtRiskService` uses hard-coded windows: `CANDIDATE_AT_RISK_WINDOW_DAYS = 7` and `PLACEMENT_AT_RISK_WINDOW_DAYS = 5`. The Master Guide now says **15 days**, set in Settings, for both (Task 7).
- Calls are routed and placed today without checking the agent's attendance status (Task 2 adds "calls stop for anyone not Available").

**Interpretations to confirm with Agastya** (build them like this; they are easy to change because they are settings):
- **Default settings:**
  - late-login grace **10 minutes**;
  - full/half-day tolerance **10 minutes**;
  - break overrun alert after **15 minutes** for a short break and **30 minutes** for lunch.
- **Leave beyond the balance:**
  - It is never blocked.
  - Approved days beyond the person's paid balance count as **unpaid leave**.
- **Who approves non-agent roles:**
  - Finance reports to the CEO.
  - A Manager's own leave and corrections go to the CEO.

**Out of scope — do not build:** screens, salary amounts and payslips (Phase 22), visit proof and preview mode (a later phase), PF/ESI, holiday calendars.

---

## Master Guide rules this phase follows (quoted)

**Attendance:**
- **Login and logout:**
  - One Login button starts the day; Logout ends it.
  - Times come from Laboura's server.
  - Field agents' location is saved at login.
- **One status dropdown:**
  - Picking a status stops one clock and starts the next.
  - **Set by the phone system, never by hand:** **On call**, and **After-call notes** (up to 2 minutes).
  - **Field agents, set automatically at check-in:** **On visit** / **Travelling**.
  - **Picked by staff:** **Available**, **Team meeting**, **Training**, **One-to-one with Team Lead**, **System problem** (the Team Lead approves), **Short break**, **Lunch**.
  - **Idle** is set automatically when someone is Available but does nothing for 10 minutes. They are first asked "Still there?"; with no answer within a minute they are marked Idle.
- **Production time:**
  - **Counts:** Available, On call, After-call notes, On visit / Travelling, meetings, training and one-to-ones.
  - **Doesn't count:** breaks, lunch and idle time.
- **Calls stop** for anyone who is not Available.
- **Shift:**
  - Fixed shift 9:30 AM to 6:30 PM: 8 production hours, two 15-minute breaks and a 30-minute lunch.
  - A break that runs over alerts the Team Lead.
  - Logging in after the shift start plus a grace period (set in Settings) is marked **late login**, with the minutes.
- **Shortfall and half days:**
  - Below 8 production hours, the missing time is **shortfall**.
  - It can be made up within the same month; whatever isn't made up by month end is deducted.
  - **Under 4.5 production hours is a half day.**
  - No login and no approved leave is **absent** (unpaid).
  - A daily tolerance (set in Settings) applies at both lines.
  - A Team Lead or Manager can change a day to full or half day, with a reason; the history is kept.
- **Forgetting to log out:** the day closes at the last activity and is flagged. Being logged out for idling (60 minutes) or by the 2-hour session limit does **not** end the day.

**Leave:**
- **2 paid leaves a month: 1 casual and 1 emergency** (numbers set in Settings).
- Unused leave keeps adding up with no limit.
- **Leaving the job:** only unused emergency leave is paid out (the CA to confirm).
- **Routing:**
  - An agent's leave request goes to their **Team Lead**, who approves, rejects or forwards it to the Manager.
  - If the Team Lead hasn't answered in **24 hours**, it also appears for the Manager while staying with the Team Lead. Whoever decides first closes it for both, and both see who decided.
  - A Team Lead can approve **up to 3 planned (casual) days in a month** per person. A request that takes the person past 3 goes to the Manager automatically. Emergency leave is not counted. **Nothing is ever blocked.**
  - A Team Lead's own leave goes to the Manager.
  - Anything a Manager leaves for **48 hours** goes to the CEO.

**Corrections:**
- Staff can raise a correction request, for example "system was down, I was working 9:30 to 10:15".
- A Team Lead or above approves it with a reason. **A third correction in a month goes to the Manager.**
- Staff can never edit their own times.

**Reporting lines:**
- Every person has one person they report to, set when the account is created:
  - agent or intern → a **Team Lead**;
  - Team Lead → a **Manager**;
  - Manager → the CEO.
- Requests, approvals, targets, login codes, attendance and reports follow this line automatically.
- Moving someone is one action, recorded in the history; their targets and open work move with them.

**Bells:**
- Each role's bell lists only its own notifications, each linking to where the work is done.
- A notification **clears by itself** when the work behind it is done; cleared ones show under "Done today" with who did it.

**Refund priority:**
- Job seekers whose 30-day guarantee runs out within **15 days** with no suitable offer yet, and businesses whose placement refund falls due within 15 days, are a **priority**.
- They are listed first wherever work is planned: the call agent's Call next, matching, the Team Lead's work list and the Manager's pipeline.
- The window is set in Settings.

---

## How this phase runs

- One task after another, in order, each on its own branch from the latest `main`.
- Push, then check the GitHub Actions result yourself (`gh run watch`), fix on the branch until it's green, merge by pull request, and tick the task.
- **Commit and push after every meaningful change.**
- **Never run Jest or `npm test` locally** (`npx tsc --noEmit` is fine). Never create or edit `.env` files.
- Every test closes the Nest app in `afterAll` inside `try … finally`.
- If the spec and the code disagree in a way this spec doesn't answer, **stop and ask**.

---

### [x] Task 1 — One reporting line for everyone
**Branch:** `phase-21/task-1-reporting-lines` · **Migration folder:** `20261114090000_reporting_lines`

**Acceptance:**
- **Each staff member reports to one person:**
  - Add `Staff.reportsToId`.
  - Rules on create and on move:

    | Role | Must report to |
    |---|---|
    | `call_agent`, `field_agent` (interns included) | an active `team_lead` |
    | `team_lead` | an active `manager` |
    | `manager`, `finance` | the CEO (a `ceo` account) |
    | `ceo` | nobody |
  - The migration copies `teamLeadId` into `reportsToId`. Keep `teamLeadId` in step: write both until a later phase removes `teamLeadId`.
  - Existing Team Leads, Managers and Finance with no line are listed by a CEO-only endpoint, **"People without a reporting line"**, so the CEO can fix them. Requests from them go to the CEO meanwhile.
- **Move:**
  - **CEO:** can move anyone.
  - **Manager:** can move agents between Team Leads in their own teams.
  - The reason and the before/after go in `StatusHistory` and the audit log.
  - Targets for the current month and open work (follow-ups, visit assignments, accounts the agent manages) move with the person **only when** the move changes their Team Lead and the caller says `moveOpenWork: true`. The default is true.
- **Scope helper:** one shared `ReportingScopeService`:
  - `chainOf(staffId)` returns their Team Lead, Manager and CEO.
  - `peopleUnder(staffId)` returns everyone below them.
  - **A Manager now acts only on people under them** (login codes, devices, requests, attendance). The CEO acts on everyone.
- **Reporting tree endpoint** (CEO and Managers; a Manager sees their own part).
- **Tests:**
  - Each role's required line is enforced.
  - The migration copies existing Team Lead links.
  - A move is recorded and takes open work with it.
  - A Manager can't approve a login code for someone outside their tree.
  - The CEO can.
  - People without a line are listed.

### [ ] Task 2 — The working day: login, statuses and production time
**Branch:** `phase-21/task-2-attendance-day` · **Migration folder:** `20261114100000_attendance_day`

**Acceptance:**
- **New tables:**
  - `AttendanceDay`: `staffId`, `date` (IST calendar date), `loginAt`, `logoutAt`, `loginLat`/`loginLng` (field agents only), `lateMinutes`, `productionSeconds`, `breakSeconds`, `idleSeconds`, `dayType` (`full`, `half`, `absent`, `leave`, `open`), `closedReason` (`logout`, `auto_closed_no_logout`), `flagged`.
  - `AttendanceSegment`: `staffId`, `dayId`, `status`, `startedAt`, `endedAt`, `source` (`staff`, `phone_system`, `check_in`, `idle_detector`, `correction`).
  - Unique: one day per staff per date.
- **Statuses:** a closed list exactly as the Master Guide. `system_problem` needs Team Lead approval: until approved it counts as **not** production.
- **Endpoints (any staff, for themselves):**
  - Login and logout.
  - Set status, for staff-picked statuses only. `on_call`, `after_call_notes`, `on_visit`, `travelling` and `idle` can't be set by hand.
  - **Activity heartbeat:** the screen sends one while the person is using it.
  - **Today:** current status, the clocks, production so far, breaks, late minutes and shortfall so far.
- **Automatic statuses:**
  - From the call-status webhook: `answeredAt` → `on_call`; `endedAt` → `after_call_notes`, which becomes `available` after 2 minutes or when the agent picks Available.
  - Field agent check-in at a business → `on_visit`; check-out → `travelling`.
  - Available with no heartbeat for 10 minutes → `idle` (the 1-minute "Still there?" is the screen's job, so the server marks idle at 11 minutes). A heartbeat or picking a status ends idle.
- **Calls stop:**
  - Routing an inbound call to an agent who isn't `available` is refused; route to the next available agent, or use today's no-agent behaviour.
  - Placing an outbound call while not `available` is refused.
- **Production time:** Available + On call + After-call notes + On visit + Travelling + Team meeting + Training + One-to-one + an approved System problem. Breaks, lunch and idle don't count.
- **Settings** in the pricing policy (`PricingPolicy`; Managers can't see or change them):
  - `shiftStart` 09:30, `shiftEnd` 18:30;
  - `productionHoursFullDay` 8, `halfDayBelowHours` 4.5;
  - `dayToleranceMinutes` 10, `lateGraceMinutes` 10;
  - `shortBreakMinutes` 15 (two a day), `lunchMinutes` 30;
  - `idleAfterMinutes` 10;
  - `casualLeavePerMonth` 1, `emergencyLeavePerMonth` 1;
  - `refundPriorityWindowDays` 15.
- **Late login:** a login after `shiftStart + lateGraceMinutes` sets `lateMinutes`, counted from `shiftStart`.
- **Break overrun:** a short break past 15 minutes, or lunch past 30, raises a `break_overrun` notification for the Team Lead (Task 6 bell; until then, a `ReviewFlag`).
- **Forgot to log out:** a nightly job closes any open day at the last segment or heartbeat, marks it `auto_closed_no_logout` and flags it. Idle logout and the 2-hour session limit never end the day.
- **Tests:**
  - Production time adds up correctly across a day with calls, breaks, lunch and idle.
  - Staff can't set phone-system statuses.
  - The call webhook moves an agent to On call and back.
  - No heartbeat for 11 minutes marks Idle.
  - A call isn't routed to a non-Available agent.
  - Late minutes are right at the grace boundary.
  - A break overrun alerts the Team Lead.
  - A forgotten logout closes at the last activity and is flagged.
  - Times come from the server clock, never the request.

### [ ] Task 3 — Full days, half days, shortfall and the month
**Branch:** `phase-21/task-3-day-rules` · **Migration folder:** `20261114110000_day_rules`

**Acceptance:**
- **When a day closes:**
  - production ≥ 8h − tolerance → `full`;
  - production < 4.5h − tolerance → `half`;
  - in between → `full`, with **shortfall** = 8h − production;
  - no login and no approved leave → `absent`;
  - approved leave → `leave`.
- **Make-up time:**
  - Production above 8h on any day of the same month reduces that month's shortfall. This is not overtime and not paid.
  - Shortfall left at month end is the **deductible shortfall**.
- **Change day:**
  - A Team Lead (own team) or Manager (own tree) can change a day to full or half with a reason, kept in history.
  - Staff can't change their own days.
- **Month summary endpoint per person:**
  - full days, half days, absent days, paid leave days (casual and emergency), unpaid leave days;
  - late logins (count, and each date with minutes);
  - production hours by day, breaks over time, idle time;
  - shortfall, make-up and deductible shortfall.
- **Who can see it:** the person themselves; their Team Lead; Managers for their tree; Finance and the CEO for everyone.
- **Tests:**
  - Each boundary with tolerance (7h 52m is full with 10 minutes' tolerance; 4h 21m is half).
  - Make-up reduces shortfall only within the same month.
  - Change day is recorded and only by allowed roles.
  - The month summary matches a hand-worked example.
  - A Team Lead can't see another team.

### [ ] Task 4 — Leave and corrections
**Branch:** `phase-21/task-4-leave-corrections` · **Migration folder:** `20261114120000_leave_corrections`

**Acceptance:**
- **Leave balances:**
  - Every staff member earns `casualLeavePerMonth` casual and `emergencyLeavePerMonth` emergency days on the 1st of each month.
  - Unused days carry forward with no limit.
  - Balance endpoint: earned, taken and left, per type.
- **Leave requests:**
  - Each request has: type (`casual`, `emergency`), dates (whole days; half-day leave isn't offered yet), reason.
  - The response shows how many planned (casual) days the person has already taken that month.
  - **Routing follows the reporting line (Task 1):**
    - An agent's request goes to their Team Lead.
    - A casual request that takes the person **past 3 planned days in that month** goes to the Manager automatically, with the reason "More than 3 planned days in a month".
    - A Team Lead's own request goes to their Manager. A Manager's, or Finance's, goes to the CEO.
  - **Escalation:**
    - Not decided by the Team Lead in 24 hours → also visible to the Manager, while staying with the Team Lead.
    - Not decided by the Manager in 48 hours → also visible to the CEO.
    - The first decision closes it for everyone; all of them see who decided.
  - The Team Lead can **forward** it to the Manager with a note.
  - The Manager can **overturn** a Team Lead's decision with a reason.
  - **Nothing is ever blocked:** days approved beyond the paid balance become unpaid leave.
  - The person gets an SMS with the decision.
- **Correction requests:**
  - Staff ask to change a time range with a reason ("system was down, I was working 9:30 to 10:15").
  - The Team Lead or above approves with a reason.
  - **A person's third correction in a month goes to the Manager** automatically.
  - An approved correction adds or changes segments with `source = correction`, keeps the history, and recalculates the day.
- **Requests list endpoints:**
  - Team Lead: their team's requests.
  - Manager: what is waiting for them, with the plain reason why it's with them (Team Lead's own request, forwarded, 24 hours unanswered, over a limit), plus a "decided this week" list.
  - CEO: what was escalated to them.
- **Tests:**
  - Balances accrue and carry forward.
  - The 4th planned day in a month goes to the Manager; emergency leave doesn't count.
  - A Team Lead's own leave goes to the Manager.
  - 24-hour and 48-hour escalation make the request visible without removing it.
  - The first decision closes it for all.
  - Overturn needs a reason.
  - Approved beyond the balance becomes unpaid.
  - The third correction goes to the Manager.
  - Staff can't approve their own requests.

### [ ] Task 5 — Attendance reports and the live board
**Branch:** `phase-21/task-5-attendance-reports` · **Migration folder:** none expected

**Acceptance:**
- **Live board:**
  - Everyone the caller may see, with current status, since when, today's production, breaks used, over-break (red) and idle.
  - **Who sees whom:** Team Lead: their team. Manager: their tree. CEO: everyone.
- **Report for one person, for any date range:** every late-login date and minutes, production hours by day, breaks over time, idle time, hours lost (shortfall plus idle).
- **Team summary:** production hours, hours lost, late logins and absent days per person and in total.
- **Month sheet for salaries:**
  - One row per staff member: paid days (full days + half days × 0.5 + paid leave), unpaid days (absent + unpaid leave + half days × 0.5), deductible shortfall in minutes.
  - **Finance and the CEO only.** Download as CSV.
  - No rupee amounts yet (Phase 22).
- **Tests:**
  - Each role sees only their scope.
  - The month sheet matches the month summaries.
  - A Manager can't download the salary sheet.
  - The CSV has no personal data beyond name, staff code and role.

### [ ] Task 6 — Notification bells
**Branch:** `phase-21/task-6-notifications` · **Migration folder:** `20261114130000_notifications`

**Acceptance:**
- New table `Notification`: `recipientStaffId`, `kind` (closed list), `title`, `body`, `link` (where the work is done), `subjectType`, `subjectId`, `createdAt`, `clearedAt`, `clearedByStaffId`, `clearedReason`.
  - One open notification per recipient, kind and subject (no duplicates).
- **Created for:**
  - **Team Lead:** a team member's leave or correction request; a break overrun; a `system_problem` to approve; an agent idle over 30 minutes; a refund-priority person in the team (Task 7); an open flag for the team.
  - **Manager:** requests escalated, forwarded or over a limit; a Team Lead's own requests; flags; people without a reporting line in their tree.
  - **CEO:** anything escalated to the CEO; refunds above Finance's limit (existing refund approvals); people without a reporting line.
  - **Finance:** refunds within their limit ready to pay; unmatched bank credits; failed payouts. Use the data that exists today; Phase 22 adds more.
  - **Agents:** their own request decided; their own refund-priority people.
- **Clears by itself** when the work is done:
  - the request is decided;
  - the break ends;
  - the flag is resolved;
  - the person is no longer in the refund window;
  - the payout succeeds.
  - It records who did it.
- **Endpoints:**
  - **The bell:** open count, the latest 20, and "Done today".
  - **The Notifications page:** all, with filters for status and kind.
  - Mark as seen (seen is not cleared).
- **Tests:**
  - Each recipient sees only their own.
  - No duplicates.
  - Each kind clears when its work is done and records who.
  - A Team Lead never gets another team's notifications.

### [ ] Task 7 — Close to a refund: the 15-day priority
**Branch:** `phase-21/task-7-refund-priority` · **Migration folder:** none expected

**Acceptance:**
- **`MoneyAtRiskService` uses `refundPriorityWindowDays`** (default 15) from the policy for both lists. Remove the hard-coded 7- and 5-day constants.
  - **Job seekers:** paid, 30-day guarantee running out within the window, no suitable offer yet.
  - **Businesses:** placement refund due within the window, no replacement found.
- **"Close to a refund" list endpoint:**
  - Grouped **0–5, 6–10, 11–15 days**, with the money at stake per row and in total.
  - Filters: who (job seekers or businesses), how soon, team, agent. Download as CSV.
  - **Who can see it:** CEO, Finance, Managers (their tree; counts only, without rupees, for Managers), Team Leads (their team, no rupees), agents (their own people, no rupees).
- **Priority ordering:**
  - Anyone in the window is listed **first** in the call agent's Call next / work list, in matching (a priority candidate is shown before others with an equal match, never pushed past someone who doesn't pass the filters), in the Team Lead's work list, and in the Manager's pipeline counts.
  - They are marked `priority: true` with `daysLeft`.
- Notifications from Task 6 are created when someone enters the window and cleared when they leave it.
- **Tests:**
  - The window comes from the policy.
  - The buckets are right at 5/6, 10/11 and 15/16 days.
  - Managers see no rupee amounts.
  - Priority people come first in Call next and among equal matches.
  - Leaving the window clears the notification.

---

## Phase 21 Gate

- [ ] Every staff member has the right reporting line; Managers act only on their own tree — by test
- [ ] The day runs on the status clock; phone-system statuses are automatic; calls stop when not Available; idle at 10 minutes; forgotten logouts close and flag — by test
- [ ] Full/half/absent, late login, shortfall and make-up follow the Master Guide with the tolerance from Settings — by test
- [ ] Leave and corrections follow the routing, the 3-day and third-correction limits, and the 24/48-hour escalation; nothing is blocked — by test
- [ ] Live board, reports and the salary month sheet show the right people to the right roles — by test
- [ ] Bells per role, no duplicates, clearing by themselves — by test
- [ ] Close-to-refund list at 15 days with buckets; priority people first wherever work is planned — by test
- [ ] `docs/api/phase-21.md` documents every new endpoint
- [ ] **End-to-end proof, recorded in the report** (each step shows what happened):
  1. A call agent logs in at 9:52 (late by 22 minutes).
  2. They take a call: On call is set by the webhook, then After-call notes, then back to Available.
  3. A 20-minute short break alerts their Team Lead.
  4. They are idle for 11 minutes.
  5. They log out at 17:40. The day is full with a shortfall, and next day's extra time reduces it.
  6. They ask for a 4th casual day this month. It goes to the Manager automatically, and appears on the Manager's bell. The Manager approves and the bell clears.
  7. A Team Lead's own leave goes to the Manager.
  8. A correction is approved and the day recalculates.
  9. A job seeker 12 days from a refund appears first in Call next and on the bells, and drops off when an offer is made.
  10. Finance downloads the month sheet; a Manager can't.
- [ ] All earlier phase gate items still pass; CI green on `main`; every task branch was green before merging; `LESSONS.md` updated

**When the gate passes: stop and report to Agastya.** Include commits, CI links, test counts, one line per task, any tests changed and why, and the end-to-end proof. Do not start anything else.
