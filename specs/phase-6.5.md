# Phase 6.5 — Make It Run, and Close the Money Gaps

**Goal:** the system's one scheduled job actually runs in production, the API and the background worker deploy as separate services with configuration checked into the repo, and the three business-rule gaps that let money move incorrectly are closed. At the end of this phase the system is testable end to end by a human on a hosted environment.

**Why this is next:** Phases 1–8 built a complete system, but a code review on 2026-10-31 found that `NoPickupEvaluationJob.scheduleDailyJob()` has no call site anywhere in the repository — not in `src/`, not in any test. The BullMQ worker starts and listens to a queue that nothing ever fills. The entire 3-hit cycle, the deactivation it drives, and the refund entitlement that depends on both, therefore never advance on their own in production. Nothing else is worth testing until that is fixed, and it cannot even be tested manually today because no endpoint triggers the sweep. Alongside it, three guarantee rules are unenforced in ways that let money leave incorrectly.

**Out of scope for Phase 6.5 — do not build these:** agent targets and achievements (separate phase, metric set already locked in the Playbook §2), the native Field Agent app (its own phase, after Phase 7), real vendor credentials (Phase 7 already built the adapters — leave them on mock), the map view for field agents (deferred), any change to the refund amounts or guarantee durations themselves.

> Read `AGENTS.md` §1 (urgency sorting is not match scoring), §3 (mock/real provider switch), §6 (refund and guarantee rules) and §7 (RBAC) before writing this phase. Read `LESSONS.md` first.
>
> **Before starting:** this work branches from `main`. Fetch and check out `main` first — the working copy was last seen on `phase-8/task-10-bootstrap-and-2fa-login-ui` with a stale `origin/main` ref.

---

## Tasks

### [x] Task 1 — Schedule the no-pickup sweep so it actually runs

**Acceptance:**
- `scheduleDailyJob()` is called exactly once during worker application-context initialisation when `PROCESS_ROLE === 'worker'`, so the recurring BullMQ job scheduler is registered against Redis
- The existing tolerance for an unreachable Redis is preserved: a Redis failure at startup logs a warning and does not crash application context bootstrap
- Registration is idempotent: restarting the process does not create a second scheduler entry (BullMQ's `upsertJobScheduler` already gives this — prove it with a test that calls startup registration twice)
- Only the worker process registers the scheduler (gated on `PROCESS_ROLE === 'worker'`, see Task 3) — the HTTP process must not
- Default behaviour when `PROCESS_ROLE` is unset or not `'worker'` is safe: no scheduler registered
- Test: after worker startup registration, the queue reports a scheduler entry with pattern `0 0 * * *`
- Test: with Redis unreachable, worker startup completes and the warning is logged
- Test: with `PROCESS_ROLE` unset, no scheduler is registered

---

### [x] Task 2 — Manual trigger endpoint for the sweep

**Acceptance:**
- `POST /jobs/no-pickup-evaluation/run` (ceo only, protected by `@RequireRoles('ceo')` and `@RequirePermission('job_seeker', 'write')` per §7 — do NOT add a 'job' resource to the RBAC matrix) enqueues one immediate run by calling `triggerJob()`, and returns the enqueued job id
- `triggerJob()` is updated to return the enqueued job id; because BullMQ types `job.id` as `string | undefined`, handle it honestly without casting it away
- Audit logged as a sensitive write with actor and timestamp
- Rate-limited with `AuthThrottlerGuard` the same way the auth endpoints are, so it cannot be used to flood the queue
- This endpoint exists for two reasons that must both be stated in its doc comment: manual testing without waiting for midnight, and operational re-run after a failed sweep
- Test: a non-CEO role is refused; a CEO enqueues exactly one job and receives the job id; the audit row is written; excessive requests are rate-limited

---

### [x] Task 3 — Separate worker entrypoint, and stop the API constructing a worker

**Acceptance:**
- A new entrypoint `src/worker.ts` boots the Nest application context **without** an HTTP listener (`NestFactory.createApplicationContext`), and runs the jobs
- A `start:worker` script in `package.json` runs it in production (`node dist/worker`), plus a dev equivalent (`start:worker:dev`)
- `NoPickupEvaluationJob` constructs the BullMQ `Worker` **only** in the worker process, gated on `PROCESS_ROLE === 'worker'`, not in the HTTP process
- The HTTP process may still construct the `Queue` (Task 2's endpoint needs to enqueue), but never a `Worker` and never the scheduler
- Default behaviour when `PROCESS_ROLE` is absent or not `'worker'` must be the safe one: no worker, no scheduler — a misconfigured deploy should do nothing rather than silently duplicate work
- Test: with the flag unset, no `Worker` or scheduler is constructed; with it set to `worker`, exactly one worker and scheduler are registered
- Test: HTTP process bootstrap does not construct a `Worker`

---

### [x] Task 4 — Deployment configuration in the repo

**Acceptance:**
- `render.yaml` at the repo root declares two services from this one codebase: a web service running `start:prod`, and a background worker running `start:worker`
- Database schema migration: `prisma migrate deploy` is configured on the web service's pre-deploy step (`preDeployCommand: npx prisma migrate deploy`), guaranteeing migrations run automatically on every deploy before traffic is served, without running concurrently from the worker service
- Every environment variable each service needs is declared, including the Redis connection, the database URL, the mock/real provider switches (§3), the new `PROCESS_ROLE` (`web` for the web service, `worker` for the worker service), and the bootstrap secret added in a later batch — secrets declared as unset placeholders (`sync: false`), never with values committed
- The web service's health check path points at `/health`
- A clear `DEPLOY.md` records what has to be set by hand in the Render dashboard, Supabase, and Upstash, in what order, written for someone who does not use a terminal and assumes no command line
- No secrets, keys or connection strings are committed anywhere in this task

---

### [x] Task 5 — Honest health check and separate readiness probe

**Acceptance:**
- Split into two distinct endpoints:
  - `GET /health` stays cheap liveness with **NO dependency checks** (returns static `{ status: 'ok' }`). This is what Render's health check points at, so Render never gates a deploy or restarts a container on external dependency reachability.
  - NEW `GET /health/ready` checks PostgreSQL and Redis with a short timeout (2s), returning 200 only when both answer, and 503 otherwise naming which dependency failed. This is what monitoring and the Task 6 alert watch.
- Both endpoints stay cheap enough to be polled regularly — no table scans, no business queries
- The richer `GET /system/status` endpoint is left exactly as it is; `/health/ready` is the quick health probe
- Test: `GET /health` returns 200 without checking external dependencies
- Test: `GET /health/ready` returns 200 when dependencies answer; returns 503 naming Postgres when database is unreachable; returns 503 naming Redis when Redis is unreachable

---

### [ ] Task 6 — Alert when the sweep does not run

**Acceptance:**
- The completion of each sweep is recorded (timestamp and outcome) so a gap is detectable
- If more than 36 hours pass with no completed sweep, the existing `AlertService` raises an alert
- 36 hours rather than 24 so a single late or retried run does not cry wolf
- Test: with a recorded sweep older than the threshold, the alert fires; with a recent one, it does not
- Rationale to record in the doc comment: the defect this phase exists to fix was a job that silently never ran. A job that silently *stops* is the same failure, and should not be able to hide again.

---

### [ ] Task 7 — Enforce the 60-day replacement guarantee

**Acceptance:**
- `recordDropout` refuses a dropout whose `dropoutReportedAt` is more than 60 days after the placement's `joinedDate`, with a message naming the guarantee expiry date
- The guarantee window is a named constant alongside the other money rules, not an inline `60`
- A refused attempt is still audited, so repeat attempts by a business are visible
- Does not change behaviour for `business_breach` eligibility, which is already excluded from the refund remedy by §6
- Test: day 10 dropout accepted; day 70 dropout refused; day 60 exactly is accepted (boundary stated explicitly in the test name)

---

### [ ] Task 8 — Validate the caller-supplied dropout date and track origin

**Acceptance:**
- `recordDropout` refuses a `dropoutReportedAt` that is in the future, or earlier than the placement's `joinedDate`
- A Prisma migration adds a boolean flag on `Placement` (e.g. `dropoutDateCallerSupplied Boolean @default(false)`)
- The placement records whether the date was supplied by the caller (`true`) or defaulted to the server clock (`false`), and that flag is returned wherever a refund is reviewed, so the approver can see the 15-day clock was started from a date someone typed in
- Rationale to record in the doc comment: the 15-day cash-refund clock runs from this value, so an unbounded caller-supplied date is a money-affecting input. This belongs with the §4 anti-fraud controls, not with ordinary validation.
- Test: a future date is refused; a date before `joinedDate` is refused; an omitted date defaults to now and is flagged as server-defaulted (`dropoutDateCallerSupplied: false`)

---

### [ ] Task 9 — Refund-due listing

**Acceptance:**
- `GET /refunds/due` (finance, ceo, manager) returns both kinds in one response, each clearly typed:
  - job seekers past their 30-day deadline who are still entitled — excluding those placed, deactivated, or carrying an `offer_rejected` hit, matching the approval endpoint's existing checks exactly
  - placements past 15 days from `dropoutReportedAt` with no accepted replacement candidate, eligibility `employee_left`, and no refund already issued
- Each row carries the amount owed and how many days it has been owed, sorted longest-owed first
- **Computed fresh on every request, never stored as a flag or column** — the same rule the Priority Dashboard already follows, and for the same reason: eligibility turns over at midnight
- The eligibility logic is shared with the two approval endpoints rather than duplicated, so the list can never disagree with what approval will allow
- Finance's view masks PII exactly as the existing interceptor does elsewhere
- Test: a candidate at day 29 is absent, at day 31 is present, and disappears once refunded; a candidate who rejected a suitable offer never appears

---

### [ ] Task 10 — Tighten the seed guard

**Acceptance:**
- `prisma/seed.ts` refuses to run unless `NODE_ENV` is explicitly `development` or `test` — an allow-list, replacing the current check that only blocks the exact string `production`
- The refusal message states which value was found
- Rationale to record in the doc comment: the script creates admin accounts whose addresses are published in a public repository, and because the CEO bootstrap endpoint refuses to run once any staff row exists, seeding a live database would permanently disable the bootstrap path
- Test: `NODE_ENV` unset is refused; `staging` is refused; `development` and `test` are allowed

---

## Phase 6.5 Gate

- [ ] `scheduleDailyJob()` is called at startup in the worker process when `PROCESS_ROLE === 'worker'`, and a test proves a scheduler entry exists afterwards
- [ ] With Redis unreachable, the worker still starts and logs a warning, by test
- [ ] A CEO can trigger a sweep manually via `POST /jobs/no-pickup-evaluation/run`; a non-CEO cannot; both by test
- [ ] The HTTP process constructs no BullMQ `Worker`, by test
- [ ] With `PROCESS_ROLE` unset, neither a worker nor a scheduler is created, by test
- [ ] `render.yaml` declares both services with no committed secrets, and `DEPLOY.md` exists
- [ ] `/health` returns 200 without dependency checks, and `/health/ready` returns 503 when a dependency is unreachable, by test
- [ ] A sweep gap older than 36 hours raises an alert, by test
- [ ] A dropout at day 70 is refused and a dropout at day 60 is accepted, by test
- [ ] A future or pre-`joinedDate` dropout date is refused, and the caller-supplied origin flag on `Placement` is recorded via migration, by test
- [ ] `GET /refunds/due` returns both kinds, excludes every ineligible case the approval endpoints exclude, and shares its eligibility logic with them rather than duplicating it — by test
- [ ] Seeding is refused with `NODE_ENV` unset and with `staging`, by test
- [ ] **End-to-end proof, recorded in the report:** a job seeker is driven to three hits using only the manual trigger endpoint and logged contact attempts, is deactivated automatically, and correctly carries no refund entitlement. Running the sweep twice on the same day's data records no second hit.
- [ ] All Phase 1–8 gate items still pass
- [ ] CI green on `main` — confirmed by checking the GitHub Actions run, not by a local test run
- [ ] `LESSONS.md` updated

**When the gate passes: stop. Report to Agastya. Do not start the targets module or the native app.**

---

## Notes for whoever builds this

**Verify against `origin/main`, not a local branch.** Phase 6 was once reported complete while the work had never been pushed. Before reporting this phase done, confirm every commit is on `origin/main` and that the GitHub Actions run for that commit is green. A local `npm test` pass is not evidence — the local environment has no PostgreSQL running, so 428 of 576 tests fail there for reasons unrelated to the code.

**Do not widen scope.** Task 9 is a listing only. It is tempting to add the money-at-risk figure while in the same query, but that belongs with the targets module, which has its own locked design in the Playbook §2. Build the listing so the targets work can reuse it, and stop there.
