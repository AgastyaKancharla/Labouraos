# Laboura customer app API (contract)

The API the Laboura app (`customer/`, Expo) calls. It is the contract between
Agent A (sign-in and customer APIs), Agent B (the app), Agent C (notifications)
and Agent D (back office). Source of the rules: the customer app proposal,
confirmed 14 Nov ("All recommended OK": every recommended answer and C1 to C24),
and the Master Guide.

**Status column** in each table: `foundation` = live after the foundation PR;
`A` / `C` / `D` = the agent who builds it. Shapes below are final; if a builder
must change one, they change this file in the same PR and say so.

---

## 1. Ground rules

### 1.1 Base address and versions

- Base: `https://app.laboura.com/customer-api/v1` (test: the Render test address + `/customer-api/v1`).
- Every request: `Accept: application/json`. Bodies are JSON (`Content-Type: application/json`).
- Store apps cannot be updated instantly, so `v1` never changes shape in a
  breaking way. New fields may be added at any time; the app must ignore unknown fields.
- Times are ISO 8601 in UTC (`2026-11-28T06:00:00.000Z`). The app shows IST.
  Calendar dates (date of birth, available from) are `YYYY-MM-DD`.
- Money is always integer **paise** (`49900` = ₹499), in fields ending `Paise`.

### 1.2 A separate door (customer realm)

- Customers sign in only through `/customer-api/v1/auth/...`. A customer
  **access token** is a short JWT (15 minutes) signed with the customer key
  (`CUSTOMER_JWT_SECRET`), audience `laboura-customer`, claim `realm: "customer"`.
- Send it as `Authorization: Bearer <accessToken>` on every route marked 🔒.
- A customer token is refused by every staff route; a staff token is refused by
  every customer route (401 `CUSTOMER_TOKEN_INVALID`). Tested in
  `src/common/customer-auth/customer-realm.spec.ts`.
- The server works out who "me" is from the token. **The app never sends a job
  seeker, business or referral id.** Where a path has `:profileId`, it is the id
  of one of *my* profiles (from `GET /me`); any other id answers 404
  `PROFILE_NOT_FOUND`, exactly as if it did not exist.
- Server code: guard every handler with `@CustomerRoute()` from
  `src/common/customer-auth/customer-auth.decorators.ts`, read the caller with
  `@CurrentCustomer()` (`{ accountId, sessionId, deviceId }`). Never read `req.user`
  (that is the staff realm).

### 1.3 Device header

Send `X-Laboura-Installation: <installationId>` on every request: a random id
(UUID) the app makes once per install and keeps. It is used for the OTP limits
per device and to tie a session to a phone. Never the phone's IMEI or ad id.

### 1.4 Errors

Every error body is:

```json
{ "statusCode": 409, "code": "PROFILE_EXISTS", "message": "You already have a job seeker profile", "...": "extra fields" }
```

`message` is English, for logs and testers. **The app chooses its own words
from `code`**, in the person's language. Validation errors from the existing
forms (job seeker, business, referral) keep the existing English message and
also carry `code: "VALIDATION_FAILED"` and, when known, `field`.

| code | HTTP | Meaning / what the app does |
| --- | --- | --- |
| `CUSTOMER_TOKEN_MISSING` | 401 | No token: go to sign-in |
| `CUSTOMER_TOKEN_EXPIRED` | 401 | Access token expired: call `POST /auth/refresh`, then retry once |
| `CUSTOMER_TOKEN_INVALID` | 401 | Not a customer token (or tampered): go to sign-in |
| `CUSTOMER_SESSION_ENDED` | 401 | Signed out, replaced or past 90 days: go to sign-in |
| `CUSTOMER_REFRESH_INVALID` | 401 | Refresh token unknown, used twice or expired: go to sign-in |
| `CUSTOMER_ACCOUNT_BLOCKED` | 401 | Blocked by Laboura: show "Call Laboura" |
| `CUSTOMER_ACCOUNT_DELETED` | 401 | Deleted: show "This account was deleted" |
| `PHONE_INVALID` | 400 | Not a 10-digit Indian mobile (+91 fixed, starts 6 to 9) |
| `PHONE_NOT_VERIFIED` | 403 | This action needs a verified mobile first (Google accounts): go to "Your mobile number" |
| `PHONE_IN_USE` | 409 | That mobile already belongs to another account that cannot be joined to this one (both have profiles): show "Call Laboura" |
| `OTP_INVALID` | 400 | Wrong code. `attemptsLeft` tells how many tries remain |
| `OTP_EXPIRED` | 400 | Code expired or used up: ask for a new one |
| `OTP_LIMIT` | 429 | Too many codes or wrong tries. `retryAfterSeconds` says when to try again |
| `GOOGLE_TOKEN_INVALID` | 401 | Google sign-in token not valid for Laboura: try again or use mobile |
| `GOOGLE_NOT_CONFIGURED` | 503 | Google sign-in is not switched on for this server: hide the button (see `GET /config`) |
| `STEP_UP_REQUIRED` | 403 | Sensitive action: send a fresh OTP (`POST /auth/step-up/send`), verify, retry. `purpose` names the action |
| `PROFILE_NOT_FOUND` | 404 | Not one of my profiles |
| `PROFILE_KIND_MISMATCH` | 400 | Route is for another profile kind (e.g. vacancy drafts on a job seeker profile) |
| `PROFILE_EXISTS` | 409 | I already have this kind of profile. `profileId` is returned |
| `ALREADY_REGISTERED_OTHER_KIND` | 409 | Reserved: not used in v1 (a job seeker may also be a partner, and so on) |
| `UNDER_18` | 422 | Date of birth under 18: stop, polite message. Nothing is saved |
| `VALIDATION_FAILED` | 400 | A field is wrong; `field` when known |
| `REFERRAL_SELF` | 422 | A partner's own code was used on their own sign-up |
| `REFERRAL_PAUSED` | 422 | The referral code belongs to a paused partner; the sign-up continues without it if the app resends without `referralCode` |
| `NOT_ALLOWED` | 403 | The action is not allowed for my role on this profile (e.g. a branch manager opening the agreement) |
| `GUARANTEE_WARNING_REQUIRED` | 409 | Deleting while the 30-day guarantee runs: show the warning, resend with `refundLossAcknowledged: true` |
| `BELOW_MINIMUM_WAGE_TICK_REQUIRED` | 409 | Vacancy salary below the legal minimum: show the warning and the tick, resend with `ownerToldMinimumWage: true`. `legalMinimumPaise` included |
| `SERVICE_LOCKED` | 409 | Service notifications cannot be switched off while a guarantee is running |
| `DELETION_PENDING` | 409 | A deletion request is already open |
| `NOT_IMPLEMENTED` | 501 | Route exists but not built yet on this server |

Plain `429` without a code: more than 300 requests a minute from one internet
address (the server's general limit for routes outside the staff login).

---

## 2. Config (public)

| Method and path | Auth | Status |
| --- | --- | --- |
| `GET /config` | none | A |

Response:

```json
{
  "googleClientIds": { "android": "…apps.googleusercontent.com", "ios": "…", "web": "…" },
  "googleSignIn": true,
  "otpTestMode": true,
  "languages": ["kn", "hi", "en"],
  "otpResendSeconds": 30,
  "otpMaxResends": 3,
  "sessionDays": 90
}
```

`googleSignIn` is false (and the ids null) when no Google client id is set on
the server: the app hides "Continue with Google". `otpTestMode` true means the
server returns the OTP in `testModeCode` (test setup only, pretend SMS).

---

## 3. Sign-in

Two ways in (decided 14 Nov, D2): mobile + OTP, or Google. Either creates the
account. **A verified mobile is required before any profile is registered or
linked.** Sessions last 90 days per phone, renewed on every refresh (C16).

### 3.1 Mobile + OTP

| Method and path | Auth | Status |
| --- | --- | --- |
| `POST /auth/otp/send` | none | A |
| `POST /auth/otp/verify` | none | A |

`POST /auth/otp/send`

```json
{ "phone": "9876543210", "requestId": "otp_… (only for a resend)" }
```

→ `200`

```json
{ "requestId": "otp_ab12cd34_…", "resendAvailableAt": "…", "resendsLeft": 3, "testModeCode": "123456" }
```

Rules: +91 fixed, 10 digits. Resend after 30 seconds, at most 3 resends (Forms
rules). Abuse limits (proposal 7.6), each answering `429 OTP_LIMIT` with
`retryAfterSeconds`: per phone at most 5 codes an hour and 10 a day; per
internet address at most 20 codes an hour; per installation at most 10 codes an
hour; 5 wrong codes on one request end that request (`OTP_EXPIRED`); 10 wrong
codes for one phone in an hour block that phone for an hour. `testModeCode`
appears only in OTP test mode.

`POST /auth/otp/verify`

```json
{
  "phone": "9876543210",
  "requestId": "otp_…",
  "code": "123456",
  "device": { "installationId": "uuid", "platform": "android", "appVersion": "1.0.0" },
  "language": "kn"
}
```

→ `200` the **session answer** (below). Wrong code: `400 OTP_INVALID` with
`attemptsLeft`.

### 3.2 Google

| Method and path | Auth | Status |
| --- | --- | --- |
| `POST /auth/google` | none | A |

```json
{ "idToken": "<Google ID token from the Google sign-in SDK>", "device": { "installationId": "uuid", "platform": "android", "appVersion": "1.0.0" }, "language": "en" }
```

The server checks the ID token's signature against Google's public keys, the
issuer (`accounts.google.com`), the audience (one of the Google client ids in
`GOOGLE_CLIENT_ID_ANDROID`, `GOOGLE_CLIENT_ID_IOS`, `GOOGLE_CLIENT_ID_WEB`), the
expiry and `email_verified`. It keeps Google's `sub`, the email and the name;
**never the Google picture**. → `200` session answer. If the Google account has
no verified mobile yet, `next` is `"add_phone"`.

### 3.3 The session answer

Returned by `otp/verify`, `google`, `phone/verify` (when the account changed) and `refresh`:

```json
{
  "accessToken": "eyJ…",
  "accessTokenExpiresIn": 900,
  "refreshToken": "opaque-random-string",
  "refreshTokenExpiresAt": "2027-02-26T06:00:00.000Z",
  "account": { "…": "same shape as GET /me" },
  "linked": [ { "profileId": "uuid", "kind": "job_seeker", "code": "JS-01234", "linkedVia": "phone_match" } ],
  "next": "choose_role"
}
```

- `refreshToken` is shown once. Keep it in secure storage (Expo SecureStore). The
  server keeps only its hash.
- `linked`: records an agent already made with this verified mobile, attached to
  the account just now (proposal 3.4). Empty when nothing new was linked.
- `next` tells the app where to go:

| next | When | Screen |
| --- | --- | --- |
| `add_phone` | Google account, no verified mobile | "Your mobile number" + OTP (§3.4) |
| `choose_role` | Verified mobile, no profile | Role picker: "I want a job" / "I need staff" / "I refer people and earn" |
| `choose_profile` | Two or more profiles | My profiles (profile chooser) |
| `home` | Exactly one profile | That profile's Home (`lastProfileId`) |

### 3.4 Adding the mobile to a Google account

| Method and path | Auth | Status |
| --- | --- | --- |
| `POST /auth/phone/send` | 🔒 | A |
| `POST /auth/phone/verify` | 🔒 | A |

`send` body `{ "phone": "9876543210", "requestId": "(resend only)" }`, answer as
`otp/send`. `verify` body `{ "phone": "…", "requestId": "…", "code": "…" }`.

- Mobile not used by any account: it becomes this account's verified mobile;
  records an agent made with it are linked. Answer: session answer with the
  **same** tokens fields omitted (`accessToken` etc. absent), `account`, `linked`, `next`.
- Mobile already belongs to another account (someone who signed in by mobile
  before) and **this** Google account has no profiles: the Google sign-in is
  joined to that account and this empty account is closed. Answer: a full
  session answer with **new tokens for the other account**; the app replaces its tokens.
- Both accounts have profiles: `409 PHONE_IN_USE` (an agent sorts it out).

### 3.5 Refresh, sign out

| Method and path | Auth | Status |
| --- | --- | --- |
| `POST /auth/refresh` | none (refresh token in body) | A |
| `POST /auth/sign-out` | 🔒 | A |

`POST /auth/refresh` `{ "refreshToken": "…" }` → session answer with a **new**
refresh token (the old one stops working). Using an old refresh token again
ends that session (`401 CUSTOMER_REFRESH_INVALID`): it may have been stolen.
Each refresh moves the session's end to 90 days from now.

`POST /auth/sign-out` → `204`. Ends this session and removes this phone's push
token (no more notifications to it).

### 3.6 Fresh OTP for sensitive actions (step-up)

| Method and path | Auth | Status |
| --- | --- | --- |
| `POST /auth/step-up/send` | 🔒 | A |
| `POST /auth/step-up/verify` | 🔒 | A |

Sensitive actions always need a fresh OTP to the account's verified mobile
(proposal 3, point 5): `delete_account`, `payout_details`, `sign_agreement`,
`interview_result`, `confirm_vacancy`.

`send` `{ "purpose": "delete_account", "requestId": "(resend only)" }` →
`{ "requestId", "resendAvailableAt", "resendsLeft", "testModeCode"? }` (same
limits as sign-in). `verify` `{ "purpose": "delete_account", "requestId": "…", "code": "…" }`
→ `{ "purpose": "delete_account", "validUntil": "…" }`. The step-up is good
for **5 minutes and one action** of that purpose on this session. A sensitive
route without it answers `403 STEP_UP_REQUIRED` with `purpose`.

---

## 4. Account and profiles

| Method and path | Auth | Status |
| --- | --- | --- |
| `GET /me` | 🔒 | **foundation** |
| `PATCH /me` | 🔒 | A |
| `PUT /me/last-profile` | 🔒 | A |
| `POST /me/signups` | 🔒 | A |

`GET /me` →

```json
{
  "id": "uuid",
  "phone": "+919876543210",
  "phoneVerified": true,
  "email": "name@gmail.com",
  "displayName": "Ravi Kumar",
  "language": "kn",
  "contactMeConsent": true,
  "status": "active",
  "signInMethods": ["google", "phone"],
  "lastProfileId": "uuid",
  "createdAt": "…",
  "profiles": [
    { "id": "uuid", "kind": "job_seeker", "role": "self", "code": "JS-01234", "title": "Ravi", "branchName": null },
    { "id": "uuid", "kind": "business", "role": "manager", "code": "BZ-00456", "title": "Sri Sai Bakery", "branchName": "Jayanagar" }
  ]
}
```

`status`: `active`, `deletion_requested`. `role`: `self` for job seeker and
partner profiles; `owner`, `manager`, `hr`, `supervisor` for business profiles.
A profile with `branchName` is limited to that branch.

`PATCH /me` `{ "language": "hi", "displayName": "…", "contactMe": true }` → `GET /me` shape.
`contactMe` is the tick "Laboura may call, SMS or WhatsApp me to help me finish
registering" (C7); turning it off stops sign-up help calls.

`PUT /me/last-profile` `{ "profileId": "uuid" }` → `204`. Remembers the profile
Home opens next time (proposal 3.3).

`POST /me/signups` — the role picker and "+ Add another" (proposal 3.3). Starts
a sign-up of one kind and creates its tracker row at stage A (proposal 4.1).

```json
{ "kind": "job_seeker", "source": "store", "sourceDetail": "play_store", "referralCode": "RF-00012", "contactMe": true }
```

→ `201 { "signupId": "uuid", "kind": "job_seeker", "stage": "A" }`. If an open
sign-up of that kind exists it is returned (`200`). If I already have that kind
of profile: `409 PROFILE_EXISTS` with `profileId`. Needs a verified mobile
(`403 PHONE_NOT_VERIFIED`). `source`: `store`, `referral_link`, `ad`, `organic`,
`agent_link`.

---

## 5. Self-registration

All three call the **existing** job seeker, business and referral services, so
the same validation, duplicate check, consent, minimum wage and 18+ rules apply
as on the agent's forms. The mobile is the account's verified mobile (never sent
in the body). `heardFrom` defaults to `laboura_app` (C3). The record is created
with no registering agent (`registeredByStaffId` / `leadCreatedByStaffId` null),
labelled "Registered in the app" by the back office. Each moves the sign-up to stage B.

| Method and path | Auth | Status |
| --- | --- | --- |
| `POST /me/register/age-check` | 🔒 | A |
| `POST /me/register/job-seeker` | 🔒 | A |
| `POST /me/register/business` | 🔒 | A |
| `POST /me/register/referral` | 🔒 | A |

### 5.1 Age first

`POST /me/register/age-check` `{ "dateOfBirth": "2004-05-17" }` → `200 { "adult": true }`
or `422 UNDER_18`. Nothing is stored (the guide: under 18 stops before anything
else is collected). The job seeker form sends the same date again and the server
checks it again.

### 5.2 Job seeker

`POST /me/register/job-seeker` — the fields of the agent's form (guide, "What is recorded"):

```json
{
  "name": "Ravi Kumar",
  "messageLanguage": "kn",
  "bestTimeToCall": "18-21",
  "dateOfBirth": "2004-05-17",
  "gender": "male",
  "locality": "Jayanagar",
  "pincode": "560041",
  "latitude": 12.93,
  "longitude": 77.58,
  "travelDistanceKm": 10,
  "trades": [{ "trade": "Cook", "yearsExperience": 3 }],
  "availableFrom": "2026-12-01",
  "lookingSince": "2026-11-01",
  "minSalary": 1800000,
  "maxSalary": 2200000,
  "salaryPeriod": "monthly",
  "shiftPreference": "day",
  "jobType": "full_time",
  "spokenLanguages": ["Kannada", "Hindi"],
  "heardFrom": "laboura_app",
  "referralCode": "RF-00012",
  "optional": { "whatsappPhone": "…", "preferredLocalities": ["…"], "qualification": "…", "…": "the agent form's optional fields" }
}
```

`minSalary` / `maxSalary` are paise. → `201`

```json
{ "profileId": "uuid", "kind": "job_seeker", "code": "JS-01234", "status": "lead", "next": "registration_link" }
```

Errors: `422 UNDER_18`; `409 PROFILE_EXISTS` (the mobile already has a job
seeker record: it is linked instead and `profileId` returned); `400 VALIDATION_FAILED`;
`422 REFERRAL_SELF` / `REFERRAL_PAUSED`. Then the app opens the registration link (§6)
for consent, selfie, ID check and the ₹499.

### 5.3 Business (a lead)

The business becomes a **lead**, not a live business (guide: a business that
comes in is a lead until a field agent's verification visit; no candidate is
shown before the visit, the agreement and the Team Lead's approval).

```json
{
  "contactPersonName": "Lakshmi",
  "contactPersonRole": "owner",
  "name": "Sri Sai Bakery",
  "legalName": "…",
  "businessType": "bakery",
  "employeeCountBand": "1-5",
  "shopNumber": "12", "street": "…", "landmark": "…", "locality": "Jayanagar", "pincode": "560041",
  "latitude": 12.93, "longitude": 77.58,
  "openingTime": "08:00", "closingTime": "21:00", "workingDays": ["mon", "tue"],
  "gstNumber": "…", "licenceNumber": "…", "noDocuments": false,
  "billingEmail": "…",
  "staffNeededRows": [{ "trade": "Baker", "headcount": 1, "salaryMinPaise": 1800000, "salaryMaxPaise": 2200000, "shift": "day", "startDate": "2026-12-01" }],
  "heardFrom": "laboura_app",
  "referralCode": "RF-00012",
  "visitPreferredAt": "2026-11-29T05:30:00.000Z",
  "contactMe": true
}
```

`contactPersonRole`: `owner`, `manager`, `hr`, `supervisor` (my profile role).
Households are hidden in v1 (C24). → `201`

```json
{ "profileId": "uuid", "kind": "business", "code": "BZ-00456", "verificationStatus": "lead", "next": "agreement" }
```

The back office (D) creates the `business_signup` visit request from the sign-up.
Errors: `409 PROFILE_EXISTS` (mobile, GST or licence already registered: linked
if it is my mobile; otherwise `409 VALIDATION_FAILED` "Already registered" and
the app offers "Call me back"); `400 VALIDATION_FAILED`.

### 5.4 Referral partner

```json
{
  "name": "Manju",
  "type": "individual",
  "individualRole": "auto_driver",
  "partnerBusinessType": null, "partnerBusinessName": null,
  "whatsappPhone": "9876543210",
  "language": "kn",
  "locality": "Jayanagar", "pincode": "560041", "latitude": 12.93, "longitude": 77.58,
  "heardFrom": "laboura_app"
}
```

→ `201 { "profileId", "kind": "referral", "code": "RF-00034", "next": "registration_link" }`.
Then the partner link (§6) for terms and recording consent, selfie, ID check and UPI.

---

## 6. Link pages inside the app (secure browser sheet)

For the first version the verification steps open the **existing** link pages
in a secure browser sheet (decided: proposal 10, question 4). The server issues
a fresh link for the signed-in person; no SMS is sent.

| Method and path | Auth | Status |
| --- | --- | --- |
| `POST /me/profiles/:profileId/links` | 🔒 | A |

```json
{ "purpose": "registration" }
```

| purpose | Profile | Opens | Notes |
| --- | --- | --- | --- |
| `registration` | job seeker | `/p/register/<token>` | consent → selfie → ID check → terms and ₹499. Switches off any older registration link (one live link per person) |
| `referral_registration` | referral | `/p/partner/<token>` | terms and recording consent → selfie → ID check → UPI |
| `business_agreement` | business, role `owner` | `/p/agreement/<token>` | agreement signed by OTP. A non-owner: `403 NOT_ALLOWED` |

→ `201 { "url": "https://app.laboura.com/p/register/…", "purpose": "registration", "expiresAt": "…" }`.
The page still asks for the OTP to the person's own number, as today. When the
sheet closes, the app reloads Home.

---

## 7. Home (status)

| Method and path | Auth | Status |
| --- | --- | --- |
| `GET /me/profiles/:profileId/home` | 🔒 | A |

The answer depends on the profile kind (`kind`).

### 7.1 Job seeker

```json
{
  "kind": "job_seeker",
  "code": "JS-01234",
  "firstName": "Ravi",
  "status": "active",
  "steps": { "phone": true, "profile": true, "consent": true, "selfie": true, "idCheck": true, "terms": true, "payment": true },
  "currentStep": "complete",
  "stopped": null,
  "idCheck": { "lastResult": "verified", "serviceDown": false, "waitingForService": false },
  "payment": { "state": "confirmed", "amountPaise": 49900, "confirmedAt": "…" },
  "guarantee": { "active": true, "day": 12, "days": 30, "startedAt": "…", "endsAt": "…" },
  "hits": { "count": 0, "max": 3 },
  "interview": null,
  "refund": { "state": "none", "dueOn": null, "paidAt": null, "reference": null },
  "nextAction": "wait_for_offer"
}
```

- `payment.state`: `not_started`, `pending`, `confirming` ("Paid, confirming" until the
  bank credit is matched), `failed`, `confirmed`. The 30 days start only at `confirmed`.
- `guarantee.day` counts from the confirmed payment, 1 to 30 (null before payment).
- `interview`: `null` until an interview is **booked**. Then
  `{ "at": "…", "businessName": "…", "address": "…", "latitude": …, "longitude": …, "replyBy": "…", "state": "booked" }`.
  **The business name and address never appear before an interview is booked**
  (no-bypass rule).
- `refund.state`: `none`, `not_owed`, `due` (`dueOn` set), `with_finance`, `paid`
  (`paidAt`, `reference` = UPI reference). Status only; refunds are released by a person.
- `nextAction`: `open_registration_link`, `wait_for_id_check`, `pay`, `wait_for_payment_confirmation`,
  `wait_for_offer`, `reply_to_offer`, `go_to_interview`, `pay_again` (after 3 hits), `none`.

### 7.2 Business

```json
{
  "kind": "business",
  "code": "BZ-00456",
  "name": "Sri Sai Bakery",
  "role": "owner",
  "branch": null,
  "verificationStatus": "lead",
  "tracker": { "phoneVerified": true, "agreement": false, "visitBooked": true, "visitDone": false, "approved": false, "verified": false },
  "visit": { "state": "booked", "requestedFor": "…", "agentFirstName": "Suresh" },
  "vacancies": [
    { "code": "VC-00078", "trade": "Baker", "headcount": 1, "status": "open", "belowLegalMinimum": false, "interviewsUpcoming": 0, "placements": 0 }
  ],
  "drafts": [ { "id": "uuid", "trade": "Helper", "updatedAt": "…" } ],
  "counts": { "interviewsUpcoming": 0, "placements": 0 },
  "nextAction": "sign_agreement"
}
```

A branch manager sees only that branch's vacancies, drafts and counts, and
`tracker.agreement` only as true/false. **No candidate is listed here in v1**, and
never a phone number. `nextAction`: `sign_agreement`, `wait_for_visit`,
`wait_for_approval`, `add_vacancy`, `none`.

### 7.3 Referral partner

```json
{
  "kind": "referral",
  "code": "RF-00034",
  "firstName": "Manju",
  "paused": false,
  "steps": { "terms": true, "selfie": true, "idCheck": true, "upi": true },
  "share": {
    "link": "https://app.laboura.com/r/RF-00034",
    "qrText": "https://app.laboura.com/r/RF-00034",
    "whatsappText": "…"
  },
  "referred": [ { "firstName": "Ravi", "stage": "joined", "since": "…" } ],
  "money": {
    "duePaise": 20000, "approvedPaise": 0, "paidPaise": 40000, "yearTotalPaise": 40000,
    "statement": [ { "amountPaise": 20000, "status": "paid", "date": "…", "upiReference": "…" } ]
  },
  "nextAction": "share_link"
}
```

- `referred`: **first name and stage only** (`registered`, `paid`, `interview`, `joined`).
  Never a phone number, surname or workplace (decided, question 18).
- `money`: ₹200 per referred person who **joins**; a payout statement, not an
  invoice. Business referrals are listed without an amount (not decided).
- `paused`: true when the CEO has paused the partner: new referrals are refused;
  earned money is still paid.
- `share.link` is where a partner's QR points; the page behind it is out of scope
  of v1 (Agent B/web may add it). `qrText` is what the app turns into a QR code.

---

## 8. Business: vacancy drafts

| Method and path | Auth | Status |
| --- | --- | --- |
| `POST /me/profiles/:profileId/vacancy-drafts` | 🔒 | A |
| `PATCH /me/profiles/:profileId/vacancy-drafts/:draftId` | 🔒 | A |
| `DELETE /me/profiles/:profileId/vacancy-drafts/:draftId` | 🔒 | A |
| `POST /me/profiles/:profileId/vacancy-drafts/:draftId/confirm` | 🔒 + step-up `confirm_vacancy` | A |

Body: `{ "form": { … the agent's vacancy form: tradeSkill, headcount, salaryMinPaise, salaryMaxPaise, salaryPeriod, shift, workingHours, weeklyOff, startDate, branchId?, … } }`.
→ `{ "id": "uuid", "status": "draft", "form": { … }, "warnings": { "belowLegalMinimum": true, "legalMinimumPaise": 2340000 } }`.

`confirm` `{ "ownerToldMinimumWage": true }` → `201 { "vacancy": { "code": "VC-00079", "status": "open" } }`.
Confirmed by a fresh OTP on the contact person's verified mobile (C8); below the
legal minimum it needs the tick (`409 BELOW_MINIMUM_WAGE_TICK_REQUIRED` otherwise).
The vacancy still waits for the verification visit before any candidate is shown.
A branch manager can only use their own branch.

---

## 9. Inbox, push token and settings (Agent C)

| Method and path | Auth | Status |
| --- | --- | --- |
| `GET /me/inbox?cursor=&limit=` | 🔒 | C |
| `POST /me/inbox/:messageId/read` | 🔒 | C |
| `POST /me/inbox/read-all` | 🔒 | C |
| `PUT /me/device` | 🔒 | C |
| `DELETE /me/device/push-token` | 🔒 | C |
| `GET /me/notification-settings` | 🔒 | C |
| `PUT /me/notification-settings` | 🔒 | C |

`GET /me/inbox` → `{ "items": [Message], "nextCursor": "…" | null, "unreadCount": 3 }`, newest first, `limit` 1 to 50 (default 20).

```json
{
  "id": "uuid", "profileId": "uuid", "kind": "payment_received", "category": "service", "priority": "normal",
  "title": "…", "body": "…", "deepLink": "/home", "data": {}, "createdAt": "…", "readAt": null
}
```

Wording is in the account's language. Lock-screen text never carries private
details (proposal 5.4). `read` / `read-all` → `204`.

`PUT /me/device` — called after sign-in and whenever the push token or
permission changes:

```json
{ "installationId": "uuid", "platform": "android", "appVersion": "1.0.0", "pushToken": "ExponentPushToken[…]", "pushPermission": "granted" }
```

→ `204`. One push token belongs to one account at a time (moving it to this
account removes it elsewhere). `pushToken: null` or `DELETE /me/device/push-token` stops push to this phone.

`GET /me/notification-settings` →
`{ "service": true, "jobUpdates": false, "promotions": false, "quietStart": "21:00", "quietEnd": "09:00", "dailyCap": 3, "serviceLocked": true }`.
`PUT` `{ "service": true, "jobUpdates": true, "promotions": false }` → same shape.
`service: false` while a guarantee is running → `409 SERVICE_LOCKED`. Quiet
hours and the daily cap are fixed in v1 (9 PM to 9 AM, 3 non-urgent a day). C
keeps the job seeker's `job_updates` and `promotions` consent rows in step with
the switches.

Server side (C): `src/modules/customer-notification/` exports a service the
other modules call, e.g. `notify({ accountId, profileId?, kind, category, priority, vars, dedupeKey })`.
It writes `CustomerInboxMessage`, a `MessageLog` row with channel `push` or
`in_app`, and queues the push. **A push or in-app message is never a contact
attempt** and never counts toward a hit (C17).

---

## 10. Call me back

| Method and path | Auth | Status |
| --- | --- | --- |
| `POST /me/callback-requests` | 🔒 | A |
| `GET /me/callback-requests` | 🔒 | A |

```json
{ "profileId": "uuid", "topic": "signup", "note": "UPI failed", "preferredFrom": "18:00", "preferredTo": "21:00" }
```

`topic`: `signup`, `payment`, `interview`, `refund`, `payout`, `vacancy`, `other`.
Times are IST inside 09:00 to 21:00. → `201 { "id": "uuid", "status": "open", "createdAt": "…" }`.
One open request per account: a second answers `200` with the open one. `note`
is short (200 characters) and must not carry ID numbers. The back office (D)
turns it into a call task (CallTask kind `callback`, or `signup_help` during a sign-up).
`GET` lists my last 10 with `status` (`open`, `assigned`, `done`, `cancelled`).

---

## 11. Delete my account

| Method and path | Auth | Status |
| --- | --- | --- |
| `GET /me/deletion` | 🔒 | A |
| `POST /me/deletion` | 🔒 + step-up `delete_account` | A |

`GET /me/deletion` → what to show before confirming:

```json
{ "guaranteeRunning": true, "endsRefund": true, "keptByLaw": ["payments", "invoices", "refunds", "payouts"], "openRequest": null }
```

`POST /me/deletion` `{ "reason": "…", "refundLossAcknowledged": true }` →
`201 { "id": "uuid", "status": "requested", "createdAt": "…" }`.

- While a job seeker's 30-day guarantee is running, deleting is the same as
  withdrawing consent after paying: **it ends the refund** (decided, question 20).
  Without `refundLossAcknowledged: true` the answer is `409 GUARANTEE_WARNING_REQUIRED`.
- The account becomes `deletion_requested`. Other sessions are signed out. The
  back office works it like a data request (erasure), keeping payments and
  invoices for the years the law requires, and anonymises the profiles.
- A second request while one is open: `409 DELETION_PENDING`.

---

## 12. Tables (for the back office and notifications)

All in `prisma/schema.prisma` (foundation migration `20261128000000_customer_app_foundation`),
every one with row level security on.

| Table | What it holds | Written by |
| --- | --- | --- |
| `CustomerAccount` | One signed-in person: verified mobile, Google email, language, contact-me tick, status | A |
| `CustomerIdentity` | Sign-in methods: `phone` (+91 mobile) or `google` (Google `sub`) | A |
| `CustomerProfile` | Which job seeker / business (+ branch) / partner an account acts for, as what | A |
| `CustomerSession` | 90-day sessions per phone; refresh token hash; step-up time | A |
| `CustomerDevice` | Installation, platform, app version, Expo push token | A (create on sign-in), C (push token) |
| `CustomerOtpAttempt` | OTP sends and wrong codes, hashed, for abuse limits | A |
| `SignupTracker` | One app sign-up: stage A to done, source, contact consent, assignee, outcome | A creates it (stage A) and sets the record and stage B on registration; **D owns everything after** (later stages read from the records, assignment, timing, tasks, closing). D's job picks up trackers whose `nextActionAt` is null |
| `SignupTrackerEvent` | History of a sign-up | A (stage A/B), D (all else) |
| `CustomerInboxMessage` | Inbox and push copies | C |
| `CustomerNotificationSetting` | The three switches, quiet hours, cap | C |
| `CustomerDeletionRequest` | Delete-my-account requests | A creates; D handles |
| `CustomerCallbackRequest` | Call me back | A creates; D turns into call tasks |
| `CustomerVacancyDraft` | Vacancies a business writes before confirming by OTP | A |

Changes to existing tables and values:

- `Staff.spokenLanguages` (text list): languages a staff member speaks with customers (C5).
- `CallTask.kind` value `signup_help`; `CallTask.signupTrackerId` (C4).
- `VisitAssignment.purpose` value `business_signup`; `VisitAssignment.requestedFor`
  (time the owner picked) and `VisitAssignment.signupTrackerId`.
- `heardFrom` value `laboura_app` on job seekers, businesses and referral partners (C3).
- `MessageLog.channel` values `push` and `in_app` (C17).

Shared constants: `src/common/customer-auth/customer-app.constants.ts`.

---

## 13. Settings on the server

| Variable | Where | What |
| --- | --- | --- |
| `CUSTOMER_JWT_SECRET` | render.yaml (generated) | Key for customer tokens, 32+ characters, different from `JWT_SECRET`. If unset (local, tests), one is derived from `JWT_SECRET` |
| `GOOGLE_CLIENT_ID_ANDROID`, `GOOGLE_CLIENT_ID_IOS`, `GOOGLE_CLIENT_ID_WEB` | render.yaml, `sync: false` | OAuth client ids from the Firebase / Google Cloud project. None set: Google sign-in is off |
| `CUSTOMER_ACCESS_TOKEN_MINUTES` | optional | Access token life, 1 to 60, default 15 |
