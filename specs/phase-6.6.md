# Phase 6.6 — Access and Accounts

**Goal:** the Team Lead role becomes usable, Field Agents can find a candidate, nobody can be permanently locked out of their own account, and the CEO bootstrap endpoint is safe to expose on the public internet. At the end of this phase the system is safe to host.

**Why this is next:** the 2026-10-31 code review found that the permission matrix and the endpoint role lists disagree. The matrix grants Team Leads own-team access to seven resources; no endpoint serving those resources accepts the role, so a Team Lead can see less than the agents they supervise. The same review found there is no path back into a locked-out account — no password reset, no 2FA reset, no way to re-issue an expired invite, no reactivation — and that losing the sole CEO account locks everyone out at every level, because only a CEO can create a CEO and bootstrap refuses to run once any staff row exists. Phase 6.7 (targets) depends on Team Leads being able to see their team, and hosting depends on the bootstrap endpoint being safe, so this phase gates both.

**Out of scope for Phase 6.6 — do not build these:** the targets and achievements module (Phase 6.7, metric set already locked in the Playbook §2), the UI restyle, the native Field Agent app, the map view for field agents (deferred), real vendor credentials (leave on mock), any change to guarantee durations or refund amounts.

> Read `AGENTS.md` §7 (RBAC) and §3 before writing this phase. Read `LESSONS.md` first.
>
> **Scope discipline:** every task here either adds a role to an existing permitted list, or adds one narrowly-defined endpoint. No task in this phase should require new business logic. If one appears to, stop and ask before building it.

---

## Tasks

### [x] Task 1 — Open up the Team Lead role

**Acceptance:**
- `team_lead` is added to the permitted roles on the endpoints serving job seekers, referrals, businesses, vacancies, the priority dashboard, and the staff list
- The existing `own_team` scope in the RBAC matrix does the narrowing — **do not write new scoping logic**, and do not widen the matrix
- A Team Lead sees only their own team's agents and the records those agents own; another team's data is refused server-side, not hidden client-side
- Team Leads may **reassign** work between their own agents
- Team Leads may **not** create, deactivate, or retarget staff — those stay with Manager and CEO. Verify the existing `@RequireRoles('ceo', 'manager')` on staff create and deactivate is unchanged
- Test: a Team Lead can list their own team's agents and read a candidate their agent owns
- Test: a Team Lead is refused another team's agent, and refused staff creation and deactivation
- Test: a Team Lead cannot write a target (the resource exists in the matrix; the module arrives in Phase 6.7 — assert the role restriction now so it cannot be forgotten later)

---

### [x] Task 2 — Field Agent candidate & referral onboarding

**Acceptance:**
- Field Agents are granted the full onboarding tool for Job Seekers and Referrals:
  - **Job Seekers:** Add `field_agent` to:
    - `POST /job-seekers` (create)
    - `GET /job-seekers` and `GET /job-seekers/:id` (read)
    - `POST /job-seekers/:id/activation-payment` (the ₹499)
    - `POST /job-seekers/:id/kyc`
    - `POST /job-seekers/:id/contact-attempts` (Playbook non-response cycle includes field agent attempt)
    - `POST /job-seekers/:id/reactivate`
  - **Job Seeker Hits:** Add `field_agent` to `POST /job-seekers/:id/hits`, strictly restricted by reason:
    - A Field Agent **may** record `'offer_rejected'` and `'interview_no_show'` hits (both are personally witnessed as they arrange interviews)
    - A Field Agent **may NOT** record `'no_pickup'` hits (belongs only to the call team's phone cycle and automated sweep)
    - Refuse a Field Agent's `'no_pickup'` attempt with a message naming allowed reasons (`offer_rejected`, `interview_no_show`), and audit the refusal
  - **Referrals:** Add `field_agent` to create (`POST /referrals`) and read (`GET /referrals`, `GET /referrals/:id`)
- **Scope:**
  - Job seekers and referrals are **city-wide** (neither has an area column, only city)
  - Businesses and vacancies remain **area-scoped** for Field Agents
- **Anti-Fraud Note (Doc Comment):**
  - Candidate onboarding already carries mobile-number OTP verification, which is the control that makes field-agent candidate capture safe. Do not remove or weaken it, and do not add a bypass for field agents.
- Tests:
  - Field agent can create a job seeker, activate payment, submit KYC, log contact attempt, and reactivate
  - Field agent can create and read referrals
  - Field agent can read candidates outside their assigned business area (city-wide)
  - Field agent can record `'offer_rejected'` and `'interview_no_show'` hits
  - Field agent is refused (403) recording `'no_pickup'` hit, and the refusal is audited
  - Test each reason (`offer_rejected`, `interview_no_show`, `no_pickup`) against each role (`field_agent`, `call_agent`, `manager`, `ceo`) explicitly
  - Field agent is still refused a business outside their area, proving area scoping remains intact on businesses

---

### [x] Task 3 — Re-issue invite, and reactivate

**Acceptance:**
- `POST /staff/:id/reissue-invite` (ceo, manager — and CEO-only when the target is a `ceo` or `manager`, matching the existing creation rule) voids any existing invite and issues a fresh one-time token with the standard 72-hour TTL, returned exactly once
- Re-issuing sets the account's password to a hash of random bytes nobody knows, exactly as creation does, so the old password stops working the moment a new invite is issued
- Re-issuing **clears the TOTP enrolment** so the hire re-enrols on acceptance. This is what makes one endpoint solve forgotten passwords, lost phones and expired invites together
- `POST /staff/:id/reactivate` (ceo, manager — CEO-only for a `ceo` or `manager` target) returns a deactivated account to `active`. It does **not** restore sessions, and it does **not** restore a password — a reactivated account needs a fresh invite to be usable, so the two endpoints compose
- Both audited as sensitive writes with actor, timestamp and before/after
- Both throttled like the other auth-adjacent endpoints
- Re-issuing an invite to an already-active account is allowed — that is the password-reset case
- Test: after re-issue, the old password fails and the old TOTP code fails
- Test: after re-issue, the new token activates the account and forces 2FA enrolment
- Test: a Manager is refused re-issuing an invite to a CEO
- Test: a reactivated account cannot log in until a fresh invite is accepted

---

### [x] Task 4 — Harden the CEO bootstrap

**Acceptance:**
- `POST /staff/bootstrap` requires a `STAFF_BOOTSTRAP_SECRET` supplied in the request and compared against the environment variable of the same name, which `render.yaml` already declares with `generateValue: true`
- The comparison is constant-time, not `===`
- If the environment variable is unset or empty, the endpoint refuses outright rather than defaulting to open. **Fail closed** — an unconfigured deployment must not be an unprotected one
- A wrong secret returns the same generic refusal as an already-bootstrapped system, so an attacker cannot tell which condition they hit
- The existing protections are unchanged: table lock, conditional insert, `staff.count() === 0`, rate limiting, audit with the `bootstrap` sentinel actor
- **2FA moves to first-login enrolment.** Bootstrap no longer sets `totpEnabled: true` and no longer returns a secret. The new CEO logs in with their password, receives the restricted `totp_setup` scope exactly as an invited staff member does, and enrols with confirmation before anything is locked down
- Rationale to record in the doc comment: the repository is public, so the endpoint and its behaviour are documented to anyone. Between deployment and the real bootstrap call, whoever reaches it first becomes CEO. Separately, issuing the TOTP secret once at creation meant losing that response bricked the account with no recovery path
- Update `DEPLOY.md` with where to find the generated secret in the Render dashboard and how to pass it
- Test: no secret, wrong secret, and unset environment variable are each refused
- Test: the correct secret on an empty database creates the CEO with `totpEnabled: false`
- Test: that CEO's first login returns the `totp_setup` scope and cannot reach any other endpoint until enrolment completes

---

### [ ] Task 5 — Decide the `/field-agent` console guard

**Acceptance:**
- `/admin` and `/call-agent` sit behind `CloudflareAccessGuard`; `/field-agent` does not, which `AGENTS.md` §3/§7 records as a deliberate exemption because field agents reach it from phones outside the Cloudflare Access perimeter
- That reason disappears once the native app ships. Record the exemption's expiry condition explicitly in `AGENTS.md` next to the exemption itself, so it is revisited rather than inherited
- No code change to the guard in this phase — this task is a documentation decision, deliberately scoped as such
- Add it to the go-live checklist in the Playbook §8 as an item to confirm before launch

---

## Phase 6.6 Gate

- [x] A Team Lead can list their own team and read a candidate their agent owns, by test
- [x] A Team Lead is refused another team's data, staff creation, staff deactivation and target writes, by test
- [x] A Field Agent can create, read, activate, submit KYC, log contact attempts, reactivate job seekers and create/read referrals city-wide, by test
- [x] A Field Agent can record 'offer_rejected' and 'interview_no_show' hits, but is refused recording a 'no_pickup' hit (refusal audited), and each reason is explicitly tested against each role, by test
- [x] A Field Agent is still refused a business outside their area, by test
- [x] After an invite re-issue, the old password and the old TOTP code both fail, by test
- [x] After an invite re-issue, the new token activates the account and forces 2FA enrolment, by test
- [x] A Manager is refused re-issuing an invite to a CEO, by test
- [x] A reactivated account cannot log in until a fresh invite is accepted, by test
- [x] Bootstrap refuses with no secret, a wrong secret, and an unset environment variable, by test
- [x] Bootstrap with the correct secret creates a CEO with `totpEnabled: false`, whose first login returns the `totp_setup` scope and can reach nothing else, by test
- [ ] **End-to-end proof, recorded in the report:** bootstrap a CEO with the secret, enrol 2FA on first login, create a Team Lead and two agents under them, log in as the Team Lead and confirm they see their own team and are refused another's, then re-issue the Team Lead's invite and confirm their old credentials stop working and the new invite restores access.
- [ ] `AGENTS.md` records the `/field-agent` exemption's expiry condition
- [ ] All Phase 1–6.5 gate items still pass
- [ ] CI green on `main` — confirmed on GitHub Actions, not locally
- [ ] `LESSONS.md` updated

**When the gate passes: stop. Report to Agastya. Do not start Phase 6.7 or the UI restyle.**

---

## Notes for whoever builds this

**This phase should add almost no business logic.** Tasks 1 and 2 are adding role names to existing permitted lists and letting the existing scope logic do its work. If either turns into a substantial change, something has been misunderstood — stop and ask rather than building your way out of it.

**Task 4 changes how the very first login works.** Get the tests right before the implementation, because a mistake here is not discovered in CI — it is discovered when nobody can get into production.

**Verify against `origin/main`, not a local branch.** Confirm every commit is pushed and the GitHub Actions run for it is green. A local `npm test` pass is not evidence: the local environment has no PostgreSQL, so most suites fail there for reasons unrelated to the code.
