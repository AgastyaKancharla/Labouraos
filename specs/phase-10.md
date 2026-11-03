# Phase 10 — Login and Devices

**Goal:** staff log in the way the Master Guide says: with their staff code, from an approved device, and — for everyone below management — with a one-time code that a Team Lead, Manager or the CEO reveals on the login code screen. Sessions end after 1 hour idle or 2 hours at most, only one login is open at a time, and 5 wrong passwords lock the account.

**Why this is next:** it is step 2 of the build order in `specs/data-design.md` §16. Login is the front door; every later phase assumes it.

**Read first:** `AGENTS.md` (especially §7 "Login"), `LESSONS.md`, this whole spec, and `specs/data-design.md` §3. Every number (60, 120, 5, 15, 5) comes from `PricingService.current()`: `idleLogoutMinutes`, `maxSessionMinutes`, `loginCodeValidMinutes`, `failedLoginLimit`, `lockoutMinutes`. Never type them in.

**Out of scope — do not build:** anything about calling, `callRoutingPhone`, job seekers, businesses, placements, payments, the field agent native app, or the Command Center restyle. Cloudflare Access and the `/field-agent` console exemption stay exactly as they are.

---

## How this phase runs — waves

Tasks in the same wave touch different files and can run **at the same time, one agent each**. Waves run in order.

| Wave | Tasks | Run |
| --- | --- | --- |
| 1 | Task 1 (devices), Task 2 (office networks), Task 3 (login code engine) | **Together**, 3 agents |
| 2 | Task 4 (the new login flow) | Alone |
| 3 | Task 5 (sessions, lockout, lock and unlock) | Alone |
| 4 | Task 6 (screens), Task 7 (deployment, seed, rulebook) | **Together**, 2 agents |

**Rules for agents running at the same time:**
1. Each agent works in **its own git worktree** (its own folder), created from the latest `main`, on its own branch. Never work in the shared main folder.
2. Each task adds its own migration with the **fixed folder name given in the task**, so they never clash.
3. Agents **do not merge**. Each pushes its branch, waits for GitHub Actions to pass on the branch, and reports. Merging is done afterwards, one branch at a time, in task-number order: rebase on the latest `main`, wait for green again, then merge.
4. If two tasks both add to `prisma/schema.prisma`, the rebase may show a conflict there. Keep both additions.

---

## Wave 1 — together

### [x] Task 1 — Approved devices (data and approval, no login change yet)
**Branch:** `phase-10/task-1-staff-devices` · **Migration folder:** `20261103100000_add_staff_devices`

**Acceptance:**
- `StaffDevice` table exactly as `specs/data-design.md` §3.
- The migration copies each existing `Staff.registeredDeviceId` into `StaffDevice` as `approved` (approved by null = migrated). `registeredDeviceId` is marked deprecated in a schema comment but not removed.
- A `StaffDeviceService` with `findApproved(staffId, deviceId)`, `requestApproval(staffId, deviceId, label, platform)` (idempotent: the same device twice is one pending row), `approve`, `revoke`, `listPending(approver)`.
- **Who approves:** a Team Lead for their own team (`teamLeadId`); a Manager for anyone below Manager; the CEO for anyone. **Nobody approves their own device.** CEO, Manager and Finance devices are not approved by others — see Task 4.
- Endpoints, all audited: `GET /staff/devices/pending` (scoped as above), `POST /staff/devices/:id/approve`, `POST /staff/devices/:id/revoke`, `GET /staff/:id/devices` (the staff member themself, their Team Lead, Manager, CEO).
- Revoking a device ends every open session that used it.
- Tests: a Team Lead approves their own agent's device and is refused another team's; nobody can approve their own; a revoked device's sessions end; the migration carries an existing registered device over as approved.

### [x] Task 2 — Office networks (data and check, no login change yet)
**Branch:** `phase-10/task-2-office-networks` · **Migration folder:** `20261103110000_add_office_networks`

**Acceptance:**
- `OfficeNetwork` table and `Staff.worksFromOffice` (default false) exactly as `specs/data-design.md` §3.
- `OfficeNetworkService.isOnOfficeNetwork(ip)`: true if the address is inside any active range. Supports IPv4 and IPv6 CIDR. Uses the request IP as already resolved by `common/http/trust-proxy.ts` — never reads `X-Forwarded-For` directly.
- Endpoints, CEO and Manager only, audited: list, add, deactivate an office range; set `worksFromOffice` on a staff member.
- No ranges configured = nobody is treated as on the office network (fail closed). The office isn't open yet, so the default for every staff member stays `worksFromOffice = false`.
- Tests: an address inside a range matches and one outside doesn't; IPv6 works; a deactivated range no longer matches; a spoofed `X-Forwarded-For` beyond the trusted hop is ignored; Team Leads and agents are refused the endpoints.

### [x] Task 3 — Login code engine (codes, reveal, reports — no login change yet)
**Branch:** `phase-10/task-3-login-codes` · **Migration folder:** `20261103120000_add_login_code_requests`

**Acceptance:**
- `LoginCodeRequest` table exactly as `specs/data-design.md` §3.
- **The code is never stored.** It is the first 6 digits of `HMAC-SHA256(LOGIN_CODE_SECRET, requestId)`, computed when needed. `LOGIN_CODE_SECRET` is read through one function that refuses to start the server if it is missing or shorter than 32 characters (the same pattern as `JWT_SECRET`).
- `LoginCodeService`:
  - `create(staffId, staffDeviceId, ip, onOfficeNetwork)` → a `pending` request; `expiresAt` = now + `loginCodeValidMinutes`.
  - `listPending(approver)` — scoped like device approval (Team Lead: own team; Manager: anyone below Manager; CEO: anyone). **Never includes the approver's own requests.** Expired requests are shown as expired, not pending.
  - `reveal(requestId, approver)` → returns the code once per tap, sets `revealedByStaffId`/`revealedAt` the first time, audited every time.
  - `verify(requestId, code)` — constant-time; single use (`used`); refused if expired, refused, or already used; **5 wrong codes on one request** mark it `refused` with reason `too_many_wrong_codes`.
  - `refuse(requestId, approver, reason)`.
- Codes are only for `team_lead`, `call_agent` and `field_agent`. A Team Lead's code is revealed by a Manager or the CEO.
- Endpoints, audited: `GET /login-codes/pending`, `POST /login-codes/:id/reveal`, `POST /login-codes/:id/refuse`.
- **Report** `GET /login-codes/report?from=&to=` (Team Lead: own team; Manager, CEO: all): requests per staff member, codes revealed per approver, average wait from request to reveal, expired and refused counts, requests made between 22:00 and 06:00 IST.
- Tests: the stored row contains no code; reveal and verify agree; an expired, used or refused code fails; 5 wrong codes refuse the request; an approver never sees their own request; a Team Lead sees only their team; the server won't start without `LOGIN_CODE_SECRET`.

---

## Wave 2 — alone (after Tasks 1–3 are merged)

### [x] Task 4 — The new login flow
**Branch:** `phase-10/task-4-login-flow` · **Migration folder:** `20261103130000_staff_email_optional`

**Acceptance:**
- **Staff code login.** `POST /auth/login` takes `staffCode`, `password`, `deviceId` (required for everyone) and, for management, `totpCode`. Staff codes match case-insensitively. Email is no longer a login identifier.
- **Email becomes optional:** `Staff.email` nullable. Creating or inviting a `ceo`, `manager` or `finance` requires an email; other roles may have none.
- **Order of checks**, each with a clear refusal message: account exists and password matches (same message for both, so codes can't be guessed) → account `active` → **device** → **office network** (only if `worksFromOffice`) → second step.
- **Device check, every role:**
  - `team_lead`, `call_agent`, `field_agent`: if the device isn't approved, a pending `StaffDevice` request is created (Task 1) and login is refused with "This device is waiting for approval by your Team Lead".
  - `ceo`, `manager`, `finance`: a new device is approved by entering a valid TOTP code on it — recorded as self-approved by TOTP and audited. A management account that hasn't enrolled TOTP yet (just bootstrapped or invited) gets the existing restricted `totp_setup` token, and the device is approved when enrolment completes.
- **Second step:**
  - Management: TOTP, exactly as today.
  - Everyone else: no TOTP. Login creates a `LoginCodeRequest` (Task 3) and returns `{ status: "awaiting_code", loginRequestId, expiresAt }` — **no token yet**. `POST /auth/login/verify-code` with `loginRequestId` and `code` then issues the session and token.
- **Odd-hour flag:** a login completed between 22:00 and 06:00 IST raises an `odd_hour_login` review flag for that staff member. Both hours are named constants.
- **Removed:** TOTP enrolment for non-management roles (their existing TOTP fields are ignored, not deleted), the field agent step-up TOTP, and the old field-agent-only device logic.
- The existing per-connection throttle on `/auth/login` keys on `staffCode` plus IP instead of email plus IP.
- Every login attempt — success, refusal and reason — is audited without personal data.
- Tests: staff code login works in any case; email login is refused; an agent on an unapproved device is refused and a pending device appears for their Team Lead; an agent on an approved device gets `awaiting_code`, and the right code from a Team Lead's reveal issues a token; a wrong code doesn't; a manager on a new device approves it with TOTP; a bootstrapped CEO can still enrol TOTP and get in; an office-only agent outside the office network is refused; a login at 23:00 IST raises the flag and one at 11:00 doesn't.

---

## Wave 3 — alone (after Task 4 is merged)

### [x] Task 5 — Sessions, lockout, lock and unlock
**Branch:** `phase-10/task-5-sessions-lockout` · **Migration folder:** `20261103140000_sessions_and_lockout`

**Acceptance — sessions:**
- `StaffSession` gets `lastActivityAt`, `absoluteExpiresAt`, `endedReason`, `loginCodeRequestId` (`specs/data-design.md` §3).
- **One login at a time:** issuing a new session ends every other open session of that staff member with `endedReason = replaced`.
- **Idle:** a request more than `idleLogoutMinutes` after `lastActivityAt` is refused and the session ended (`idle`). **Maximum:** no session is accepted after `absoluteExpiresAt` = login + `maxSessionMinutes` (`max_length`).
- `lastActivityAt` is updated on authenticated requests, at most once a minute per session.
- **Renewal:** access tokens stay short-lived. `POST /auth/refresh` returns a new access token while the session is valid; it never extends `absoluteExpiresAt`.
- `POST /auth/logout` ends the current session (`logout`).

**Acceptance — wrong passwords and locks:**
- `Staff` gets `failedLoginCount`, `lockedUntil`, `lockedByStaffId`, `lockedReason`.
- Counted **per account**: each wrong password adds 1; `failedLoginLimit` (5) wrong in a row sets `lockedUntil` = now + `lockoutMinutes` (15). A correct login resets the count. A locked account is refused with a message saying when it unlocks, even with the right password.
- `POST /staff/:id/unlock` — Team Lead (own team), Manager, CEO: clears the lock and the count. Audited.
- **One-tap lock** `POST /staff/:id/lock` with a reason — Manager or CEO: locks with no end time, ends every open session, audited. Only `unlock` reverses it.
- Tests: a second login ends the first session; an idle session older than 60 minutes is refused; a session older than 120 minutes is refused even when active; refresh doesn't extend the 120 minutes; logout ends the session; 5 wrong passwords lock for 15 minutes and the 6th attempt with the right password is refused; unlock lets them in; a Team Lead can't unlock another team; the one-tap lock ends live sessions at once.

---

## Wave 4 — together (after Task 5 is merged)

### [x] Task 6 — Login and approval screens
**Branch:** `phase-10/task-6-login-screens` · **No migration**

**Acceptance (in the existing server-rendered consoles; plain styling is fine — the Command Center restyle comes later):**
- **Login page:** staff code, password, device id generated once per browser and kept in local storage; then either a TOTP box (management) or an "Ask your Team Lead for your code" screen with a code box and a countdown to expiry.
- Tokens are kept in **session storage**, so closing the browser logs out. The page calls `/auth/refresh` before the token expires and returns to login when the session ends.
- **Login codes screen** (Team Lead, Manager, CEO): pending requests as cards — name, staff code, role, device label, office network yes/no, time — each with **Show code** and **Refuse**. Refreshes every 10 seconds.
- **Device approvals screen** (Team Lead, Manager, CEO): pending devices with Approve and Reject.
- **Staff list:** Unlock (Team Lead and above) and Lock with a reason (Manager, CEO).
- **Login code report** page for the report in Task 3.
- Tests: the existing console tests updated; each new screen renders for the allowed roles and is refused for others.

### [x] Task 7 — Deployment, seed and rulebook
**Branch:** `phase-10/task-7-deploy-seed-docs` · **No migration**

**Acceptance:**
- `render.yaml`: `LOGIN_CODE_SECRET` with `generateValue: true` on the web service, and shared with the worker the same way `JWT_SECRET` is.
- `DEPLOY.md`: where to find `LOGIN_CODE_SECRET`, how to add the office network range once the office opens, and how the first CEO logs in under the new flow — written for someone who doesn't use a terminal.
- `prisma/seed.ts` (development and test only): seeded staff log in by staff code; non-management seeded staff get an approved device id printed in the seed output, so local testing works.
- `AGENTS.md` §7: in "Login", remove the words "(target — built in the login phase; the current code still uses email + TOTP for everyone)". Change nothing else.
- Tests: the deployment-config test checks `LOGIN_CODE_SECRET`; the seed test logs in a seeded agent through the code flow.

---

## Phase 10 Gate

- [x] Staff log in with their staff code; email login is refused — by test
- [x] Every role needs an approved device; agents' devices are approved by their Team Lead, never by themselves; management approves a new device with TOTP — by test
- [x] Office-only staff are refused off the office network; with no ranges set, no one counts as on it — by test
- [x] Non-management logins need a revealed code; the code is never stored; 5 wrong codes refuse the request; approvers never see their own request — by test
- [x] The login code report returns the counts in Task 3 — by test
- [x] One session at a time; 60-minute idle and 120-minute maximum enforced; refresh never extends the maximum — by test
- [x] 5 wrong passwords lock for 15 minutes; Team Lead/Manager/CEO unlock; one-tap lock ends live sessions — by test
- [x] Logins between 22:00 and 06:00 IST raise a review flag — by test
- [x] Every number above comes from `PricingPolicy` — no literals (the Phase 9 literal check passes)
- [x] **End-to-end proof, recorded in the report:** bootstrap a CEO and enrol TOTP; create a Team Lead and a call agent under them; the agent tries to log in on a new device and is refused; the Team Lead approves the device; the agent logs in and waits for a code; the Team Lead reveals it; the agent enters it and is in; logging in again elsewhere ends the first session; 5 wrong passwords lock the agent; the Team Lead unlocks them; the report shows the request and who revealed it.
- [x] All earlier phase gate items still pass
- [x] CI green on `main`; every task branch was green before it was merged
- [x] `LESSONS.md` updated

**When the gate passes: stop and report to Agastya.** Commits, CI links, test counts, one line per task, and the end-to-end proof. Do not start the next phase.
