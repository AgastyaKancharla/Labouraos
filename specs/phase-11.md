# Phase 11 — Calling and Messages

**Goal:** every call goes through Laboura's calling system and is recorded; whether a call connected comes only from the calling company, never from an agent; agents never see full phone numbers; every SMS and WhatsApp is logged; and the 3-hit no-pickup rule is fed only by the system.

**Why this is next:** step 3 of the build order in `specs/data-design.md` §16. It covers changes 7–10 in the code check (phone numbers visible to agents, agents typing numbers to call, agents typing call results, the recording announcement).

**The calling company is not chosen yet** (Exotel or Tata Smartflo). Build everything against the existing `TelephonyProvider` interface with the mock provider. Keep the existing Exotel adapter working and map it to the new tables; a Tata adapter comes later with no change to anything else.

**Read first:** `AGENTS.md`, `LESSONS.md`, this whole spec, `specs/data-design.md` §0, §1 (`CallRecord`, `MessageLog`) and §4 (`ContactAttempt`). Calling hours come from `PricingService.current()` (`callingHoursStart`, `callingHoursEnd`) — never type 09:00 or 21:00.

**Out of scope — do not build:** consent records (next phase), offers and interviews, follow-up tasks, the field agent native app, the retention clean-up job, any change to the 3-hit rule itself, the Command Center restyle.

---

## How this phase runs — waves

| Wave | Tasks | Run |
| --- | --- | --- |
| 1 | Task 1 (call records), Task 2 (message log), Task 3 (hidden numbers and call routing phone) | Together, or one after another |
| 2 | Task 4 (click-to-call), Task 5 (contact attempts from the system only) | Together, or one after another |
| 3 | Task 6 (screens), Task 7 (deployment and docs), Task 8 (login limit per connection) | Together, or one after another |

Each task has its own branch and, where needed, a fixed migration folder name so they never clash. Whether run together or one after another: build on the latest `main`, push, wait for GitHub Actions to pass **on the branch**, fix failures on the branch, then merge — one branch at a time, rebasing on the latest `main` first. Locally run only the tests for your own change; GitHub runs the full suite.

---

## Wave 1

### [x] Task 1 — Call records, the status webhook and recordings
**Branch:** `phase-11/task-1-call-records` · **Migration folder:** `20261104100000_add_call_records`

**Acceptance:**
- `CallRecord` table exactly as `specs/data-design.md` §1, with a `CALL` code prefix in the id service and sequence sync.
- A provider-neutral `CallStatusEvent` (provider, providerCallId, status, answered, startedAt, answeredAt, endedAt, durationSec, recordingUrl) and a mapper from the existing Exotel adapter's payload to it.
- `POST /telephony/webhook/call-status`: verifies the provider's signature (mock: a shared test secret), then upserts by (provider, providerCallId). **Idempotent** — a repeat delivery changes nothing. A later event can move a call forward (initiated → answered → completed) but never backwards.
- `providerStatus`, `answered`, the times and the duration are written **only** here.
- **Recordings are copied into Laboura's own storage.** A `RecordingStorage` interface with a mock (in memory, for tests) and a Supabase Storage implementation (private bucket, server-side key from an environment variable). After a completed call with a recording URL, the recording is downloaded and stored; `recordingStoragePath` is set. A failed copy is retried by a background job and raises nothing to agents.
- `GET /calls/:id` and `GET /calls?subjectType=&subjectId=`: the agent who made the call, their Team Lead, Manager, CEO. **Phone numbers never appear in the response.**
- `GET /calls/:id/recording` returns a short-lived signed link (5 minutes) for the Team Lead of the agent, a Manager or the CEO only. Every listen is audited.
- Tests: a webhook creates a record; the same webhook twice changes nothing; a late "ringing" after "completed" is ignored; a bad signature is refused; the recording is copied and the path set; an agent can't fetch a recording link; no response contains a phone number.

### [x] Task 2 — Message log and SMS
**Branch:** `phase-11/task-2-message-log` · **Migration folder:** `20261104110000_add_message_logs`

**Acceptance:**
- `MessageLog` table exactly as `specs/data-design.md` §1. **No message body is stored** — the template name and related record are enough.
- An `SmsProvider` interface with a mock and a real stub (like the existing WhatsApp provider), each template carrying its DLT template id from configuration.
- One `MessagingService.send({ channel, template, subjectType, subjectId, relatedType, relatedId, variables })` that writes the `MessageLog` row (`queued`), calls the right provider, and updates the row (`sent` or `failed`). Every system SMS and WhatsApp goes through it from now on — change the existing WhatsApp call sites to use it.
- Delivery-status webhooks for WhatsApp and SMS (`delivered`, `read`, `failed`), signature-checked and idempotent.
- `GET /messages?subjectType=&subjectId=` for the subject's agents' Team Lead, Manager, CEO — no phone numbers in the response.
- Tests: a send writes one row and moves it to `sent`; a provider failure marks it `failed`; a repeated delivery webhook changes nothing; no row contains a message body or phone number.

### [x] Task 3 — Hidden numbers, and the phone the calling system rings
**Branch:** `phase-11/task-3-hidden-numbers` · **Migration folder:** `20261104120000_staff_call_routing_phone`

**Acceptance:**
- **Phone numbers are hidden from `call_agent`, `field_agent` and `team_lead`** in every API response, the same way Finance's are today — shown as the last 4 digits only (for example `******1234`). CEO and Manager still see full numbers. This covers job seekers, businesses, referral partners, callback tasks and any nested object.
- `Staff.callRoutingPhone` (data-design §3): stored **encrypted** (AES-256-GCM) with a key from `CALL_ROUTING_KEY`, read through one function that refuses to start the server if the key is missing or too short.
- It is **never returned by any API**, to anyone. `PUT /staff/:id/call-routing-phone` (the staff member themself, their Team Lead, Manager, CEO) sets it; the response says only that it is set.
- Exports and downloads stay Manager and CEO only.
- Tests: a call agent, field agent and team lead see only the last 4 digits; a manager sees the full number; no endpoint ever returns `callRoutingPhone`; the value in the database is not readable as a phone number; the server won't start without `CALL_ROUTING_KEY`.

---

## Wave 2 (after Wave 1 is merged)

### [x] Task 4 — Click-to-call from a profile
**Branch:** `phase-11/task-4-click-to-call` · **No migration**

**Acceptance:**
- `POST /calls` with `{ subjectType, subjectId, purpose, relatedType?, relatedId? }`. **No phone numbers in the request.** The server looks up the subject's number and the caller's `callRoutingPhone`, creates a `CallRecord` (`initiated`), and asks the provider to ring the agent first, then the subject, with recording on. Returns the `callRecordId` only.
- Allowed for `call_agent`, `field_agent`, `team_lead`, `manager`, `ceo` — each only for subjects they can already read.
- Refused, with a clear message: outside the calling hours in `PricingPolicy` (IST); for a job seeker, outside their preferred call window; when the caller has no `callRoutingPhone` set.
- **The old `POST /telephony/outbound/click-to-call` that accepts raw phone numbers is removed.**
- The call announcement text becomes exactly: "This call is recorded for quality and service." Consent is taken in writing at registration (next phase), so the announcement no longer says that continuing means consent.
- `POST /calls/:id/outcome` with `agentOutcome` from the closed list in data-design §1 and an optional reason: only by the staff member who made the call, only when `answered = true`. A call that wasn't answered can't get an outcome.
- Tests: a call is placed with no numbers in the request or response; a call at 21:30 IST is refused; a job seeker outside their window is refused; a field agent can call; the old endpoint is gone; an outcome on an unanswered call is refused; another agent can't record the outcome; the announcement text matches.

### [x] Task 5 — Contact attempts come only from the system
**Branch:** `phase-11/task-5-system-contact-attempts` · **Migration folder:** `20261104130000_contact_attempt_sources`

**Acceptance:**
- `ContactAttempt` gets `callRecordId` and `messageLogId` (data-design §4).
- When a `CallRecord` to a job seeker reaches a final state (completed, no_answer, busy, failed, canceled), the system writes one `ContactAttempt`: `picked_up` if `answered`, otherwise `no_pickup`; `timeOfDay` from the call's start time in IST. Idempotent — one attempt per call.
- When `MessagingService` sends a WhatsApp or SMS to a job seeker, the system writes a `ContactAttempt` with that channel.
- **The agent endpoint that records contact attempts by hand is removed.** No role can type `picked_up` or `no_pickup`.
- The daily no-pickup sweep works unchanged on these system-made attempts, and its own automatic WhatsApp now goes through `MessagingService`.
- The 3-hit rule itself does not change.
- Tests: an unanswered call creates a `no_pickup` attempt; an answered one creates `picked_up`; a repeated webhook creates no second attempt; a WhatsApp send creates an attempt; the old endpoint is gone for every role; a morning and an evening unanswered call plus a WhatsApp on the same day produce one hit through the sweep.

---

## Wave 3 (after Wave 2 is merged)

### [x] Task 6 — Calling screens
**Branch:** `phase-11/task-6-calling-screens` · **No migration**

**Acceptance (existing consoles, plain styling):**
- A **Call** button on job seeker, business and referral partner profiles, calling `POST /calls`. Numbers shown as last 4 digits only.
- After an answered call, an outcome form with the closed list; nothing for an unanswered call.
- Call and message history on each profile: time, direction, purpose, answered or not, duration, outcome. A **Listen** button for the Team Lead, Manager and CEO.
- A clear message when calling is blocked (outside hours, outside the candidate's window, no routing phone set).
- Tests: the screens render for the allowed roles; no full phone number appears in any agent page.

### [x] Task 7 — Deployment, docs and the vendor checklist
**Branch:** `phase-11/task-7-deploy-docs` · **No migration**

**Acceptance:**
- `render.yaml`: `CALL_ROUTING_KEY` (generated), the telephony and messaging webhook secrets, and the Supabase storage settings for recordings, declared with no values committed.
- `DEPLOY.md`: how to set each one, the webhook addresses to give the calling and messaging companies, and how to create the private recordings bucket — for someone who doesn't use a terminal.
- `docs/calling-vendor-checklist.md`: what the code needs from the calling company — agent leg as an ordinary mobile number, customer sees only the company number, recording, call-status webhook with the fields in `CallStatusEvent`, 140/1600 number series — so the Exotel vs Tata choice can be checked against it.
- Tests: the deployment-config test checks the new variables.

### [ ] Task 8 — A login limit per internet connection
**Branch:** `phase-11/task-8-login-ip-limit` · **No migration**

**Acceptance:**
- Add a second, higher limit on `POST /auth/login` and `POST /auth/login/verify-code` per internet connection across all staff codes: 60 attempts a minute, as a named constant. The existing per-staff-code limit stays.
- Uses the request IP as resolved by `common/http/trust-proxy.ts`.
- Tests: 61 attempts from one connection across different staff codes are refused; 20 agents logging in once each from one office connection all succeed.

---

## Phase 11 Gate

- [ ] Call status, answered and duration come only from the provider webhook; repeats change nothing — by test
- [ ] Every completed call's recording is copied into Laboura's storage; only Team Lead, Manager and CEO can listen; every listen is audited — by test
- [ ] Every SMS and WhatsApp goes through `MessagingService` and is logged without its body — by test
- [ ] Call agents, field agents and team leads never see a full phone number; `callRoutingPhone` is encrypted and never returned — by test
- [ ] Calls are placed with no numbers in the request; outside calling hours or the candidate's window they are refused; the raw-number endpoint is gone — by test
- [ ] Contact attempts are created only by the system; no role can type one — by test
- [ ] The announcement says "This call is recorded for quality and service." — by test
- [ ] Login is limited per connection as well as per staff code — by test
- [ ] **End-to-end proof, recorded in the report:** a call agent with a routing phone set calls a job seeker from the profile; the mock provider sends "no answer" in the morning and again in the evening; a WhatsApp goes out the same day; the sweep records one hit; a third call is answered and the agent records "interested"; a Team Lead listens to the recording and the listen is audited; the agent's API responses never contained a full phone number.
- [ ] All earlier phase gate items still pass; CI green on `main`; every task branch was green before merging; `LESSONS.md` updated

**When the gate passes: stop and report to Agastya.** Commits, CI links, test counts, one line per task, and the end-to-end proof. Do not start the next phase.
