# Laboura Field redesign — server API contract

Branch `build/field-redesign-server`. Owner decision: Master Guide rev 188 (16 Nov), "Laboura Field redesign";
fixes after the end-to-end check: rev 192 (S1–S5, see §9).
This file is the contract between the server and the Laboura Field app (`field/`). It lists every endpoint
the redesigned app uses: **new**, **changed** and **reused** (unchanged). It is kept up to date with every
server change on the branch.

## Rules for every field-agent endpoint here

- Signed in as a **field agent** (`Authorization: Bearer <staff token>`); any other role gets `403`.
- Works only on the agent's **own records**. "Own business" (`canAct: true`) = the agent is the business's
  account agent, or created the lead and it is still `lead` / `pending_visit` with no other account agent, or
  holds an open verification visit (assignment) for it. Completing a verification visit of a business that has
  no account agent makes the verifying agent its account agent (rev 192 S1), so he keeps acting on it after the
  assignment closes. Other businesses are **view-only** (`canAct: false`): reads work, writes answer `403` with
  code `NOT_YOUR_BUSINESS`.
- **Phone numbers are masked** (last 4 digits) by the server; only `…Last4` fields are sent where a number is
  needed. No rupee totals (fees, GST, invoices) are sent. Vacancy salaries are sent (job details).
- **Days are IST** (UTC+05:30) calendar days. Dates are `YYYY-MM-DD` (IST); instants are ISO 8601 UTC.
- `title` / `subtitle` in lists are **data** (a business name, a person's first name, a trade, an area), never
  sentences. The app writes the words for each `kind` / `type` in the agent's language (Kannada / English).
- **Errors** (rev 192 S5: the shape as the server really sends it). Every error goes through the global error
  filter, so the stable **`code` is at `details.code`**, never at the top:

  ```json
  { "statusCode": 409, "message": "…English…",
    "details": { "statusCode": 409, "error": "Conflict", "code": "VISIT_RESULT_ALREADY_SET", "message": "…English…", "currentOutcome": "owner_not_there" },
    "requestId": "…", "timestamp": "2026-11-16T05:30:00.000Z" }
  ```

  Switch on `details.code`; the extra fields of an error (`currentOutcome`, `retryAt`, `missing`,
  `legalMinimumPaise`, …) are next to it in `details`. `message` is English, for logs only: the app shows its own
  Kannada / English words for each code and never the raw `message`. A `5xx` error says only
  `"message": "Internal server error"`; a coded one keeps its code (`"details": { "code": "AGREEMENT_SMS_FAILED" }`)
  and nothing else. Older errors with no code: `details` is `{ statusCode, message, error }` (no `code`); for a
  validation error `message` can be a list. `429` from a public page's "Send code" carries `details.retryAfterSeconds`.
- Writes may carry `Idempotency-Key` (offline queue): a repeat with the same key replays the first answer.

Status: ✅ built and tested on the branch · 🟡 being built (shape fixed, may gain fields). All endpoints below are ✅.

---

## 1. Today tab

### ✅ `GET /field-work/today` — NEW

Everything the Today tab shows in one call.

```json
{
  "now": "2026-11-16T05:30:00.000Z",
  "date": "2026-11-16",
  "attendance": { "...": "exactly the answer of GET /attendance/today (status, loginAt, lateMinutes, …)" },
  "numbers": {
    "shopsVisited": 4,
    "onboarded": 1,
    "vacanciesConfirmed": 2,
    "candidatesShown": 6,
    "interviewsBooked": 1,
    "interviewsAttended": 0
  },
  "targets": { "year": 2026, "month": 11, "placementsClosed": 3, "placementsTarget": 10 },
  "needsYou": [
    {
      "id": "agreement_waiting:7c1e…",
      "kind": "agreement_waiting",
      "title": "Sri Sai Bakery",
      "subtitle": "JP Nagar",
      "at": "2026-11-15T09:12:00.000Z",
      "due": null,
      "target": { "type": "business", "id": "7c1e…", "step": "agreement" },
      "agreement": { "state": "link_expired", "linkSentAt": "2026-11-15T09:12:00.000Z", "linkExpiresAt": "2026-11-16T09:12:00.000Z" }
    }
  ]
}
```

- `attendance` is `null` only if attendance could not be read (the rest still answers).
- `numbers` (each tappable → `GET /field-work/day?date=<today>` filtered by the matching day item `type`):
  | number | counts (today, IST, this agent) | day item `type` |
  | --- | --- | --- |
  | `shopsVisited` | visits with the board photo or the selfie | `visit` |
  | `onboarded` | businesses I **first** onboarded today, each counted **once** (rev 189): its registration from a shop visit, or its first visit marked onboarded, falls on today and was mine. A later visit to an already-onboarded business is `already_onboarded` and never adds (B3/B24 fixed too) | day rows with `countsAsOnboarded: true` |
  | `vacanciesConfirmed` | vacancies I captured that the owner confirmed today | `vacancy_confirmed` |
  | `candidatesShown` | candidates I showed (in-person introductions) | `candidates_shown` |
  | `interviewsBooked` | interviews I booked | `interview_booked` |
  | `interviewsAttended` | interviews where I marked "candidate arrived" or "didn't come" | `interview_attended` |
- `targets`: this month's placements closed (same count as Targets / `GET /targets/dashboard`) and the
  `placementsClosed` target (`null` when no target is set).
- `needsYou`: one list of everything waiting on the agent. Each item opens **the exact step** via `target`.

#### Needs-you-now item

| field | meaning |
| --- | --- |
| `id` | stable key `<kind>:<record id>` (use as React key) |
| `kind` | see table below |
| `title`, `subtitle` | data only (names, area, trade) |
| `at` | the moment the item is about (link sent, interview time, due date start…) or `null` |
| `due` | `overdue` / `today` / `tomorrow` / `null` |
| `target` | `{ type, id, step?, businessId?, vacancyId? }` — where the tap goes |

| `kind` | when | `target` | extra fields |
| --- | --- | --- | --- |
| `interview_today` | an interview (status offered / confirmed) today that I attend (my interview visit assignment, or I booked it and said I will attend) and that has no arrival / result yet | `{type:'interview', id, step:'attend', businessId}` | `interview: {startsAt, candidateName}` (first name + initial) |
| `visit_unfinished` | my visit in the last 7 days that has no result: selfie done but no business form; "onboard now" chosen but no selfie; or no result at all; or a verification visit not completed | `{type:'visit', id, step}` with `step` = `continue_business_form` · `mark_onboarded` · `take_selfie` · `record_result` · `verify` | `visit: {startedAt, purpose}` |
| `agreement_waiting` | my business with no signed agreement | `{type:'business', id, step:'agreement'}` | `agreement: {state, linkSentAt, linkExpiresAt}` (`state`: `link_sent` / `link_expired` / `not_sent`) |
| `vacancy_awaiting_owner` | a vacancy on my business waiting for the owner's code / link | `{type:'vacancy', id, step:'enter_code', businessId}` | `vacancy: {code, trade, headcount}` |
| `vacancy_draft` | a draft vacancy on my business (from the business form) | `{type:'vacancy', id, step:'send_to_owner', businessId}` | `vacancy: {code, trade, headcount}` |
| `ready_show_candidates` | my business allowed to see candidates with an open vacancy nobody has been shown for yet | `{type:'business', id, step:'show_candidates', vacancyId}` | `vacancy: {code, trade, headcount}` |
| `joining_due` | a placement on my business (or that I made) joining by tomorrow, not yet confirmed joined | `{type:'placement', id, step:'confirm_joining', businessId}` | `placement: {code, joiningDate, candidateFirstName}` |
| `revisit_due` | my visit with "come back later" / "owner not there" due by today, with no later visit | `{type:'revisit', id:<earlier visit id>, step:'start_visit', businessId}` (`businessId` null for an unregistered shop: start the visit with `revisitOfVisitId`) | `revisitOn` |
| `followup_task` | my pending follow-up task due by tomorrow | `{type:'followup', id:<task id>, step:<task kind>}` plus `subjectType`, `subjectId`, `relatedType`, `relatedId` | `taskKind`, `code` |

**Order** (most urgent first): `interview_today` (by time), `visit_unfinished`, `agreement_waiting` (expired
links first), `vacancy_awaiting_owner`, `vacancy_draft`, `ready_show_candidates`, `joining_due`,
`revisit_due` (overdue first), `followup_task`; inside a kind, overdue before today before tomorrow, then by `at`.
At most 100 items.

### ✅ `GET /field-work/home` — CHANGED (deprecated, kept until the app switches to `/today`)

Same shape as before. `today.onboarded` now uses the corrected count above.

### Reused (unchanged)

- `GET /attendance/today`, `POST /attendance/login` `{latitude, longitude, accuracy}`, `POST /field-agent/check-in`,
  `POST /attendance/logout` (End my day).
- **Status chip** — `POST /attendance/status` `{status}` (rev 192 S5). The statuses a person can pick are exactly:
  `available` · `team_meeting` · `training` · `one_to_one` · `system_problem` · `short_break` · `lunch`.
  Anything else answers `400` ("On call, after-call notes, on visit, travelling and idle cannot be set by hand").
  The server sets the others by itself, and `GET /attendance/today` reports them as the current status:
  `on_visit` when a visit starts (board photo; or `POST /attendance/business-check-in`), `travelling` when it
  ends (selfie, or the result of a visit with no selfie; or `POST /attendance/business-check-out`), `on_call` /
  `after_call_notes` from the phone system, `idle` after no activity. Show those as the current status, never as
  choices.
- `GET /search?q=` (search bar on every main tab).
- `GET /screens/field-selling/settings` — fee calculator (see §8; gained fields).

---

## 2. Visits tab

### ✅ `GET /field-work/day?date=YYYY-MM-DD` — NEW (Today's work)

`date` optional, default today (IST). Refused: not `YYYY-MM-DD` / not a real date → `400 DATE_INVALID`;
after today → `400 DATE_IN_FUTURE`; more than 90 days before today → `400 DATE_TOO_OLD`.

```json
{
  "date": "2026-11-15",
  "isToday": false,
  "counts": { "visit": 5, "business_registered": 1, "job_seeker_registered": 2, "referral_registered": 0,
              "vacancy_added": 2, "vacancy_confirmed": 1, "candidates_shown": 1, "interview_booked": 0, "interview_attended": 1 },
  "items": [
    {
      "type": "visit",
      "id": "visit:5f0c…",
      "at": "2026-11-15T10:02:00.000Z",
      "title": "Sri Sai Bakery",
      "subtitle": "JP Nagar",
      "status": "interested_later",
      "target": { "type": "visit", "id": "5f0c…" }
    }
  ]
}
```

Items newest first. `type` and what they hold:

| `type` | record (by me, that IST day) | `status` | `target` |
| --- | --- | --- | --- |
| `visit` | every shop / verification visit I started (all results, unfinished too) | the result (`onboarded`, `already_onboarded`, `interested_later`, `not_interested`, `owner_not_there`) or `unfinished` | `{type:'visit', id}` → visit details |
| `business_registered` | business I registered (lead I created) | `verificationStatus` | `{type:'business', id}` |

`visit` and `business_registered` items also carry `countsAsOnboarded`: `true` on the one row per business
that the Onboarded number counts for that day (its first onboarding; the visit when there is one, else the registration).
| `job_seeker_registered` | job seeker I registered | job seeker `status` | `{type:'job_seeker', id}` |
| `referral_registered` | referral partner I registered | `paused` / `active` | `{type:'referral', id}` |
| `vacancy_added` | vacancy I captured (drafts too) | vacancy `status` | `{type:'vacancy', id, businessId}` |
| `vacancy_confirmed` | vacancy I captured that the owner confirmed | `open` | `{type:'vacancy', id, businessId}` |
| `candidates_shown` | one row per business + vacancy where I showed candidates; `count` = how many | — | `{type:'business', id:<businessId>, vacancyId}` |
| `interview_booked` | interview I booked | interview `status` | `{type:'interview', id, businessId}` |
| `interview_attended` | interview where I marked arrival or "didn't come" | `arrived` / `no_show` | `{type:'interview', id, businessId}` |

`candidates_shown` items also carry `count`.

### Reused / changed for the Visits main page

- `GET /field-work/visits` (planned today, revisits due, done today) — unchanged, except `doneToday[]` rows gain
  `nextStep` (same values as visit details below) so "Selfie needed" / "Continue to business form" open the right step.
  **Rev 192 S4:** `planned[]` leaves out an interview visit whose attendance is recorded ("candidate arrived" or
  "didn't come"); it shows in Today's work as `interview_attended` instead. The app needs no change for this.
- **Planned today** rows: `purpose: 'interview'` → interview screen (`GET /screens/field-selling/interviews/:id`,
  "candidate arrived": `POST /field-selling/interviews/:id/arrival`); `verification` / `business_signup` → verify flow.

### Visit flow (reused; changes marked)

| step | call |
| --- | --- |
| board photo, GPS (starts the visit) | `POST /field-visits` multipart (`photo` + `id` (UUID from the phone), `latitude`, `longitude`, `accuracy`, `takenAt`, `source:'live_camera'`, stamp fields, optional `businessId` / `revisitOfVisitId` / `assignmentId`). **CHANGED:** `revisitOfVisitId` of another agent's visit → `403 NOT_YOUR_VISIT`; `businessId` of a business with another account agent (and no assignment of mine) → `403 NOT_YOUR_BUSINESS`. |
| talk + result | `POST /field-visits/:id/outcome` `{outcome, shopName?, spokeTo?, contactPhone?, reason?, revisitOn?, note?, endedAt?}`; `outcome` = `onboard_now` · `interested_later` · `not_interested` · `owner_not_there` · `onboarded`. **CHANGED:** see below. |
| selfie with the board | `POST /field-visits/:id/proof` multipart (unchanged) |
| business form | `POST /businesses` with `fieldVisitId` (unchanged). **Saving it marks the visit `onboarded` on the server** (existing). `staffNeededRows` may be empty or left out (verified). |
| verification visit | `POST /businesses/:businessId/visit-assignments/:assignmentId/owner-otp`, `POST /field-visits/:id/verify` — **CHANGED:** completing it now also sets the visit result to `onboarded` (B19). **Rev 192 S1:** if the business has no account agent, the verifying agent becomes it (recorded in the audit log as `business.account_agent_assigned`, like every account-agent change); a business that already has one keeps it. The answer gains `isAccountAgent` (he is its account agent now) and `becameAccountAgent` (this visit made him so; show "You are now its account agent" only then). The next step (agreement) then works for him. |

**Visit results** (`outcome`) and their meaning (the app writes the label in Kannada / English):

| value | label (English) | counts in Onboarded | Change result |
| --- | --- | --- | --- |
| `onboarded` | Onboarded | yes, once per business, on its first onboarding day | locked |
| `already_onboarded` | Already onboarded (rev 189) | **never** | locked |
| `interested_later` | Come back later | no | allowed |
| `not_interested` | Not interested | no | allowed |
| `owner_not_there` | Owner not there | no | allowed |

**`POST /field-visits/:id/outcome` — CHANGED**
- A visit that already has a result is never overwritten (B3): `409 VISIT_RESULT_ALREADY_SET`
  (`{currentOutcome}` in the body). The same result sent again (same outcome, date and reason) answers `200`
  with the visit as it is (safe for retries). To change a result use `change-result`.
- `outcome: 'onboarded'` is for a visit to an **already registered** business of mine (revisit + "onboard now",
  B9): needs the selfie first (`400 SELFIE_REQUIRED`), the business must be mine (`403 NOT_YOUR_BUSINESS`), no
  second registration happens; the server then checks whether in-person onboarding is complete. On a visit with
  no business → `400 BUSINESS_NOT_REGISTERED` (use the business form).
- **Rev 189 — counted once:** on a business that was **already onboarded before** (registered from a shop visit,
  onboarded in person / through its verification, or another visit marked onboarded) the visit is recorded as
  `already_onboarded`, never `onboarded`: send `outcome: 'onboarded'` (the server records `already_onboarded`
  and the answer's `outcome` says so) or `outcome: 'already_onboarded'` directly. `already_onboarded` on a
  business that was never onboarded → `400 BUSINESS_NOT_ONBOARDED`. Same checks as `onboarded` (selfie first,
  own business). It never counts in Onboarded and never counts towards the "visits with no onboarding" flag.
  Visit details' `businessAlreadyOnboarded` tells the app which label to show before the tap.
- A completed verification visit is `onboarded`, or `already_onboarded` if the business was onboarded before.
- `onboard_now` on a visit to an already registered business: allowed; the next step is then `mark_onboarded`
  instead of the business form.

### ✅ `GET /field-visits/:id` — CHANGED (visit details page)

Own visit only (`404` otherwise). Everything it returned before, plus:

```json
{
  "id": "5f0c…",
  "purpose": "shop_visit",
  "business": { "id": "7c1e…", "code": "BZ-00012", "name": "Sri Sai Bakery", "verificationStatus": "lead" },
  "shopName": "Sri Sai Bakery",
  "startedAt": "2026-11-15T10:02:00.000Z",
  "endedAt": "2026-11-15T10:20:00.000Z",
  "durationSeconds": 1080,
  "outcome": "interested_later",
  "outcomeReason": null,
  "revisitOn": "2026-11-18",
  "note": "Owner busy, come after 4",
  "outcomeRecordedAt": "2026-11-15T10:20:00.000Z",
  "boardPhoto": { "url": "https://…signed…", "takenAt": "2026-11-15T10:02:00.000Z" },
  "selfie": { "url": "https://…signed…", "takenAt": "2026-11-15T10:19:00.000Z", "distanceMeters": 12 },
  "resultHistory": [
    { "at": "2026-11-15T12:00:00.000Z", "byName": "Ravi K", "byMe": true,
      "from": { "outcome": "owner_not_there", "outcomeReason": null, "revisitOn": "2026-11-16" },
      "to":   { "outcome": "interested_later", "outcomeReason": null, "revisitOn": "2026-11-18" },
      "reason": "Owner called back, wants us on Tuesday" }
  ],
  "nextStep": "done",
  "canChangeResult": true,
  "businessAlreadyOnboarded": false,
  "...": "plus the old fields: assignmentId, revisitOfVisitId, latitude, longitude, accuracyMeters, hasBoardPhoto, hasSelfie, proofDistanceMeters, geofenceFlag, spokeTo, contactPhone (masked), ownerOtpDone"
}
```

- `boardPhoto` / `selfie`: short-lived (5 minutes) signed links, `null` when there is no photo (or it was
  removed by the retention rule). Fetch details again for fresh links.
- `nextStep`: `record_result` (talk not finished) · `take_selfie` ("onboard now" chosen, no selfie) ·
  `continue_business_form` (selfie done, no business: B8 resume — open the business form with this `visitId`) ·
  `mark_onboarded` (selfie done at an already registered business: call `outcome` with `onboarded`) ·
  `verify` (verification visit not completed) · `done` (has a result).
- `canChangeResult`: the visit has a result and it is not `onboarded` / `already_onboarded`.
- `businessAlreadyOnboarded`: the visit's business was onboarded before this visit (so marking it records
  `already_onboarded`); `false` without a business.

### ✅ `POST /field-visits/:id/change-result` — NEW

Body `{ "outcome": "interested_later", "reason": "Owner called back…", "revisitOn": "2026-11-18", "outcomeReason": null, "note": "optional" }`

- `outcome`: `interested_later` · `not_interested` · `owner_not_there` (never `onboarded` / `already_onboarded`).
- `reason`: why it changes, **at least 10 characters**, kept in the history with who and when.
- `revisitOn` required for `interested_later` / `owner_not_there`, today or later (IST).
- `outcomeReason` required for `not_interested` (`hires_family_friends`, `fee_too_high`, `no_staff_needed`, `other_agency`, `other`).
- Answers the visit details (as `GET /field-visits/:id`).

Errors: `404` not my visit · `409 VISIT_HAS_NO_RESULT` (use `outcome` first) · `409 VISIT_ONBOARDED_LOCKED` (also for `already_onboarded`) ·
`400 CHANGE_REASON_REQUIRED` · `400 OUTCOME_INVALID` · `400 REVISIT_DATE_REQUIRED` · `400 REVISIT_DATE_PAST` ·
`400 NOT_INTERESTED_REASON_REQUIRED` · `400 RESULT_UNCHANGED` (same outcome, date and reason as now).

### Map ("Shops near me")

`GET /field-work/map?lat=&lng=&radius=` — **CHANGED:** each `shops[]` row gains `canAct` (business: own
business rule above; unregistered shop: my own visit). `isMine` stays. Tiles: the Field pages now send
`Referrer-Policy: strict-origin-when-cross-origin` (origin only, never the path) so OpenStreetMap tiles load.

---

## 3. Businesses tab

### ✅ `GET /field-work/businesses?q=` — NEW (my businesses)

My businesses (account agent, or my lead with no account agent), newest first, at most 100. `q` (optional)
matches name, BZ- code or area, case-insensitive.

```json
{
  "query": "",
  "results": [
    {
      "id": "7c1e…", "code": "BZ-00012", "name": "Sri Sai Bakery", "locality": "JP Nagar",
      "verificationStatus": "lead", "agreementSigned": false, "openVacancies": 0,
      "nextStep": { "kind": "agreement_waiting", "agreementState": "link_expired" }
    }
  ]
}
```

`nextStep.kind` (first that applies): `suspended` · `paused` · `agreement_waiting` (with `agreementState`:
`link_sent` / `link_expired` / `not_sent`) · `vacancy_to_confirm` (a vacancy waits for the owner's code;
`vacancyId`) · `vacancy_to_send` (a draft to check and send; `vacancyId`) · `candidates_hidden`
(signed but candidates not allowed yet; `reason`: `visit_outside_area` / `not_verified`) ·
`ready_show_candidates` (`vacancyId`) · `waiting_tl_check` · `add_vacancy` (no open vacancy) · `none`.

### ✅ `GET /field-work/businesses/:ref/page` — NEW (the one business page)

`:ref` = id or BZ- code. Any business can be read (view-only when not mine); unknown → `404`.
Replaces `GET /field-work/businesses/:ref` and `GET /screens/field-selling/businesses/:id`
(both **deprecated**, kept working until the app has switched).

```json
{
  "id": "7c1e…", "code": "BZ-00012", "name": "Sri Sai Bakery", "locality": "JP Nagar", "businessType": "bakery",
  "latitude": 12.89, "longitude": 77.58,
  "accountAgent": { "id": "…", "name": "Ravi K", "code": "FA-00003", "isMe": true },
  "isMine": true,
  "canAct": true,
  "status": {
    "verificationStatus": "pending_tl_check", "paused": false, "suspended": false, "suspendedUntil": null,
    "canShowCandidates": true, "candidatesHiddenReason": null
  },
  "nextStep": { "kind": "ready_show_candidates", "vacancyId": "…" },
  "contact": { "name": "Manjunath", "role": "owner", "phoneLast4": "4321", "language": "kn" },
  "checklist": {
    "registered": { "done": true, "at": "2026-11-15T10:25:00.000Z" },
    "ownerPhoneVerified": { "done": true },
    "agreement": {
      "state": "signed", "signedAt": "2026-11-15T10:40:00.000Z", "signedByName": "Manjunath",
      "linkSentAt": "2026-11-15T10:26:00.000Z", "linkExpiresAt": "2026-11-16T10:26:00.000Z", "linkOpenedAt": "2026-11-15T10:30:00.000Z",
      "sentToLast4": "4321", "canResend": false, "resendAvailableAt": null
    },
    "teamLeadCheck": { "state": "waiting", "at": null }
  },
  "vacancies": [
    {
      "id": "…", "code": "VC-00031", "trade": "baker", "roleTitle": null, "headcount": 2,
      "salaryMinPaise": 1500000, "salaryMaxPaise": 1800000, "salaryPeriod": "monthly", "shift": "day",
      "startDate": "2026-11-20", "status": "draft", "confirmedAt": null, "belowLegalMinimum": false,
      "contactName": "Manjunath", "contactPhoneLast4": "4321",
      "nextStep": { "kind": "send_to_owner", "missing": [], "needsMinimumWageTick": false, "legalMinimumPaise": 1234500 }
    }
  ],
  "candidates": {
    "shown": 6, "shownByMe": 4,
    "interviews": { "total": 3, "today": 1, "upcoming": 1 },
    "placements": 1, "inGuarantee": 1,
    "recentInterviews": [ { "id": "…", "code": "IV-00007", "startsAt": "…", "status": "confirmed", "result": null, "candidateName": "Ramesh G." } ]
  },
  "visits": [ { "id": "…", "at": "…", "durationSeconds": 900, "purpose": "shop_visit", "outcome": "onboarded", "staffName": "Ravi K", "mine": true, "hasBoardPhoto": true, "hasSelfie": true } ],
  "actions": { "recordVisit": true, "callOwner": true, "addVacancy": true, "resendAgreement": false, "showCandidates": true }
}
```

- View-only (`canAct: false`): `contact` is `null`, every `actions.*` is `false`, vacancies have
  `nextStep.kind: 'none'`, `checklist.agreement` keeps only `state` / `signedAt`.
- Vacancy `nextStep.kind`:
  - `send_to_owner` (status `draft`): `missing` = fields the draft still needs (`tradeSkill`, `salaryMinPaise`,
    `headcount`, `shift`, `startDate`; fill them with `PATCH /vacancies/:id`), `needsMinimumWageTick` = the
    salary is below the legal minimum, so the agent must tell the owner and send `ownerToldMinimumWage: true`;
    `legalMinimumPaise`. Action: `POST /vacancies/:id/submit-for-confirmation`.
  - `enter_code` (status `awaiting_confirmation`): `linkSentAt`, `linkExpiresAt` (latest confirmation link) and
    `sentToLast4`. Actions: `POST /vacancies/:id/confirmation/send-code` (resend code), `POST /vacancies/:id/confirm`
    `{otpRequestId, code, method:'code_on_visit'}`, `POST /vacancies/:id/confirmation-link` (send link).
  - `show_candidates` (status `open`, business allowed): `shown` = candidates already shown for it.
    Action: `GET /screens/field-selling/vacancies/:id/matches?page=1`.
  - `none`: open vacancy at a business not allowed to see candidates yet (or view-only).
- `status.candidatesHiddenReason`: `suspended` · `paused` · `agreement_not_signed` · `visit_outside_area`
  (signed, but no GPS-clean visit with a selfie: B25) · `not_verified` · `null`.
- `checklist.teamLeadCheck.state`: `done` (verified) · `waiting` (`pending_tl_check`) · `not_yet`.
- `checklist.agreement.state`: `signed` · `link_sent` · `link_expired` · `not_sent`. `canResend` = mine and not
  signed and the rate limit allows it now; `resendAvailableAt` = when it will (else `null`).

### ✅ `GET /field-work/businesses/:ref/agreement` — NEW (agreement screen, poll every ~10 s)

Light read for the screen after the business form (turns green when signed).

```json
{ "businessId": "…", "state": "link_sent", "signedAt": null, "signedByName": null,
  "linkSentAt": "…", "linkExpiresAt": "…", "linkOpenedAt": null, "sentToLast4": "4321",
  "canResend": true, "resendAvailableAt": null, "canShowCandidates": false, "candidatesHiddenReason": "agreement_not_signed" }
```

Mine only (`403 NOT_YOUR_BUSINESS` otherwise). The summary to read aloud is the legal "In short":
`GET /legal/documents/business_agreement?lang=kn|en` (public, reused).

### ✅ `POST /field-work/businesses/:ref/agreement-link` — NEW (Resend agreement link)

Body `{ "language": "kn" | "en" }` (default: the contact's language, else `en`). Sends the owner a new SMS link
(valid 24 hours) to sign on his own phone. Never returns the link token.

```json
{ "success": true, "linkSentAt": "2026-11-16T05:31:00.000Z", "linkExpiresAt": "2026-11-17T05:31:00.000Z", "sentToLast4": "4321" }
```

Errors: `403 NOT_YOUR_BUSINESS` · `404` · `409 AGREEMENT_ALREADY_SIGNED` (current version signed) ·
`429 AGREEMENT_RESEND_TOO_SOON` (`retryAt`; one link per 60 seconds per business) ·
`429 AGREEMENT_RESEND_LIMIT` (`retryAt`; at most 5 links per business in 24 hours) ·
`502 AGREEMENT_SMS_FAILED` (the SMS did not go: nothing was sent, the old link still works; show it, let him retry).

The business form's automatic first link stays `POST /businesses/:id/agreement-links` (same route for the office);
its answer now also carries `smsSent: true|false` so the app no longer has to swallow a failure — if `false`,
show "Resend agreement link".

**Rev 192 S2 — one limit for every route that sends an agreement link.** The one-a-minute and five-in-24-hours
limit is per business and shared: `POST /businesses/:id/agreement-links` (business form, office) and
`POST /field-work/businesses/:ref/agreement-link` (Resend) count against the same links and both answer
`429 AGREEMENT_RESEND_TOO_SOON` / `429 AGREEMENT_RESEND_LIMIT` (`details.retryAt`). A link whose SMS failed is
withdrawn on both routes, so it never uses up the limit (`smsSent: false` on the first route, `502` on Resend).
Links the owner opens himself in the Laboura app send no SMS and are not limited here.

### Vacancies inside the business page (reused; one change)

| step | call |
| --- | --- |
| + Vacancy | `POST /vacancies` `{businessId, …}` (creates `awaiting_confirmation` and sends the code; unchanged) |
| fill a draft's missing fields | `PATCH /vacancies/:id` (allowed fields only; unchanged) |
| **Check and send to owner** (draft) | `POST /vacancies/:id/submit-for-confirmation` `{ownerToldMinimumWage?: boolean}` — works for a field agent on his own business (verified). **CHANGED:** errors now carry codes. |
| owner's code | `POST /vacancies/:id/confirmation/send-code` `{otpRequestId?}` (resend) → `{otpRequestId, sentToLast4, contactName, resendAvailableAt, resendsLeft}`; `POST /vacancies/:id/confirm` `{otpRequestId, code, method:'code_on_visit'}` |
| link instead | `POST /vacancies/:id/confirmation-link` → `{success, expiresAt, sentToLast4}`. **Rev 192 S3:** the SMS now opens the owner's phone page (below). |

**Owner's page to confirm by link (rev 192 S3).** The SMS link is `https://app.laboura.com/p/vacancy-confirm/<token>`
(web app page P07-VacancyConfirm, built like the agreement page P04: no login, the token in the link is the key,
Kannada / Hindi / English starting in the language the link was sent in). It shows the job (role / trade), how many
people, the salary range, shift, start date and the business name, then "Send code" → the code the owner gets on the
number the link went to → **Confirm vacancy** → "Confirmed, thank you". A used, expired or replaced link, or a
vacancy already confirmed (by code on the visit), shows its own message. Links sent before (`/vacancy-confirm/<token>`)
open the same page in a browser. The page calls the public API (no staff login):
`GET /vacancy-confirm/:token` → `{vacancyCode, status, maskedPhone, sentToLast4, expiresAt, preferredLanguage, business,
trade, roleTitle, headcountCount, salaryMinPaise, salaryMaxPaise, salaryPeriod, shift, startDate, …}` (never a full phone
number); `POST /vacancy-confirm/:token/send-otp` → `{requestId, phone (masked), …}` — limited per link and per phone
like every public page (one code per 30 seconds, 4 per link a day: `429` with `details.retryAfterSeconds`);
`POST /vacancy-confirm/:token` `{otpRequestId, code}` → `{vacancyCode, status: 'open', confirmedAt, confirmationMethod:
'sms_link', confirmedByName}` (no business record, no staff ids). The link works 48 hours and once. The field app learns
of the confirmation by reading the vacancy again (it becomes `open`).

`POST /vacancies/:id/submit-for-confirmation` answer: the vacancy (`id`, `code`, `status: 'awaiting_confirmation'`,
trade/salary fields, `belowLegalMinimum`, …) plus
`confirmation`: `{otpRequestId, sentToLast4, contactName, resendAvailableAt, resendsLeft}` when the code went,
or `{error: "…"}` when it did not (the vacancy is still moved on; resend with `confirmation/send-code`).
Errors: `400 NOT_A_DRAFT` (`status`) · `400 DRAFT_INCOMPLETE` (`missing: [...]`) ·
`400 MINIMUM_WAGE_TICK_REQUIRED` (`legalMinimumPaise`, `monthlySalaryFromPaise`, `level`) ·
`400 DRAFT_CHANGED` (edited meanwhile: reload) · `403` (not my business).

### Candidates and interviews (reused, unchanged)

`GET /screens/field-selling/vacancies/:id/matches?page=`, `GET /screens/field-selling/candidates/:id?vacancyId=`,
`POST /vacancies/:id/introductions/in-person`, `POST /field-selling/calls`, `GET /calls/:id`,
`POST /field-selling/calls/:id/answer`, `POST /field-selling/interviews/:id/hand-over`,
`POST /field-selling/interviews/:id/owner-otp`, `POST /field-selling/interviews/:id/decision`,
`POST /field-selling/interviews/:id/meet`, `GET /screens/field-selling/vacancies/:id/booking?jobSeekerId=`,
`POST /field-selling/interviews`, `GET /screens/field-selling/interviews/:id`,
`POST /field-selling/interviews/:id/arrival`, `GET /screens/field-selling/placements/:id`,
`POST /field-selling/placements/:id/owner-says`, Call owner: `POST /field-selling/owner-calls/:id/outcome`.

---

## 4. Job seekers tab

### ✅ `GET /field-work/job-seekers?q=` — NEW (my job seekers)

Job seekers this agent registered, newest first, at most 100. `q` matches name, JS- code, or the last 4 digits
of the phone (exactly 4 digits).

```json
{
  "query": "",
  "results": [
    {
      "id": "…", "code": "JS-00042", "name": "Lakshmi R", "phoneLast4": "9876", "status": "active",
      "registeredAt": "2026-11-14T06:00:00.000Z",
      "stage": "paid",
      "steps": {
        "linkSentAt": "2026-11-14T06:02:00.000Z",
        "consentGivenAt": "2026-11-14T06:10:00.000Z",
        "paidAt": "2026-11-14T06:20:00.000Z",
        "idCheckedAt": null,
        "idCheckPending": true,
        "interviews": 0,
        "placed": false
      }
    }
  ]
}
```

`stage` = the furthest step reached, in the guide's order: `registered` → `link_sent` → `consent_given` →
`paid` → `id_checked` → `interviewing` → `placed`; `inactive` for a deactivated / closed job seeker.

Reused: `+ Job seeker` = `POST /otp/send {purpose:'job_seeker'}`, `POST /otp/verify`, `POST /job-seekers`,
`PATCH /job-seekers/:id/profile`; progress page `GET /screens/call-registration/job-seekers/:id`, `POST /consent/links`,
`POST /job-seekers/:id/payment-only-link`, `POST /field-work/job-seekers/:id/aadhaar-qr`, other ID capture.

---

## 5. Referral partners (new screen in the app; server unchanged)

`POST /otp/send {purpose:'referral', phone}` → `POST /otp/verify` → `POST /referrals` (field agents allowed):
`{name, phone, otpRequestId, type:'individual'|'business', whatsappPhone, language:'kn'|'hi'|'en', locality,
pincode, heardFrom, individualRole? | (businessId? | partnerBusinessType + partnerBusinessName), latitude?, longitude?}`
(see `docs/api/phase-20.md` "POST /referrals"). Resend the registration link: `POST /referrals/:id/terms-links`.
Options for the form: `GET /screens/call-registration/options`.

---

## 6. Me tab (reused, unchanged)

`GET /targets/dashboard`, `GET /field-work/targets`, `GET /targets/leaderboard`, `GET /attendance/month`,
leave / correction / payslip endpoints as today (FA04e–h), `POST /auth/logout`.

---

## 7. Errors added by the redesign (codes)

| code | status | where |
| --- | --- | --- |
| `NOT_YOUR_BUSINESS` | 403 | writes on another agent's business; visit start with `businessId` |
| `NOT_YOUR_VISIT` | 403 | visit start with `revisitOfVisitId` of another agent's visit |
| `VISIT_RESULT_ALREADY_SET` | 409 | `POST /field-visits/:id/outcome` on a visit with a result |
| `VISIT_HAS_NO_RESULT` | 409 | `change-result` before any result |
| `VISIT_ONBOARDED_LOCKED` | 409 | `change-result` on an onboarded visit |
| `SELFIE_REQUIRED` | 400 | `outcome: onboarded` without the selfie |
| `BUSINESS_NOT_REGISTERED` | 400 | `outcome: onboarded` / `already_onboarded` on a visit with no business |
| `BUSINESS_NOT_ONBOARDED` | 400 | `outcome: already_onboarded` on a business that was never onboarded (rev 189) |
| `CHANGE_REASON_REQUIRED`, `OUTCOME_INVALID`, `REVISIT_DATE_REQUIRED`, `REVISIT_DATE_PAST`, `NOT_INTERESTED_REASON_REQUIRED`, `RESULT_UNCHANGED` | 400 | `change-result` |
| `DATE_INVALID`, `DATE_IN_FUTURE`, `DATE_TOO_OLD` | 400 | `GET /field-work/day` |
| `AGREEMENT_ALREADY_SIGNED` | 409 | agreement resend |
| `AGREEMENT_RESEND_TOO_SOON`, `AGREEMENT_RESEND_LIMIT` | 429 | agreement resend and `POST /businesses/:id/agreement-links` (shared limit, rev 192 S2; `details.retryAt`) |
| `AGREEMENT_SMS_FAILED` | 502 | agreement resend (`message` is "Internal server error"; read `details.code`) |
| `NOT_A_DRAFT`, `DRAFT_INCOMPLETE`, `MINIMUM_WAGE_TICK_REQUIRED`, `DRAFT_CHANGED` | 400 | submit draft vacancy |

---

## 8. Settings the scripts quote (no fixed numbers in the app)

`GET /screens/field-selling/settings` — **CHANGED**, gained `noBypassMonths`, `noBypassPenaltyPercent`,
`jobSeekerGuaranteeDays`:

```json
{ "feePercent": 50, "gstPercent": 18, "maxFreeReplacements": 2, "replacementWindowDays": 60,
  "noBypassMonths": 12, "noBypassPenaltyPercent": 50, "jobSeekerGuaranteeDays": 30,
  "walkInStart": "10:30", "walkInEnd": "18:00", "callingHoursStart": "09:00", "callingHoursEnd": "21:00",
  "interviewResultDeadline": "20:00", "placementPaymentDueHours": 24, "threeWayCalls": false, "notSelectedReasons": ["…"] }
```

The same numbers are also in `GET /screens/call-registration/options` → `scriptTerms` (already used by the
business form). Use either; never hard-code them (B22).

---

## 9. Fixes after the end-to-end check (Master Guide rev 192)

| fix | what changed on the server | where above |
| --- | --- | --- |
| S1 | Completing a verification visit of a business with no account agent makes the verifying field agent its account agent (audit `business.account_agent_assigned`); the business is then in My businesses and Needs you now and its agreement step works for him (no more `403 NOT_YOUR_BUSINESS`). Never takes a business from an existing account agent. `POST /field-visits/:id/verify` answer gains `isAccountAgent`, `becameAccountAgent`. | §2 visit flow, rules |
| S2 | The agreement-link limit (1 a minute, 5 in 24 hours per business) is one shared counter on every route that sends a link by SMS, including `POST /businesses/:id/agreement-links`. | §3 agreement |
| S3 | Owner's page to confirm a vacancy by link: `/p/vacancy-confirm/:token` (web app), using the public confirm API; "Send code" there is now rate-limited like the other public pages; the confirm answer no longer returns the business record. | §3 vacancies |
| S4 | `GET /field-work/visits` `planned[]` drops interviews whose attendance is recorded. Server-only; no app change needed. | §2 Visits main page |
| S5 | This file: pickable statuses, the real error shape (`details.code`), S1–S4. A coded `5xx` error (`502 AGREEMENT_SMS_FAILED`) now keeps its `details.code` (before, the filter dropped it). | rules, §1, §7 |

