# Phase 20 API

All routes require a staff bearer token unless marked otherwise. Responses below show representative payloads; paise amounts are integers.

## Task 5 — ID provider recovery

### `POST /consent/id-check-wait`

Public registration link holder. The OTP must have been sent to and verified for the job seeker's own registered number.

**Request:** `{"token":"registration-link-token","requestId":"otp-request-id","code":"123456"}`.

**Response `201`:** `{"success":true,"waitingForRecovery":true}`.

**Errors:** `400` invalid/expired link, wrong or unverified registered-number OTP, or ID service is not down.

### `POST /jobs/kyc-recovery/run`

CEO only; manually queues the worker's recovery probe. **Request:** no body. **Response `201`:** `{"jobId":"bullmq-job-id"}`.

**Errors:** `401` unauthenticated; `403` caller is not CEO.

`GET /system/status` and `GET /status` now include `idCheck: {"status":"up","lastChangedAt":"2026-11-10T12:00:00.000Z"}`. A down ID provider also appears as a degraded component.

### `GET /job-seekers/:id/registration-status`

Call agents, field agents, Team Leads, Managers and the CEO may read the registration progress panel for a job seeker.

**Response `200` example:**

```json
{"jobSeekerId":"job-seeker-id","steps":{"phone":{"state":"done","time":"2026-11-10T10:00:00.000Z","reason":null},"consent":{"state":"in_progress","time":"2026-11-10T10:05:00.000Z","reason":null},"selfie":{"state":"not_started","time":null,"reason":null},"idCheck":{"state":"stuck","time":null,"reason":"ID check service is temporarily unavailable"},"payment":{"state":"not_started","time":null,"reason":null}},"registrationLinkExpiresAt":"2026-11-12T10:00:00.000Z","paymentOnlyLink":{"live":false,"expiresAt":null}}
```

**Errors:** `401` unauthenticated; `403` role is not allowed; `404` job seeker not found.

### `POST /job-seekers/:id/identity-verification/provider`

Call agents, field agents, Team Leads, Managers and the CEO may request provider verification after the candidate's identity-check consent is active. Provider-specific fields may be sent in the request, but raw Aadhaar numbers are always refused. The candidate name and date of birth are taken from the stored profile.

**Request example:** `{"method":"digilocker","transactionId":"provider-transaction-id","otp":"123456"}`.

**Response `201` example:** `{"jobSeekerId":"job-seeker-id","method":"digilocker","vendor":"configured_kyc_provider","status":"verified","last4":"4242","nameMatches":true,"isAdult":true}`.

Provider/network errors persist the ID service as down. Personal verification results such as name mismatch and under-18 persist as the person's result without changing provider health.

**Errors:** `400` missing consent, invalid method or raw Aadhaar input; `401` unauthenticated; `403` role is not allowed; `404` job seeker not found.

### `POST /registration/:token/selfie`

Public registration-link endpoint. The link's own registered number must have a verified OTP. Multipart form fields: `photo` (camera capture), `captureSource=live_camera`, and `requestId`. A gallery-marked upload is refused.

**Response `201` example:** `{"jobSeekerId":"job-seeker-id","photoTakenAt":"2026-11-10T12:00:00.000Z","expiresInSeconds":300}`.

**Errors:** `400` invalid link, missing registered-number OTP, gallery upload, or missing photo; `413` photo exceeds 5 MiB.

### `POST /registration/:token/id-check`

Public registration-link endpoint. Requires a verified OTP for the link's registered number and active identity-check consent. The request contains the provider's non-sensitive verification parameters and `requestId`; raw Aadhaar data is refused.

**Request example:** `{"requestId":"otp-request-id","method":"digilocker","transactionId":"provider-transaction-id","otp":"123456"}`. **Response `201`:** the persisted verification result.

**Errors:** `400` invalid link, missing OTP or consent, invalid method, or raw Aadhaar; provider/network failures are recorded as failed verification and mark the ID service down.

### `POST /job-seekers/:id/payment-only-link`

Call agents, field agents, Team Leads, Managers and the CEO may send a payment-only link to another number once an activation payment is pending. The number is encrypted in the public-link store and is not included in the response or audit log. A new link revokes the prior active link and expires after 15 minutes.

**Request:** `{"phone":"9876543210"}`. **Response `201`:** `{"success":true,"expiresAt":"2026-11-10T12:15:00.000Z"}`.

**Errors:** `400` no pending activation payment or the alternate number is invalid/same as the registered number; `401` unauthenticated; `403` role is not allowed; `404` job seeker not found.

The job seeker may also request the same link from `POST /registration/:token/payment-only-link` with `{"requestId":"otp-request-id","phone":"9876543210"}` after verifying OTP on the registered number. The response and expiry are identical.

### `POST /registration/payment/:token/send-otp` and `GET /registration/payment/:token`

The public payment-only link sends OTP to its encrypted alternate number. The GET requires the verified `requestId` query parameter and returns only the job seeker's first name, JS code, exact payment and UPI details.

**POST response `201`:** `{"success":true,"requestId":"otp-request-id","phone":"******3210"}`. **GET example:** `/registration/payment/token?requestId=otp-request-id`.

**Errors:** `400` expired/revoked link, OTP not verified, or payment no longer pending; `404` unknown link/payment.

### `GET /registration/:token/terms`

Public. The registration link's holder, after an OTP verified for the job seeker's own registered number (`requestId` query parameter). Returns the exact terms he is asked to tick: primary trade, travel distance, shift, guarantee floor, guarantee days and the ₹499 amount.

**Response `200` example:**

```json
{"jobSeekerCode":"JS-01042","trade":"Housekeeping","travelDistanceKm":10,"shiftPreference":"day","guaranteeFloorPaise":1800000,"guaranteeDays":30,"amountPaise":49900,"termsAcceptedAt":null}
```

**Errors:** `400` invalid link, OTP not verified for the registered number, consent not finished (`Consent comes first`), selfie not taken (`Take the selfie first`), ID check not verified (`Finish the ID check first`), the ID check shows under 18, or the primary trade is still an unlisted Other (`Waiting for the new trade to be added in the Command Center`). No payment is created.

### `POST /registration/:token/terms-and-payment`

Public. Same OTP rule. Body `{"requestId":"otp-request-id","acceptTerms":true}`. He must tick `acceptTerms: true`. The server stores `termsAcceptedAt` and `termsAcceptedFloorPaise` (the floor he was shown) and creates the ₹499 activation payment, or returns the open one. The same under-18 stop runs before any payment row is created.

**Response `201` example:**

```json
{"terms":{"jobSeekerCode":"JS-01042","trade":"Housekeeping","travelDistanceKm":10,"shiftPreference":"day","guaranteeFloorPaise":1800000,"guaranteeDays":30,"amountPaise":49900,"termsAcceptedAt":"2026-11-10T12:00:00.000Z"},"payment":{"paymentId":"payment-id","paymentCode":"PAY-00042","amountPaise":49900,"status":"pending","upiReference":"PAY-00042-abcd1234"}}
```

**Errors:** `400` the tick is missing (`Tick to agree to the terms before paying`), or any error from `GET /registration/:token/terms`.

### `POST /payments/bank-feed/webhook` — a second activation credit

No login. Signed with `x-bank-signature` over the raw body, as before. When the remark matches an activation payment that has already succeeded, for the same job seeker and the same amount, the credit is not recorded as a second activation. The response is `200`:

```json
{"received":true,"status":"duplicate_refund_created","reason":"duplicate_activation_payment","paymentId":"original-payment-id","refundPaymentId":"refund-payment-id","bankCreditId":"bank-credit-id"}
```

That creates a `duplicate_refund` payment for the same paise, already `approved` (`approvedAt` set), attributed to the job seeker. Finance sends it from the company account. The same bank UTR again is still an idempotent skip (`alreadyProcessed: true`).

## Task 3 — Phone check by OTP

### `POST /otp/send`

Any authenticated staff member may request an OTP. Supported purposes are `job_seeker`, `business_contact`, `referral`, `vacancy_confirm` and `branch_contact`. For job seeker, business contact and referral flows, the service checks all existing job seeker, business main/additional contact and referral phone numbers first. A duplicate does not send an OTP. A branch contact is included once the Phase 20 branch model is installed (Task 7). `vacancy_confirm` skips duplicate lookup.

**Initial request:**

```json
{"phone":"9876543210","purpose":"job_seeker"}
```

**Response `201` example:**

```json
{"success":true,"requestId":"otp-request-id","resendAvailableAt":"2026-11-09T12:00:30.000Z","resendsLeft":3}
```

**Duplicate response `201` examples:** a staff member allowed to see the record receives `{"alreadyRegistered":true,"type":"job_seeker","code":"JS-01042"}`; a staff member outside that record's access scope receives `{"alreadyRegistered":true}`.

**Resend request:** include the original `requestId` with the same `phone` and `purpose`. The original request ID is reused. A resend is refused before 30 seconds or after three resends.

**Errors:** `400` missing/invalid fields, wrong phone or purpose for the request, request expired/used/locked, resend too soon, or resend limit reached; `401` unauthenticated; `429` throttled.

### `POST /otp/verify`

Any authenticated staff member may submit a code returned by MSG91/mock mode.

**Request:** `{"requestId":"otp-request-id","code":"123456"}`. **Response `200`:** `{"verified":true,"requestId":"otp-request-id"}`.

Wrong codes count as attempts. The request is locked after five wrong codes. Sends and verification attempts are audited with only the phone's last four digits; the OTP itself is never audited.

**Errors:** `400` wrong code, expired/used/locked request, or missing fields; `401` unauthenticated; `429` throttled.

## Task 4 — One job seeker registration form

### `POST /job-seekers`

Call agents, field agents, Team Leads, Managers and the CEO can create a lead with this single endpoint. The mobile number must have a verified, unused Task 3 OTP request. The request requires the candidate's full profile fields; drafts stay on the caller's device.

**Request:**

```json
{
  "name": "Asha Rao",
  "phone": "9876543210",
  "otpRequestId": "otp-request-id",
  "messageLanguage": "kn",
  "bestTimeToCall": "09-12",
  "dateOfBirth": "1990-01-02",
  "gender": "female",
  "heardFrom": "walk_in",
  "locality": "Indiranagar",
  "pincode": "560038",
  "latitude": 12.9784,
  "longitude": 77.6408,
  "travelDistanceKm": 10,
  "trades": [
    { "trade": "Housekeeping", "yearsExperience": 3 },
    { "trade": "Cook", "yearsExperience": 1 }
  ],
  "availableFrom": "2026-11-10",
  "lookingSince": "2026-11-01",
  "minSalary": 2500000,
  "maxSalary": 3000000,
  "salaryPeriod": "monthly",
  "shiftPreference": "day",
  "jobType": "full_time",
  "spokenLanguages": ["Kannada", "Hindi"]
}
```

`bestTimeToCall` accepts `09-12`, `12-15`, `15-18`, `18-21` or `09-21`; it is stored as the selected start and end times. `trades` contains one to three distinct trade names, with the first as primary. Unlisted names save immediately and create a trade suggestion. Spoken-language rows set `speaks: true` and keep `reads` and `writes` false.

Salary values are integer paise in the selected period. The guarantee floor is the lower of the monthly candidate minimum and the primary managed trade's monthly maximum. For an unlisted primary trade without a managed range, `guaranteeFloorPaise` is `null` and the registration can proceed through consent, selfie and ID, but terms and payment remain blocked. The status panel reports Payment as stuck with `Waiting for the new trade to be added in the Command Center`. A CEO or Manager adding or mapping the trade calculates the floor and unblocks payment. The first successful activation payment freezes the floor. A daily minimum is converted with `salaryDaysPerMonth`.

**Response `201` example when the candidate minimum exceeds the primary trade range:**

```json
{
  "code": "JS-01042",
  "status": "lead",
  "guaranteeFloorPaise": 2300000,
  "warnings": ["salary_above_market"],
  "salaryRange": { "minSalaryPaise": 1600000, "maxSalaryPaise": 2300000 }
}
```

Otherwise `warnings` is an empty array; `salaryRange` is present when the primary trade has a managed range. A referral partner ID is optional when `heardFrom` is `referral_partner`; the referred candidate's mobile must differ from the partner's.

**Errors:** `400` missing or invalid required fields, underage candidate, invalid referral, or unverified/used OTP; `401` unauthenticated; `403` role is not allowed; `409` duplicate job seeker mobile.

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

## Task 6 referral partner registration

`POST /referrals` is for call agents, field agents, Team Leads, Managers, and the CEO. It requires a name, OTP-verified `phone`, `whatsappPhone`, `language` (`kn`, `hi`, `en`), `locality`, six-digit `pincode`, and `heardFrom` from the Task 4 closed list. Individual partners also require `individualRole`; business partners must link `businessId` or provide `partnerBusinessType` and `partnerBusinessName`. `latitude` and `longitude` are optional and must be sent together. The request rejects payout account details. A successful create sends the referral ID and a 48-hour registration link by SMS.

```json
{
  "name": "Asha Rao",
  "phone": "+919876543210",
  "whatsappPhone": "+919876543210",
  "language": "kn",
  "type": "individual",
  "individualRole": "shop_staff",
  "locality": "Indiranagar",
  "pincode": "560038",
  "heardFrom": "field_visit",
  "otpRequestId": "verified-otp-request-id"
}
```

## Task 7 business form and branches

`POST /businesses` is for field agents, call agents, Team Leads, Managers, and the CEO. The OTP-verified `phone` is the primary contact mobile. A new registration requires `contactPersonName` and `contactPersonRole` (`owner`, `manager`, `hr`, `supervisor`, `other`). `contactWhatsAppPhone` and `contactLanguage` (`kn`, `hi`, `en`) are optional. `heardFrom` uses the Task 4 closed list when it is sent. `employeeCountBand` is `1-5`, `6-20`, `21-50`, `51-200` or `200+` when it is sent. `yearsInOperationBand` is optional text: the registration form calls years running a band, and the allowed bands are not listed in the phase spec, so the API stores the supplied band. `openingTime` and `closingTime` are `HH:MM` when sent. `pincode` is six digits when sent. `billingEmail` is checked as an email address when sent.

Business type accepts the managed values, including the earlier `restaurant`, `retail`, `factory`, `office`, `warehouse`, `household` and `other` values plus `restaurant_hotel`, `bakery`, `retail_shop`, `supermarket`, `apartment_society`, `hospital_clinic`, `construction`, `security_agency` and `salon`. Household businesses require `familyName`, store no legal name, and must omit GST, FSSAI, PAN and licence fields. Optional documents are `gstNumber` (checked online as today), `fssaiNumber`, `shopEstablishmentNumber`, `udyamNumber`, `licenceNumber` and `pan`. `noDocuments: true` stores `documentsStatus: "no_documents"` and refuses any of those numbers. That status is what raises the existing Team Lead extra-care check when the business later reaches verification. A business with no document numbers is also `no_documents`.

Each `branches` entry requires a unique name, contact name, role and an independently OTP-verified `contactPersonPhone` with its own `otpRequestId`. The branch mobile must differ from the main contact and from other branches in the same request. Each `staffNeededRows` entry creates an incomplete vacancy with status `draft`. It requires trade, headcount, integer-paise salary bounds, shift and `startDate` (`YYYY-MM-DD`). `salaryPeriod` is `monthly` when omitted, or `daily`. `branchName` may name a branch in the same request; that draft then belongs to the branch. A listed trade does not create a trade suggestion. An unlisted trade saves immediately and creates one waiting suggestion. Interview result messages and placement payment links for a branch vacancy go to that branch contact. Signing the existing agreement records `signedRole` from the business contact role (`owner` when an older business has none).

`GET /businesses` and `GET /businesses/:id` include `branches`. When a stored contact name, phone or role is empty, the response fills `contactPersonName`, `contactPersonPhone`, `contactPersonRole`, `additionalContactName` and `additionalContactPhone` from the owner name and business phone, with role `owner`. That is how a business saved before this form still loads. The migration also copies those owner fields onto existing rows.

```json
{
  "name": "Indiranagar Cafe",
  "phone": "+919876543210",
  "otpRequestId": "verified-primary-otp",
  "contactPersonName": "Asha Rao",
  "contactPersonRole": "owner",
  "contactWhatsAppPhone": "+919876543210",
  "contactLanguage": "kn",
  "businessType": "restaurant_hotel",
  "locality": "Indiranagar",
  "pincode": "560038",
  "branches": [{
    "name": "Whitefield outlet",
    "locality": "Whitefield",
    "contactPersonName": "Ravi Rao",
    "contactPersonRole": "manager",
    "contactPersonPhone": "+919876543211",
    "otpRequestId": "verified-branch-otp"
  }],
  "staffNeededRows": [{
    "trade": "Cook",
    "headcount": 2,
    "salaryMinPaise": 1800000,
    "salaryMaxPaise": 2500000,
    "shift": "day",
    "startDate": "2026-12-01"
  }]
}
```

The response includes the created business with branches and `staffNeededRows` vacancies are returned in the `vacancies` relation. The endpoint returns `400` for missing contact identity/role, failed or consumed OTPs, invalid staff-needed rows, or household document fields; `409` for a duplicate business mobile; `401` for an unauthenticated caller; `403` for a role without business-write access. Interview result links and owner-result messages for a branch vacancy target that branch contact.

`POST /referrals/:id/terms-links` resends the registration link and revokes any earlier active link. `GET /referral-registration/:token/status?requestId=...` returns registration progress only after OTP verification to the partner's registered number. `POST /consent/submit` records referral terms and call-recording consent. The same token then accepts live-camera `POST /referral-registration/:token/selfie`, provider-backed `POST /referral-registration/:token/id-check`, and partner-only `POST /referral-registration/:token/upi`; the UPI step requires a successful identity check and OTP. Completing UPI consumes the registration link.

The staff registration status endpoint is `GET /referrals/:id/registration-status`. It returns terms, selfie, ID, and UPI state with timestamps and any safe reason. UPI identity review continues through the existing payout account and payout release flow.

`yearsInOperationBand` accepts only `under_1`, `1_3`, `3_10` or `10_plus`, and `hiringFrequency` only `rarely`, `every_few_months`, `every_month` or `every_week` (the lists on the approved business form). Any other value returns `400` naming the field. Values stored before this rule still load unchanged.

## Task 8 — Every vacancy confirmed by OTP, and the minimum-wage warning

A vacancy now moves through `draft` (an incomplete staff-needed row) → `awaiting_confirmation` (complete, waiting for the business's or branch's contact person) → `open`. Matching (`GET /vacancies/:id/shortlist`, `GET /vacancies/:id/candidates`), candidate introductions and interview booking return `400` for a `draft` or `awaiting_confirmation` vacancy. Vacancies that were already `open` stay `open`. "Vacancies captured" counts a vacancy only once it has been confirmed.

The contact person is the branch contact when the vacancy has a `branchId`, otherwise the business's main contact.

### `POST /businesses/:id/vacancies` and `POST /vacancies` (changed)

Who: field agents (their account businesses), call agents (any business), Team Leads, Managers, CEO. New optional fields: `branchId` (must be a branch of the business, else `400`) and `ownerToldMinimumWage`. The vacancy is created as `awaiting_confirmation`. The contact person receives a confirmation code and a details SMS (`vacancy_confirm_details`: trade, how many, salary, shift, start date). The response adds:

```json
{
  "status": "awaiting_confirmation",
  "belowLegalMinimum": false,
  "legalMinimumPaise": 2337600,
  "confirmation": { "otpRequestId": "otp_…", "sentToLast4": "3310", "contactName": "Ganesh", "resendAvailableAt": "2026-11-10T10:00:30.000Z", "resendsLeft": 3 }
}
```

If the code can't be sent, the vacancy is still saved and `confirmation` is `{ "error": "…" }`; send it again with the endpoint below.

**Legal minimum wage:** if the monthly salary *from* (`salaryMinPaise`, or × `salaryDaysPerMonth` for `salaryPeriod: "daily"`) is below the legal minimum for the trade's level (unlisted trades use the unskilled figure), the request needs `ownerToldMinimumWage: true`. Without it the response is `400` with `{ "message": "…", "legalMinimumPaise": 2337600, "monthlySalaryFromPaise": 2000000, "level": "unskilled" }`. With it the vacancy is saved with `belowLegalMinimum: true`.

### `POST /vacancies/:id/submit-for-confirmation`

Who: field agents (own account businesses or drafts they captured), call agents, Team Leads, Managers, CEO. Completes a `draft`: checks trade, salary from, headcount, shift and start date (`400` listing what is missing) and the legal minimum (same rule, body `{ "ownerToldMinimumWage": true }`). It then moves the draft to `awaiting_confirmation` and sends the code. The response has the same shape as create. Returns `400` if the vacancy is not a draft.

### `POST /vacancies/:id/confirmation/send-code`

Body `{ "otpRequestId"?: string }`. Without `otpRequestId` it sends a fresh code (and the details SMS). With it, it resends: the resend waits 30 seconds, with at most 3 resends. The response is `{ otpRequestId, sentToLast4, contactName, resendAvailableAt, resendsLeft }`. Returns `400` unless the vacancy is `awaiting_confirmation`.

### `POST /vacancies/:id/confirm`

Body `{ "otpRequestId": string, "code": string, "method"?: "code_on_call" | "code_on_visit" }` (default `code_on_call`). The agent types the code the contact person reads out. On success the vacancy becomes `open` and records `confirmedAt`, `confirmationMethod`, `confirmedByName`, `confirmedByRole`, `confirmedPhoneLast4` and `confirmationRecordedByStaffId`. A status history row and a `vacancy.confirmed` audit entry are written. Returns `400` for a wrong or expired code, a code that was not sent to this vacancy's contact person, or a vacancy that is not awaiting confirmation.

### `POST /vacancies/:id/confirmation-link`

Sends the contact person a 48-hour link by SMS (`vacancy_confirm_link`) and revokes any earlier active link. The vacancy stays `awaiting_confirmation` until they confirm. The response is `{ success, expiresAt, sentToLast4 }`.

### Public: `GET /vacancy-confirm/:token`, `POST /vacancy-confirm/:token/send-otp`, `POST /vacancy-confirm/:token`

No login. `GET` returns the vacancy details only (business name, trade, how many, salary, shift, start date, status, `sentToLast4`, `expiresAt`) and no personal data. `send-otp` sends a code to the number the link was sent to; body `{ "otpRequestId"?: string }` resends. `POST` with `{ "otpRequestId", "code" }` confirms the vacancy (`confirmationMethod: "sms_link"`) and uses up the link. An expired, used or revoked link returns `400`.

### `GET /vacancies/below-legal-minimum`

Who: Team Leads (vacancies captured by their team or for their team's account businesses), Managers and the CEO. Other roles get `403`. Returns `[{ id, code, status, business: { id, code, name }, tradeSkill, salaryMinPaise, salaryPeriod, legalMinimumPaise, ownerToldMinimumWage, capturedByStaffId, createdAt }]`, newest first, excluding cancelled vacancies.
