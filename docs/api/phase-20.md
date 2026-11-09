# Phase 20 API

All routes require a staff bearer token unless marked otherwise. Responses below show representative payloads; paise amounts are integers.

## Task 2 — Managed trades and minimum wages

### `GET /trades`

Any authenticated staff member may read active trades.

**Request:** no body.

**Response `200`:**

```json
[
  {
    "id": "trade-id",
    "name": "Housekeeping",
    "salaryMinPaise": 1600000,
    "salaryMaxPaise": 2300000,
    "minimumWageLevel": "unskilled",
    "legalMinimumPaise": 2337600,
    "effectiveFrom": "2026-05-22T00:00:00.000Z"
  }
]
```

**Errors:** `401` missing/invalid login.

### `GET /trades/manage`

CEO and Manager may read all active and inactive trades.

**Request example:** `GET /trades/manage` with no body. **Response `200` example:**

```json
[{ "id": "trade-id", "name": "Housekeeping", "salaryMinPaise": 1600000, "salaryMaxPaise": 2300000, "minimumWageLevel": "unskilled", "active": true, "sortOrder": 1 }]
```

**Errors:** `401` unauthenticated; `403` other roles.

### `GET /trades/suggestions`

CEO and Manager may list waiting suggestions.

**Request example:** `GET /trades/suggestions` with no body. **Response `200` example:**

```json
[{ "id": "suggestion-id", "typedName": "Special Cook", "typedByStaffId": "staff-id", "subjectType": "job_seeker", "subjectId": "seeker-id", "status": "waiting", "mappedToTradeId": null, "decidedByStaffId": null, "decidedAt": null, "subjects": [{ "subjectType": "job_seeker", "subjectId": "seeker-id" }], "mappedToTrade": null }]
```

**Errors:** `401` unauthenticated; `403` other roles.

### `GET /trades/unlisted-report`

CEO and Manager may read distinct existing job seeker/vacancy trade strings that do not match an active listed trade.

**Request example:** `GET /trades/unlisted-report` with no body. **Response `200` example:**

```json
[{ "tradeName": "Special Cook", "jobSeekerCount": 2, "vacancyCount": 1 }]
```

**Errors:** `401` unauthenticated; `403` other roles.

### `POST /trades`

CEO and Manager may create a trade.

**Request:**

```json
{
  "name": "Special Cook",
  "salaryMinPaise": 1800000,
  "salaryMaxPaise": 3000000,
  "minimumWageLevel": "unskilled",
  "sortOrder": 17
}
```

`minimumWageLevel` and `sortOrder` are optional; the defaults are `unskilled` and `0`.

**Response `201`:** the created trade record.

**Errors:** `400` invalid name, salary range, level or order; `401` unauthenticated; `403` other roles; `409` duplicate case-insensitive name.

### `PATCH /trades/:id`

CEO and Manager may edit a trade. Any subset of the `POST /trades` fields and optional `active` may be supplied. Renaming also updates existing job seeker and vacancy trade strings in the same transaction.

**Request example:** `{"salaryMaxPaise": 3100000}`. **Response `200` example:**

```json
{ "id": "trade-id", "name": "Housekeeping", "salaryMinPaise": 1600000, "salaryMaxPaise": 3100000, "minimumWageLevel": "unskilled", "active": true, "sortOrder": 1 }
```

**Errors:** `400` invalid fields; `401` unauthenticated; `403` other roles; `404` missing trade; `409` duplicate name.

### `PATCH /trades/:id/deactivate`

CEO and Manager may deactivate a trade. **Request example:** `PATCH /trades/trade-id/deactivate` with no body. **Response `200` example:** `{"id":"trade-id","name":"Housekeeping","active":false}`.

**Errors:** `401` unauthenticated; `403` other roles; `404` missing trade.

### `POST /trades/suggestions/:id/add`

CEO and Manager may turn a waiting suggestion into a new trade.

**Request:** salary range and optional level/order, same as `POST /trades` without `name`.

**Response `201` example:** `{"id":"trade-id","name":"Special Cook","salaryMinPaise":1800000,"salaryMaxPaise":3000000,"minimumWageLevel":"unskilled","active":true,"sortOrder":0}`. The suggestion changes to `added`.

**Errors:** `400` invalid fields or suggestion is not waiting; `401` unauthenticated; `403` other roles; `404` missing suggestion; `409` duplicate name.

### `POST /trades/suggestions/:id/map`

CEO and Manager may map a waiting suggestion to an active existing trade. All job seeker trade rows and vacancies using its typed name are rewritten in one database transaction.

**Request:** `{"tradeId":"trade-id"}`.

**Response `201`:**

```json
{
  "suggestion": { "id": "suggestion-id", "status": "mapped" },
  "seekerTradesRewritten": 2,
  "vacanciesRewritten": 1
}
```

**Errors:** `400` suggestion is not waiting; `401` unauthenticated; `403` other roles; `404` missing suggestion or active trade.

### `POST /trades/suggestions/:id/dismiss`

CEO and Manager may dismiss a waiting suggestion. **Request example:** `POST /trades/suggestions/suggestion-id/dismiss` with no body. **Response `201` example:** `{"id":"suggestion-id","typedName":"Special Cook","status":"dismissed","decidedByStaffId":"staff-id"}`.

**Errors:** `400` suggestion is not waiting; `401` unauthenticated; `403` other roles; `404` missing suggestion.

### `PUT /pricing/legal-minimum-wages`

Only the CEO may create a new legal-minimum-wage policy version. Amounts are monthly basic wages in paise.

**Request:**

```json
{
  "unskilledPaise": 2337600,
  "semiSkilledPaise": 2571400,
  "skilledPaise": 2828600,
  "highlySkilledPaise": 3111400,
  "effectiveFrom": "2026-05-22"
}
```

**Response `200` example:** `{"legalMinimumWageUnskilledPaise":2337600,"legalMinimumWageSemiSkilledPaise":2571400,"legalMinimumWageSkilledPaise":2828600,"legalMinimumWageHighlySkilledPaise":3111400,"legalMinimumWageEffectiveFrom":"2026-05-22T00:00:00.000Z"}`. **Errors:** `400` non-positive/non-integer amount or invalid date; `401` unauthenticated; `403` any role except CEO.

## Task 2 capture behavior

Job seeker creation, additional job seeker trades, vacancy creation and trade edits retain a typed trade immediately. If it is not an active listed trade, a waiting suggestion is added or the existing normalized suggestion gains that subject. Matching returns no candidates for a vacancy whose trade is not active and listed.
