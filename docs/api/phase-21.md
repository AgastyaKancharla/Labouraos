# Phase 21 API — attendance and reporting lines

Tasks 1 to 3. Later tasks add their routes here.

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
