# Phase 21 API — attendance and reporting lines

Tasks 1 to 5. Later tasks add their routes here.

## GET /staff/without-reporting-line

Who: CEO only.

Request: none.

Response: `200` array of staff who must have a reporting line and do not (call agents, field agents, Team Leads, Managers, Finance). Deactivated accounts are left out. The CEO is never in this list. Each item is the usual staff view: `id`, `code`, `name`, `email`, `role`, `teamLeadId`, `reportsToId`, `status`, `createdAt`, `deactivatedAt`.

Errors: `403` for anyone who is not the CEO.

Example:

```json
[
  {
    "id": "…",
    "code": "FIN-00012",
    "name": "Sneha Patel",
    "role": "finance",
    "reportsToId": null,
    "status": "active"
  }
]
```

Until a Team Lead, Manager or Finance is given a line, their login-code and device requests are handled by the CEO.

## GET /staff/reporting-tree

Who: CEO and Managers. A Manager sees their own part: themselves and everyone below them. The CEO sees everyone who is not deactivated.

Request: none.

Response: `200`

```json
{ "viewerId": "…", "people": [ { "id": "…", "code": "TL-00003", "role": "team_lead", "reportsToId": "…" } ] }
```

Errors: `403` for a Team Lead, agent or Finance.

## POST /staff/:id/reporting-line

Who: the CEO can move anyone. A Manager can move a call agent or field agent between Team Leads who are both in that Manager's teams. The agent must already be under that Manager.

Request:

```json
{ "reportsToId": "team-lead-id", "reason": "Team reshuffle", "moveOpenWork": true }
```

`reason` is required. `moveOpenWork` defaults to `true`.

The new line must match the role: an agent reports to an active Team Lead, a Team Lead to an active Manager, a Manager or Finance to the CEO, and the CEO to nobody. For an agent, `teamLeadId` is written to the same Team Lead.

When the move changes the agent's Team Lead and `moveOpenWork` is true, this month's target, pending follow-ups, open visit assignments and the businesses they account-manage stay with the person. When `moveOpenWork` is false, those items are reassigned to the previous Team Lead. If that Team Lead already has a target for the month, the agent's target stays on the agent.

Response: `201` the updated staff view.

Errors:

- `400` when the reason is missing, the new line is the wrong role or inactive, or the account is deactivated.
- `403` when a Manager moves someone outside their own teams.
- `404` when the staff id does not exist.

The reason and the before/after line are stored in status history and in the audit log (`staff.reporting_line_moved`).

## POST /staff

Creating staff now requires the same line. An agent may send `teamLeadId` or `reportsToId` (they must be the same person when both are sent). Both columns are stored. A Team Lead sends `reportsToId` of an active Manager. A Manager or Finance sends `reportsToId` of the CEO. A CEO sends neither.

Errors add: `400` "A call agent or field agent must report to an active Team Lead", "A Team Lead must report to an active Manager", "A Manager or Finance must report to the CEO", "The CEO reports to nobody".

## Task 2 — the working day

Times come from the server. A time sent in the request is ignored. One day per person: logging in again on a closed day is `400` "This day is already closed". Logging in when the day is already open returns today.

A Manager reading `GET /pricing` no longer receives the attendance settings (`shiftStart`, `shiftEnd`, `productionHoursFullDay`, `halfDayBelowHours`, `dayToleranceMinutes`, `lateGraceMinutes`, `shortBreakMinutes`, `lunchMinutes`, `idleAfterMinutes`, `casualLeavePerMonth`, `emergencyLeavePerMonth`, `refundPriorityWindowDays`). The CEO still reads and writes them. Defaults are 09:30–18:30, 8 production hours, half day under 4.5, 10 minutes tolerance and late grace, 15-minute short break, 30-minute lunch, idle after 10 minutes, 1 casual and 1 emergency leave a month, refund priority 15 days.

`POST /calls` is `400` "Calls are placed only while you are Available" when the caller is not Available. `POST /telephony/callbacks/:id/assign` does not give the callback to someone who is not Available. It assigns the next Available call or field agent, or leaves the callback pending when nobody is Available.

### POST /attendance/login

Who: any staff member, for themselves.

Request: `{}`. A field agent must send `latitude` and `longitude`. Office staff may send them; they are not stored.

Response `201`: today (see `GET /attendance/today`). `lateMinutes` is 0 at `shiftStart` plus the grace, and the minutes after `shiftStart` once grace has passed.

Errors: `400` when a field agent sends no location, or the day is already closed.

Example:

```json
{ "date": "2026-11-10", "status": "available", "loginAt": "2026-11-10T04:00:00.000Z", "logoutAt": null, "lateMinutes": 0, "productionSeconds": 0, "breakSeconds": 0, "idleSeconds": 0, "shortfallSeconds": 28800, "clocks": { "shiftStart": "09:30", "shiftEnd": "18:30", "now": "2026-11-10T04:00:00.000Z" }, "flagged": false, "closedReason": null, "dayType": "open" }
```

### POST /attendance/logout

Who: any staff member, for themselves.

Request: none.

Response `201`: today, with `closedReason` `logout`. Session idle and the two-hour session limit do not call this.

Errors: `400` "Log in before changing status" when the day is not open.

### POST /attendance/status

Who: any staff member, for themselves.

Request: `{ "status": "available" }`. Allowed: `available`, `team_meeting`, `training`, `one_to_one`, `system_problem`, `short_break`, `lunch`.

Response `201`: today.

Errors: `400` when the status is `on_call`, `after_call_notes`, `on_visit`, `travelling` or `idle`, or when the day is not open.

A short break past 15 minutes, or lunch past 30, raises a `break_overrun` review flag for the Team Lead.

### POST /attendance/heartbeat

Who: any staff member, for themselves. The screen sends one while the person is using it.

Request: none.

Response `201`: today. A heartbeat ends Idle and returns the person to Available.

### GET /attendance/today

Who: any staff member, for themselves.

Request: none.

Response `200`: the same shape as login. Before the first login, `status` and `loginAt` are null and `shortfallSeconds` is a full day. No heartbeat for 11 minutes (10 minutes idle, plus the screen's one minute) while Available marks Idle. After-call notes become Available after 2 minutes. A later look still starts Idle at that 11-minute mark.

### POST /attendance/system-problem/:segmentId/approve

Who: that person's Team Lead, a Manager over them, or the CEO. Not the person themselves.

Request: none.

Response `201`: `{ "approved": true }`. Until this, the system-problem time is not production. A repeat approve is a no-op.

Errors: `403` for anyone else. `404` when the segment is not an open system problem.

### POST /attendance/business-check-in

Who: a field agent, for themselves. Sets On visit.

Request: none. The day must already be open.

Response `201`: today, `status` `on_visit`.

### POST /attendance/business-check-out

Who: a field agent, for themselves. Sets Travelling.

Request: none.

Response `201`: today, `status` `travelling`.

The call-status webhook sets On call when `answeredAt` is first stored, and After-call notes when an answered call receives `endedAt`. A call that was never answered does not change the status.

A nightly job closes any day still open, at the last segment or heartbeat, with `closedReason` `auto_closed_no_logout` and `flagged` true.

## Task 3 — full days, half days, shortfall and the month

When a day closes (logout or the nightly close), its `dayType` is set from production time, with the settings `productionHoursFullDay` (8), `halfDayBelowHours` (4.5) and `dayToleranceMinutes` (10):

| Production | Day type | Shortfall |
|---|---|---|
| 8h − tolerance or more (7h 50m and up) | `full` | 0 |
| under 4.5h − tolerance (under 4h 20m) | `half` | 0 |
| in between | `full` | 8h − production |

Production above 8h is make-up time (`makeUpSeconds`). The month's make-up reduces the month's shortfall; what is left is the deductible shortfall. Make-up never crosses into another month and is not paid.

The nightly job (05:30 IST) also writes an `absent` day (`closedReason` `no_login`, no `loginAt`) for yesterday for everyone who marks attendance (not the CEO), is active, existed on that date, and has no day on it. Weekly days off (`weeklyOffDays`, Sunday to start, CEO setting hidden from Managers) are skipped. A day worked on a weekly day off is `off`: no shortfall, and all its production is make-up.

`GET /attendance/today` on a closed day now returns the stored shortfall (0 on a half day).

### GET /attendance/month?month=YYYY-MM&staffId=…

Who: the person (`staffId` left out means yourself); their Team Lead; a Manager over them; Finance and the CEO for anyone. Days and minutes only, no money.

Response `200`:

```json
{
  "staff": { "id": "…", "code": "CA-00007", "name": "Ravi", "role": "call_agent" },
  "month": "2027-02",
  "fullDays": 4, "halfDays": 1, "absentDays": 1, "offDaysWorked": 0,
  "paidLeaveDays": { "casual": 0, "emergency": 0, "total": 0 },
  "unpaidLeaveDays": 0,
  "lateLogins": { "count": 2, "days": [ { "date": "2027-02-02", "minutes": 15 }, { "date": "2027-02-06", "minutes": 30 } ] },
  "productionSeconds": 127260, "breakSeconds": 1200, "breakOverSeconds": 300, "idleSeconds": 1140,
  "shortfallSeconds": 4740, "makeUpSeconds": 4200, "deductibleShortfallSeconds": 540,
  "days": [
    { "id": "…", "date": "2027-02-01", "dayType": "full", "loginAt": "…", "logoutAt": "…", "lateMinutes": 0,
      "productionSeconds": 28800, "breakSeconds": 0, "breakOverSeconds": 0, "idleSeconds": 0,
      "shortfallSeconds": 0, "makeUpSeconds": 0, "flagged": false, "closedReason": "logout",
      "leaveKind": null, "leaveUnpaid": false, "change": null }
  ]
}
```

`breakOverSeconds` is break time past the allowance, break by break (15 minutes a short break, 30 minutes lunch). Today's open day is listed with `dayType` `open` and does not count in the totals of days or shortfall.

Errors: `400` "month must look like 2026-11"; `403` for anyone else; `404` unknown staff.

### POST /attendance/days/:dayId/day-type

Who: the person's Team Lead, a Manager over them, or the CEO. Never the person themselves (a Team Lead or Manager cannot change their own day).

Request: `{ "dayType": "full", "reason": "System was down from 1 PM" }`. `dayType` is `full` or `half`; `reason` is required.

A `full`, `half` or `absent` day can be changed. The change clears the day's shortfall (a changed full day counts as a whole day; a half day never carries shortfall) and keeps make-up time on a full day. It is kept: a later correction recalculates the clocks but not the day type. Every change is written to status history (`attendance_day`) and the audit log (`attendance.day_changed`).

Response `201`: the day row (as in the month summary), with `change: { byStaffId, at, reason }`.

Errors: `400` wrong day type, no reason, day still open, or a leave day; `403` anyone else; `404` unknown day.

### GET /attendance/days/:dayId/history

Who: anyone who may see that person's month.

Response `200`: `[ { "from": "half", "to": "full", "reason": "…", "changedByStaffId": "…", "changedAt": "…" } ]`, newest first.

## Task 4 — leave and corrections

Leave and corrections are asked for by everyone who marks attendance (Managers, Team Leads, agents, Finance). The CEO does not mark attendance and gets `403` on the asking routes.

**Routing (live, along the reporting line):**

| Who asks | Goes to | `routeReason` |
|---|---|---|
| Agent | their Team Lead | `team_lead` |
| Agent, casual leave taking them past 3 planned days in a month | their Manager | `over_limit` ("More than 3 planned days in a month") |
| Agent, their 3rd (or later) correction in a month | their Manager | `third_correction` ("Third correction this month") |
| Team Lead | their Manager | `team_lead_own` |
| Manager | the CEO | `manager_own` |
| Finance | the CEO | `finance_own` |
| Anyone with no line yet | the CEO | `no_line` |

Emergency leave never counts towards the 3 planned days. Pending casual requests count, so the limit cannot be split across requests.

**Escalation (no job; worked out when lists are read):** a request still with the Team Lead after 24 hours also shows for the Manager (`team_lead_24h`) and stays with the Team Lead. A request with the Manager for 48 hours (from when it reached them) also shows for the CEO (`manager_48h`). The first decision closes it for everyone; a later decision gets `409` with who decided. A forwarded request leaves the Team Lead and starts the Manager's clock.

**Who decides:** the Team Lead while it is with them; a Manager over the person while it is with the Manager (before the 24 hours, `403` "This request is still with the Team Lead"); the CEO at any time. Nobody decides their own request. A reason is required.

**Balances:** `casualLeavePerMonth` and `emergencyLeavePerMonth` are earned on the 1st of each month (a person created on the 1st earns that month; otherwise from the next 1st), with no limit on carry forward. The nightly job writes the accrual; reading a balance also fills any missing month.

**Nothing is blocked:** at approval, the first days up to the paid balance are paid leave and the rest unpaid leave (`AttendanceDay` rows with `dayType` `leave`, `leaveKind`, `leaveUnpaid`). Weekly days off inside the range are not leave days. A day the person already worked is left alone.

The person gets an SMS with each decision (`attendance_leave_decision` / `attendance_correction_decision`, to their routing phone; logged in `MessageLog` with `subjectType` `staff`).

Bell hook: `AttendanceRequestHooks` (`requestRouted`, `requestForwarded`, `requestDecided`) is called at each step; it only logs until Task 6 adds the bells.

### POST /attendance/leave

Who: Manager, Team Lead, call agent, field agent, Finance — for themselves.

Request: `{ "kind": "casual", "fromDate": "2027-05-03", "toDate": "2027-05-05", "reason": "Family function" }`. Whole days; `toDate` defaults to `fromDate`; at most three months.

Response `201` (the request view, used by every list below):

```json
{
  "kind": "leave", "id": "…", "staff": { "id": "…", "code": "CA-00007", "name": "Ravi", "role": "call_agent" },
  "status": "pending", "reason": "Family function",
  "where": "with_team_lead", "withTeamLead": true, "withManager": false, "withCeo": false,
  "routedToRole": "team_lead", "routeReason": "team_lead", "routeReasonText": "Sent to the Team Lead",
  "createdAt": "…", "forwarded": null, "decided": null, "canDecide": false,
  "leaveKind": "casual", "fromDate": "2027-05-03", "toDate": "2027-05-05", "days": 3,
  "paidDays": 0, "unpaidDays": 0,
  "casualDaysTakenThisMonth": 0, "casualDaysPendingThisMonth": 0, "overturned": null
}
```

`decided` is `{ at, by: { id, code, name, role }, role, reason }` once decided. `casualDaysTakenThisMonth` counts approved casual days in the month of `fromDate`.

Errors: `400` kind not casual/emergency, missing reason, bad dates, all weekly days off; `403` the CEO.

### GET /attendance/leave/balance?staffId=…

Who: the person (default), their Team Lead, a Manager over them, Finance, the CEO.

Response `200`: `{ "staffId": "…", "asOfMonth": "2027-05", "casual": { "earned": 5, "taken": 2, "paidTaken": 2, "unpaidTaken": 0, "left": 3 }, "emergency": { … } }`

Errors: `403` anyone else.

### POST /attendance/corrections

Who: as for leave, for themselves.

Request: `{ "date": "2027-05-10", "from": "09:30", "to": "10:15", "status": "available", "reason": "System was down, I was working 9:30 to 10:15" }`. `status` is `available` (default), `team_meeting`, `training` or `one_to_one`. Times are IST.

Response `201`: the request view with `kind` `correction`, `date`, `startAt`, `endAt`, `segmentStatus`, `monthNumber` (this person's nth correction in that month).

Errors: `400` missing reason, `to` not after `from`, time not yet passed, a leave day, or today with no login yet.

When approved: the range becomes one segment with `source` `correction`; overlapping segments are trimmed, split or removed and kept on the correction (`replacedSegments`); the login time moves earlier if the range starts before it (late minutes are worked out again); an absent day becomes a worked day; the day is recalculated (a day changed with Change day keeps its day type).

### POST /attendance/requests/:kind/:id/approve · …/reject

`kind` is `leave` or `correction`. Who: see "Who decides". Request: `{ "reason": "Covered by the team" }`.

Response `201`: the request view. Errors: `400` no reason; `403` not yours to decide, or your own; `404`; `409` already decided (`details.decidedBy` names who).

### POST /attendance/requests/:kind/:id/forward

Who: the person's Team Lead, while it is with them. Request: `{ "note": "Your call, busy week" }` (required). Response `201`: the request view, now with the Manager (`forwarded`).

### POST /attendance/requests/leave/:id/overturn

Who: a Manager over the person, for a Team Lead's decision; the CEO for any decision but their own. Once per request. Request: `{ "reason": "Wedding, approved" }` (required). Flips approved ↔ rejected: approving writes the leave days; rejecting removes future leave days and turns past ones back to absent. Response `201`: the view, with `overturned`. Corrections cannot be overturned.

Errors: `400` no reason, not decided yet, already overturned, or a correction; `403` anyone else.

### GET /attendance/requests/mine

Who: anyone who marks attendance. Their own leave and corrections, newest first.

### GET /attendance/requests/team

Who: Team Lead (their team), Manager (their tree), CEO (everyone). Pending requests and those decided in the last 30 days, with `where`.

### GET /attendance/requests/waiting

Who: Team Lead, Manager, CEO. What is waiting for the caller, each with `whyWithYou` and `whyWithYouText`: for a Team Lead, their team's requests with them; for a Manager, requests in their tree that are with the Manager (`team_lead_own`, `forwarded`, `team_lead_24h`, `over_limit`, `third_correction`); for the CEO, requests sent or escalated to the CEO (`manager_own`, `finance_own`, `no_line`, `manager_48h`), and Manager-stage requests of people with no Manager.

### GET /attendance/requests/decided

Who: Team Lead, Manager, CEO. Requests in their scope decided since Monday (IST), by anyone, with who decided.

## Task 5 — attendance reports and the live board

Who sees whom follows the reporting line: a Team Lead their team, a Manager their tree, the CEO everyone. Only people who mark attendance are listed (not the CEO). No money in any of these answers.

### GET /attendance/live

Who: Team Lead (their team), Manager (their tree), CEO (everyone). Finance and agents `403`.

Response `200`:

```json
{
  "asOf": "2027-06-07T04:30:00.000Z",
  "counts": { "short_break": 1, "idle": 1, "not_logged_in": 1, "overBreak": 1 },
  "people": [
    { "staff": { "id": "…", "code": "CA-00007", "name": "Ravi", "role": "call_agent" },
      "status": "short_break", "since": "2027-06-07T04:10:00.000Z", "loginAt": "…", "lateMinutes": 0,
      "productionSeconds": 600, "breakSeconds": 1200, "breakOverSeconds": 300,
      "overBreak": true, "idle": false, "idleSeconds": 0 }
  ]
}
```

`status` is the current status, or `not_logged_in`, `logged_out` or `on_leave`. `overBreak` is true while a short break is past 15 minutes or lunch past 30 (shown red). Reading the board applies the automatic statuses (Idle, end of after-call notes) first.

### GET /attendance/report?staffId=…&from=YYYY-MM-DD&to=YYYY-MM-DD

Who: the person (default), their Team Lead, a Manager over them, Finance, the CEO. Any range up to 92 days.

Response `200`: `{ staff, from, to, lateLogins: { count, days: [ { date, minutes } ] }, days: [ { date, dayType, loginAt, logoutAt, lateMinutes, productionSeconds, breakSeconds, breakOverSeconds, idleSeconds, shortfallSeconds, makeUpSeconds, hoursLostSeconds } ], totals: { productionSeconds, breakOverSeconds, idleSeconds, shortfallSeconds, makeUpSeconds, hoursLostSeconds, lateLogins, absentDays } }`. Hours lost = shortfall + idle.

Errors: `400` bad or reversed dates, range over 92 days; `403`; `404`.

### GET /attendance/team-summary?from=…&to=…

Who: Team Lead (their team), Manager (their tree), CEO and Finance (everyone).

Response `200`: `{ from, to, people: [ { staff, productionSeconds, hoursLostSeconds, lateLogins, absentDays } ], total: { people, productionSeconds, hoursLostSeconds, lateLogins, absentDays } }`.

### GET /attendance/month-sheet?month=YYYY-MM[&format=csv]

Who: Finance and the CEO only. Managers, Team Leads and agents `403`.

One row per person who marks attendance (active, or with days in that month), built from the same month summaries as `GET /attendance/month`:

- `paidDays` = full days + half days × 0.5 + paid leave days
- `unpaidDays` = absent days + unpaid leave days + half days × 0.5
- `deductibleShortfallMinutes` = the month's deductible shortfall, in whole minutes (part minutes dropped)

No rupee amounts (Phase 22). Every read is audited (`attendance.month_sheet_read`).

Response `200` (JSON): `{ "month": "2027-06", "rows": [ { "staffCode": "CA-00007", "name": "Ravi", "role": "call_agent", "fullDays": 2, "halfDays": 1, "paidLeaveDays": 1, "absentDays": 1, "unpaidLeaveDays": 0, "paidDays": 3.5, "unpaidDays": 1.5, "deductibleShortfallMinutes": 9 } ] }`

With `format=csv`: `text/csv`, file `attendance-month-sheet-2027-06.csv`, columns `Staff code,Name,Role,Full days,Half days,Paid leave days,Absent days,Unpaid leave days,Paid days,Unpaid days,Deductible shortfall (minutes)`. No other personal data. A cell starting like a formula is written as text.

Errors: `400` bad month; `403`.

## Public holidays (owner decision, Master Guide Attendance)

The CEO keeps the holiday list per year. A holiday is a paid day off for everyone and behaves exactly like a weekly day off (one helper, `WorkingDaysService`, answers "is this a working day?" for both):

- nobody is marked absent on it;
- leave that spans it does not use a leave day for it;
- time worked on it is make-up (`dayType` `off`), never shortfall or a half day;
- it is left out of target pace (expected pace counts working days only) and of the month's working days (`workingDays` on the month summary; the month sheet gets the same column).

Changing the list re-works the affected dates automatically, from the 1st of the current month (IST) onward, past days included. Earlier months are closed and left alone. A date that becomes a holiday loses its absent rows and leave days (the leave request's paid/unpaid split is worked out again, so the day goes back to the balance); worked days become `off`. A date that becomes a working day again gets back the leave days of approved requests that cover it, worked days become full/half again, and a past date with no login and no leave is marked absent.

Every change is audited (`attendance.holiday_added`, `attendance.holiday_changed`, `attendance.holiday_removed`, `attendance.holidays_set`).

### GET /attendance/holidays?year=2027

Who: any staff member. Response `200`: `{ "year": 2027, "holidays": [ { "id": "…", "date": "2027-01-26", "name": "Republic Day", "weekday": 2 } ] }`. `year` defaults to this year.

### PUT /attendance/holidays/:year

Who: the CEO only. Replaces that year's list. Request: `{ "holidays": [ { "date": "2027-01-26", "name": "Republic Day" } ] }`. Response `200`: the year's list.

Errors: `400` a date outside the year, a date listed twice, a missing name or a bad date; `403` anyone else.

### POST /attendance/holidays

Who: the CEO only. Request: `{ "date": "2027-08-18", "name": "Local festival" }`. Response `201`: the holiday.

Errors: `400` bad date or no name; `403`; `409` already a holiday.

### PATCH /attendance/holidays/:id

Who: the CEO only. Request: `{ "date"?: "2027-08-19", "name"?: "…" }`. Moving the date re-works both dates. Response `200`: the holiday. Errors: `400`, `403`, `404`, `409` the new date is already a holiday.

### DELETE /attendance/holidays/:id

Who: the CEO only. Response `200`: `{ "removed": true }`. Errors: `403`, `404`.

`GET /attendance/month` also returns `workingDays` (days in the month minus weekly days off and holidays) and `holidays` (`[{ date, name }]`).
