# LESSONS.md

Known bugs and their fixes. **Search this file before fixing any error.**
Append a new entry after solving any non-obvious problem.

Format:

```
## <short description of the error>
**Symptom:** what you saw
**Cause:** what was actually wrong
**Fix:** what resolved it
```

## Concurrent Jest test execution against shared PostgreSQL database
**Symptom:** In CI, `seed.spec.ts` and `walking-skeleton.spec.ts` failed intermittently with count mismatches (`Expected: 6, Received: 7` and `Expected length: 0, Received length: 3`).
**Cause:** Jest runs test suites in parallel worker processes by default. Multiple test suites reading, writing, and clearing tables in the same database concurrently clobbered each other's data mid-test.
**Fix:** Added `--runInBand` to Jest test script in `package.json` so integration test suites run sequentially against the database, scoped seed idempotency counts to seeded record keys, and ensured `beforeEach` in `walking-skeleton.spec.ts` resets table state before asserting empty list.

## Node.js process.env string coercion of undefined in tests
**Symptom:** Restoring an environment variable with `process.env.VAR = originalVar` caused tests expecting unset/default values to see the literal string `"undefined"`.
**Cause:** In Node.js, `process.env` converts any assigned non-string value to its string representation; setting `undefined` assigns `"undefined"` instead of deleting the property.
**Fix:** In test teardowns, check `if (originalVar === undefined) { delete process.env.VAR; } else { process.env.VAR = originalVar; }` and defensively check `val && val !== 'undefined'` in code reading env variables.

## PostgreSQL sequence collision between seed data and sequential ID generation
**Symptom:** In CI, `seed.spec.ts` and `id.service.spec.ts` failed with unique constraint violations on human-readable code columns (e.g., `Unique constraint failed on the fields: (code)` for `BZ-00001` or `RF-00001`).
**Cause:** `prisma/seed.ts` inserted static codes (`BZ-00001`..`00003`, `JS-00001`..`00003`, `RF-00001`) into the tables directly without advancing the underlying PostgreSQL sequences (`seq_id_bz`, `seq_id_rf`, etc.). Subsequent tests invoking `idService.generateCode(...)` received `1` from `nextval`, colliding with already-inserted records. Additionally, upserting referrals by phone instead of code collided if code was already taken.
**Fix:** Added `syncAllSequences()` in `IdService` and at the end of `prisma/seed.ts` that dynamically queries `MAX(SUBSTRING(code FROM prefix_len)::int)` and calls `setval(seq, max_val, true)`. Changed referral upsert in seed to match on unique `code`.

## Payment entity code prefix in IdService
**Symptom:** Tests expecting payment human-readable codes to match `/^PM-\d{5}$/` fail with `PAY-00001` or similar.
**Cause:** In `src/common/id/id.service.ts`, `ENTITY_PREFIXES.payment` is mapped to `'PAY'`, not `'PM'`.
**Fix:** Always use prefix `'PAY'` when asserting or checking human-readable payment codes (e.g. `/^PAY-\d{5}$/`).

## Target identification in integration tests on shared DB state
**Symptom:** In `seed.spec.ts`, `findFirst({ where: { geofenceFlag: true } })` returned a business from an earlier test (`BZ-00005`) instead of the seeded business (`BZ-00003`).
**Cause:** Previous test suites create test fixtures with matching flags that remain in the local database.
**Fix:** Always query by unique code (e.g. `findUnique({ where: { code: 'BZ-00003' } })`) when asserting on seeded or fixture-specific records.

## Priority dashboard matching requires mutual trade and salary coverage
**Symptom:** A vacancy created in tests for an area did not appear in the dashboard opportunities.
**Cause:** Priority dashboard returns *matching opportunities* between open vacancies and active candidates. If no test candidate has a stated salary range covering the vacancy's `offeredSalary`, 0 opportunities are produced for that vacancy.
**Fix:** Ensure test vacancies specify an `offeredSalary` within the range of at least one active test candidate with matching `tradeSkill`.

## Foreign key constraints when clearing or tearing down JobSeeker and Placement records
**Symptom:** In `walking-skeleton.spec.ts` or test teardown, `prisma.jobSeeker.deleteMany({})` failed with `Foreign key constraint violated on the constraint: Placement_jobSeekerId_fkey` or `Placement_vacancyId_fkey`.
**Cause:** `Placement` has `onDelete: Restrict` relationships with `JobSeeker` and `Vacancy`, while `Vacancy.replacementForPlacementId` references `Placement`. Deleting `JobSeeker` or `Vacancy` while `Placement` rows exist violates foreign key constraints.
**Fix:** Before deleting `JobSeeker`, delete or clear dependent `Placement` rows (or unlink `replacementForPlacementId` first, then delete `Placement`, then `Vacancy` and `JobSeeker`). When clearing tables in `walking-skeleton.spec.ts`, delete `Placement` before `JobSeeker`, and re-run `await seed(prisma)` in `afterAll` so seeded state remains intact for subsequent suites.

## TypeScript control-flow type narrowing with string union statuses
**Symptom:** In `placement.service.ts`, `placement.status === 'replaced'` caused compilation error `TS2367: This comparison appears to be unintentional because the types '"dropped_out"' and '"replaced"' have no overlap.`
**Cause:** An earlier guard `if (placement.status !== 'dropped_out')` narrowed the type of `placement.status` to the literal `'dropped_out'`. Checking for any other literal value downstream is caught by TypeScript's strict type checker as impossible code.
**Fix:** Check replacement status on the child relation records (`replacementCandidates.some(rc => rc.status === 'accepted')`) rather than redundantly checking the narrowed parent status.

## Flat 100% refund rule after day 15 replaces tapered ladder
**Symptom:** Ambiguity between a 4-tier tapered refund ladder (100%/50%/25%/0%) and the locked business rule for placement replacement guarantee.
**Cause:** Initial drafts had conflicting specifications between a tapered ladder and a flat search window.
**Fix:** Business refund rule locked on 2026-10-20: Before day 15 (`daysElapsed < 15`), 0 cash refund is payable (searching for free replacement). From day 15 onward (`daysElapsed >= 15`), flat 100% refund of placement fee is payable with no tapering.

## Shared DB payment code format validation across test suites
**Symptom:** `phase-5-rbac-seed.spec.ts` failed asserting `expect(payment.code).toMatch(/^PAY-\d{5}$/)` when payments were created in previous tests using arbitrary test prefixes like `PAY-TEST-...` or `PAY-ACT-...`.
**Cause:** `phase-5-rbac-seed.spec.ts` iterates across all payments in the database (via `GET /payments`) and verifies that every payment has a valid human-readable code matching `^PAY-\d{5}$`.
**Fix:** Always generate payment codes in integration tests and services using `idService.generateCode('payment')` or seed with sequential zero-padded codes (`PAY-00001`, `PAY-00002`).

## Prisma schema relation naming between Referral and JobSeeker
**Symptom:** In TypeScript compilation for seed assertions, accessing `referral.candidates` failed with `TS2353: Object literal may only specify known properties, and 'candidates' does not exist in type 'ReferralInclude<DefaultArgs>'`.
**Cause:** In `prisma/schema.prisma`, the relation from `Referral` to `JobSeeker` is named `jobSeekers`, while on `JobSeeker` the relation back is `referredBy`.
**Fix:** Use `referral.jobSeekers` (and include `jobSeekers: true`) when querying candidates referred by a referral partner.

## Licensed OVSE Aadhaar e-KYC response sanitization (AGENTS.md §2 rule 3)
**Symptom:** Vendor APIs often return raw Aadhaar numbers, masked formats, or full demographic JSON in response payloads.
**Cause:** OVSE vendor responses echo the full citizen record on successful verification. Saving this raw response directly into the database violates the strict "Never store a raw Aadhaar number" legal rule.
**Fix:** In `RealKycProvider`, explicitly construct the return object with only `{ status, vendorReference }`, and never persist raw vendor response payloads into database columns or audit logs.

## DPDP Act (2023) §5 consent check before call recording retention
**Symptom:** Inbound calls with recordings were automatically granted consent and retained even when no affirmative consent was recorded.
**Cause:** Checking `event.recordingConsent !== false` inverted the legal default. In real vendor webhooks, `recordingConsent` is absent/undefined; treating absence as non-denial allowed bare recordings to manufacture `dpdp_consent.recorded` audit logs and retain recordings without consent.
**Fix:** Enforce an affirmative verification rule: `const isConsentLogged = event.recordingConsent === true`. Default is strictly unconsented. Discard `recordingUrl` (store as `null`) whenever an affirmative consent-confirmed signal is absent, and only retain recording URLs when explicit consent is present.

## Concurrent load testing harness teardown & connection pool sizing
**Symptom:** Running 40 concurrent staff sessions caused `ECONNRESET` or high query queue latencies (>10s), while subsequent test suites failed on un-isolated payment codes (`PAY-LOAD-XXXXX`) or stale audit logs.
**Cause:** 1) On 2-core hosts, Prisma's connection pool defaults to 5 connections (`num_cpus * 2 + 1`), creating severe queueing under 40 simultaneous sessions. 2) Supertest against in-memory HTTP servers without bound TCP sockets resets under burst socket exhaustion. 3) Deleting parent entities in `afterAll` does not delete `AuditLog` rows whose `actorId` is an unconstrained string, leaving stale audit logs that cause subsequent tests without `orderBy: { createdAt: 'desc' }` to inspect outdated records.
**Fix:** 1) Set `connection_limit=30` in `DATABASE_URL`. 2) Bind application to ephemeral port (`app.listen(0)`) and target real TCP socket (`request(baseUrl)`). 3) In load test teardowns, explicitly delete created `AuditLog` rows (`where: { actorId: { in: createdStaffIds } }`) alongside payments and staff, and use `idService.generateCode('payment')` for test payments.

## Express response object circularity with NestJS recursive interceptors
**Symptom:** `RangeError: Maximum call stack size exceeded` occurred when hitting controller endpoints using `@Res() res: Response` alongside interceptors like `PiiMaskingInterceptor`.
**Cause:** When a controller method injects `@Res() res` and calls `return res.send(...)`, Express returns the `ServerResponse` instance. Because Express `Response` objects have circular references (`res.req`, `res.socket`), any recursive payload traverser (like PII masking interceptors) enters an infinite recursion loop.
**Fix:** 1) Add circular reference protection via `seen = new WeakSet<object>()` in any deep payload-transforming interceptor. 2) Use `@Res({ passthrough: true }) res: Response` in NestJS controllers so that method return values flow as standard response bodies rather than passing the circular Express response object through the interceptor pipeline.

## CI red on main after adding global throttling, TOTP and backup script
**Symptom:** `npm test` passed locally but CI failed 20 tests across 5 suites: "Nest can't resolve dependencies of the AuthThrottlerGuard (?, ...THROTTLER:MODULE_OPTIONS...)", "Nest can't resolve dependencies of the AuthService (PrismaService, JwtService, ?, AuditService)", and `pg_dump: database "laboura_dev" does not exist`.
**Cause:** (1) `OtpModule`'s controller uses `AuthThrottlerGuard`, whose `ThrottlerModule` lives in the `@Global()` `AuthModule`; specs that built `OtpModule` alone had no throttler options. (2) `AuthService` gained a `TotpService` dependency that `auth.spec.ts` did not provide. (3) `scripts/backup.sh` hardcoded `laboura_dev`, which exists locally but not in CI (`laboura_test`); the CI runner's default `pg_dump` is also older than the `postgres:17` service.
**Fix:** Import `AuthModule` in the specs that build `OtpModule`; provide `TotpService` in `auth.spec.ts`; `backup.sh` derives the database name from `DATABASE_URL` when `DB_NAME` is unset; the workflow installs the PostgreSQL 17 client.

## security-hardening session-revoke test failed intermittently in CI (401 instead of 200)
**Symptom:** `revoking a session ... invalidates token` failed once in CI with 401 on the first authenticated probe; the same commit passed on re-run and always passed locally.
**Cause:** Most likely a TOTP step-boundary race: `authenticator.check` has a zero-step window and login does a bcrypt compare between the spec generating a code and the server verifying it, so a code minted at the very end of a 30s step can expire mid-request. The spec also never asserted the login status, so the failure surfaced one call later as a confusing 401.
**Fix:** The spec's `stableTotp` helper waits for a fresh step when fewer than 5s remain, and the revoke test now asserts the login returned 200. Production TOTP verification is unchanged (still strict, no drift window).

## Staff creation would collide with seeded codes and mask itself as "duplicate email"
**Symptom:** The first `POST /staff` for a call/field agent would have been handed `CA-00001`/`FA-00001`, which the seed already owns, and the resulting Prisma `P2002` is easy to misreport as a duplicate email.
**Cause:** Staff codes come from per-prefix sequences, but `IdService.syncAllSequences` only advanced sequences for Business/JobSeeker/etc., not Staff, and other writers (seed, specs) insert hand-picked codes ahead of the sequence.
**Fix:** `syncAllSequences` now advances the CEO/MGR/TL/CA/FA/FIN sequences past existing `Staff.code` values, and `StaffService` retries with a fresh code only when the `P2002` target is `code` (a `email` target is a real 409; anything else is rethrown). A spec pre-occupies the next sequence value to cover it.

## prisma migrate dev refused to run: local DB had a migration this branch did not
**Symptom:** `prisma migrate dev` reported "applied to the database but missing from the local migrations directory" and offered `migrate reset`.
**Cause:** An earlier, never-pushed attempt at the same task had applied its own migration (with a plaintext `inviteToken` column) to the local dev database; the branch was then rebuilt from `main` without it.
**Fix:** Did not reset the database. Dropped only the four columns that attempt added and deleted its `_prisma_migrations` row inside one transaction, then generated the new migration with `prisma migrate diff --from-migrations ... --shadow-database-url <throwaway db> --script` (migrate dev needs a TTY) and applied it with `migrate deploy`.

## "Mandatory 2FA" was only enforced for accounts that had already enrolled
**Symptom:** A freshly invited staff member could log in with just a password and use the whole API until they got around to enrolling in TOTP.
**Cause:** `login` only demanded a code when `totpEnabled && totpSecret`; an unenrolled account has no secret, so it could not simply be required to send one, and the code path silently issued a normal token instead.
**Fix:** An unenrolled account still logs in with the password, but the token carries `scope: 'totp_setup'` and `JwtAuthGuard` (the one guard every authenticated route uses) rejects it with 403 unless the route is marked `@AllowTotpSetupScope()` (only `POST /staff/2fa/setup` and `/enable`). `totpEnabled` without a secret counts as unenrolled. `setupTotp` now refuses (409) on an enrolled account, otherwise a stolen session could re-run setup and turn 2FA off. Specs that need a full token log in via `enrolledLogin` (enrol + real code) and undo the enrolment afterwards so seeded dev accounts are not left with unknown secrets.

## Rate limiter keyed on a client-controlled X-Forwarded-For
**Symptom:** Sending a different fake `X-Forwarded-For` on each login/OTP request gave a fresh throttle bucket every time.
**Cause:** `AuthThrottlerGuard` (and the login controller, for the session IP) read the raw header ahead of `req.ip`. Render's proxy appends to a client-supplied header rather than replacing it, so everything left of the proxy's own entry is attacker-controlled.
**Fix:** Both use `req.ip` only. `TRUST_PROXY_HOPS` (default 0 = ignore the header) sets Express's `trust proxy` hop count at startup, so `req.ip` is the address the Nth trusted proxy saw. Invalid values fail startup. The hop count must match the real Render/Cloudflare path per environment; Render's docs do not state it, so verify it on the deployed service by logging raw headers once.

## 51 suites failed with P1001 after a host restart
**Symptom:** `npm test` went from 4 failing suites to 51 failing suites (332 tests) with no code change; `prisma migrate status` reported `P1001: Can't reach database server at localhost:5432`.
**Cause:** The `laboura-postgres` and `laboura-redis` containers had exited (code 255) when the host restarted; nothing restarts them. Almost every suite is DB-backed, so the whole suite fails at once, which looks like a regression but is an environment fault.
**Fix:** `docker start laboura-postgres laboura-redis` (data survives; do not recreate them). Check `npx prisma migrate status` before concluding a mass failure is a code problem, and read the exit code of `npm test` itself (a trailing `echo` or pipe hides it).

## Payout disbursement: check-then-act let two concurrent requests both reach the gateway
**Symptom:** Two simultaneous `disbursePayout` calls on one `pending` payment both called the provider and both succeeded (found by a throwaway probe during the go-live review; the existing tests were all sequential).
**Cause:** The service read `status === 'pending'`, called the provider, then wrote the result, with nothing claiming the row in between. The real provider also built `reference_id` from `Date.now()`, so the gateway could not dedupe the two attempts either.
**Fix:** Claim first with one conditional `updateMany` (`pending` → `processing`) and require `count === 1` before the provider call. `reference_id` and the `X-Payout-Idempotency` header are the payment's id and nothing else. If the provider throws, the payment stays in `processing` for a human to reconcile; it is never released to `pending`. The concurrency tests use a provider stub that sleeps so the race window is real, and were confirmed to fail without the fix.

## @nestjs/jwt ignores a per-call publicKey when the module has a secret
**Symptom:** Verifying a Cloudflare Access (RS256) token with `jwtService.verifyAsync(token, { publicKey, algorithms: ['RS256'] })` passed in a unit test using `new JwtService()` but failed for every genuine token inside the app.
**Cause:** `JwtService.getSecretKey` resolves `options.secret || this.options.secret || options.publicKey`. The app's `JwtModule` is registered with an HS256 `secret`, so that secret silently outranks the `publicKey` passed per call and Cloudflare's tokens were being checked against our own signing secret.
**Fix:** `CloudflareAccessVerifier` owns a bare `new JwtService()` (no module options) instead of injecting the app's. Unit tests must construct the verifier the way production does, and the HTTP-level test with a genuinely signed token is what caught it.

## A guard used via @UseGuards() needs its dependencies exported, not just provided
**Symptom:** After giving `CloudflareAccessGuard` a constructor dependency, every suite that imports `AppModule` failed with "Nest can't resolve dependencies of the CloudflareAccessGuard (?) ... CloudflareAccessVerifier ... in the ConsoleModule module", i.e. the app would not boot.
**Cause:** `@UseGuards(SomeGuard)` makes Nest instantiate the guard inside the module of the controller using it (`ConsoleModule`), so its dependencies must be visible there. The verifier was only in `AuthModule`'s `providers`.
**Fix:** Add it to `AuthModule`'s `exports` (the module is `@Global()`), next to the guard.

## Retry idempotency keys longer than RazorpayX's 36-character limit
**Symptom:** None yet, caught in review before any real payout: the retry key `<payment uuid>-r1` is 39 characters.
**Cause:** RazorpayX `X-Payout-Idempotency` keys must be 4-36 characters (letters, digits, hyphen, underscore, space). A 36-char UUID alone fits, so the first attempt worked and the bug would only have appeared on the first retry, as a gateway 4xx. The limit I had assumed (40, on `reference_id`) was not the binding one.
**Fix:** Attempt 1 is the payment id as is; later attempts are the id without hyphens (32 chars) plus `-r<n>` (35 max). `paymentIdFromReference` accepts both forms so webhooks for retried attempts still find their payment. Per RazorpayX docs a payout that comes back `failed` fails for every request with that key, so a retry must use a new key, whereas a payout still `processing` must NOT get a new key (it would create a duplicate), which is why `processing` is never retryable.

## Counting "processing" as paid, and a timeout as "failed"
**Symptom:** (Found in review before real mode went live.) A gateway reply of `processing` was stored as `succeeded`, and a network error as `failed`.
**Cause:** RazorpayX payouts are asynchronous: `processing` can last up to T+3 working days and end as `processed` or `reversed`, and a `processed` payout can still be reversed later. A timeout says nothing about whether the gateway created the payout. Recording the first as paid hides later failures; recording the second as failed invites a second payout.
**Fix:** Only `processed` is `succeeded`. In-flight and ambiguous outcomes stay `processing` until the signed payout webhook or a CEO/Manager manual resolution settles them. Only a definitive refusal (4xx, or a rejected/failed/cancelled status) is `failed`, and only that is retryable. Transitions live in one pure, exhaustively tested table (`payout-state.ts`).

## Prisma interactive transaction aborts after a caught unique violation
**Symptom:** Designing webhook de-duplication: inserting the event id inside a transaction and catching `P2002` would have poisoned the rest of the transaction.
**Cause:** In PostgreSQL a failed statement aborts the surrounding transaction; catching the error in JS does not un-abort it.
**Fix:** Insert with `createMany({ skipDuplicates: true })` (`ON CONFLICT DO NOTHING`) and check the inserted count. A concurrent twin blocks on the unique index until the first commits, then inserts 0 rows.

## Concurrency and race tests that cannot fail
**Symptom:** Mutation checks (deliberately removing `FOR UPDATE`, and a conditional-write guard) did not fail the tests meant to protect them, twice.
**Cause:** (1) supertest requests are lazy: nothing is sent until the request is awaited or `.then()` is called, so a "fire the request, then hold the lock" test sent it after the lock was released. (2) A race test that only produced an ambiguous result never reached the guarded write. (3) Timing-based races from outside the process are too narrow to hit reliably.
**Fix:** Start requests eagerly with `.then(r => r)` when ordering matters; make the lost-update test deterministic by holding the row lock in the test's own transaction; add a case that actually reaches the guarded statement (a stale `succeeded` over a webhook's `reversed`). Rule of thumb: after writing a concurrency test, remove the guard and watch it fail.

## New specs pass locally but fail in CI: they relied on staff rows left behind by other suites
**Symptom:** 6 tests in `payout-webhook.spec.ts` failed in CI (state changes correct, audit rows missing) while 552/552 passed locally.
**Cause:** System-driven audit entries (webhooks) are attributed to the CEO, or any staff row, because `AuditLog.actorId` is a foreign key to `Staff`. The spec created no staff. The local dev database is full of staff from earlier runs; CI's database is freshly migrated and empty, so no actor was found and the audit entry was silently skipped. A sibling spec (`payout-idempotency.spec.ts`) only passed in CI because suites earlier in the same run happened to leave a staff row behind.
**Fix:** Each spec creates the staff row it needs and removes it afterwards. `PaymentService` now logs an error when no actor can be found instead of skipping the audit entry silently. To reproduce CI before pushing: create a scratch database, `prisma migrate deploy` it, and run `npm test` with `DATABASE_URL` pointing at it (the old spec fails the same 6 tests there).

## Webhook signature verified over JSON.stringify(parsedBody) instead of the raw bytes
**Symptom:** None observed (found in review before real mode): the collection webhook (`POST /payments/webhook`, ₹499 activation and placement-fee payments) passed all tests, but those tests signed the same re-serialised string the code verified.
**Cause:** `RealPaymentProvider.verifyWebhook` computed its HMAC over `JSON.stringify(payload)` where `payload` was the already-parsed body. JSON does not round-trip byte-for-byte: key order, whitespace, escaped slashes (`\/`, as PHP's `json_encode` writes URLs, and Razorpay payment-link events contain URLs), unicode escapes and number formatting can all differ. A genuine event could fail verification and the payment would never be recorded. The tests could not catch it because the test and the code shared the same wrong assumption.
**Fix:** The controller passes `req.rawBody` (enabled in `main.ts`) down to the provider, which verifies the HMAC over those bytes and parses the body from the same bytes, so what is verified is what is acted on. A parsed object with no raw bytes is never verified, and the endpoint fails closed (400) when `rawBody` is missing. Tests use a body built to differ from its own re-serialisation (reordered keys, odd whitespace, `\/`, `₹`) and assert that property, so they cannot quietly stop being meaningful; three mutants (HMAC over a re-serialised copy, controller not passing the raw body, acting on a parsed copy) each fail a test.

## Suites that pass only after other suites have populated the database
**Symptom:** Two suites (`phase-5-rbac-seed`, and the real-webhook integration test) failed on an empty database but passed on the dev one, and passed in a full run until an unrelated change reordered the run.
**Cause:** Locally Jest runs previously-failed files first (its cache remembers them), so a few failing experiments are enough to move a suite ahead of the ones that created the data or staff rows it silently relied on. CI has no cache and orders by file size, so the dependency stays hidden until a new file shifts the order.
**Fix:** Each suite creates or seeds what it needs (`seed(prisma)` is idempotent; a CEO staff row for audit attribution). To check a change the way CI will see it: scratch database, `prisma migrate deploy`, run each suspect suite alone, then the full suite, both with the default cache and with `--cacheDirectory=<empty dir>`.

## Foreign key on AuditLog.actorId blocked bootstrap/system sentinel attribution
**Symptom:** Inserting an audit log with `actorId: 'bootstrap'` failed with PostgreSQL error `insert or update on table "AuditLog" violates foreign key constraint "AuditLog_actorId_fkey": Key (actorId)=(bootstrap) is not present in table "Staff"`.
**Cause:** `AuditLog.actorId` was constrained by a foreign key to `Staff.id` generated in the initial migration. When the database is unpopulated or actions are executed before a staff row exists (like the first-admin bootstrap endpoint), no staff row exists to satisfy the foreign key.
**Fix:** Added migration `20261028140000_allow_sentinel_audit_actor` that drops the `AuditLog_actorId_fkey` constraint while preserving the Prisma relation. Standard staff audit logs continue to store staff UUIDs and populate `actor` via LEFT JOIN, while bootstrap/system audit logs safely record `'bootstrap'` or `'system'` without failing.

## BullMQ scheduler registration hung process when Redis was unreachable
**Symptom:** Worker startup hung indefinitely when attempting to register a scheduled job against an offline or unreachable Redis instance.
**Cause:** BullMQ's default connection configuration disables retries per request (`maxRetriesPerRequest: null`) and queues commands offline while awaiting connection. Calling `await queue.upsertJobScheduler(...)` without connection timeout guards blocked the application bootstrap indefinitely. Furthermore, unhandled `'error'` events on the `Queue` instance emitted uncaught Node errors.
**Fix:** Added an `'error'` event listener to `getQueue()`, wrapped startup scheduler registration in `Promise.race` with a startup timeout (`REDIS_STARTUP_TIMEOUT_MS`, defaulting to 2000ms), and cleared the timeout in `.finally()` to prevent lingering timers in libuv. Added configurable `connectTimeout` and capped `retryStrategy` on Redis connections to ensure clean shutdown when Redis is unreachable.

## Passport JWTStrategy secret mismatch with JwtModule when process.env.JWT_SECRET is unset
**Symptom:** In unit/integration tests for protected endpoints, authenticated requests with validly signed JWTs failed with `401 Unauthorized`.
**Cause:** `JwtStrategy` reads its verification secret from `process.env.JWT_SECRET || 'dev_secret_key_change_in_production_min_32_chars'`. When a test registers `JwtModule.register({ secret: 'custom-secret' })` without setting `process.env.JWT_SECRET`, the token is signed with the custom secret but verified by Passport with the default fallback secret, causing silent authentication failure.
**Fix:** In isolated test suites mocking auth or testing guards, set `process.env.JWT_SECRET = customSecret` in `beforeAll` and restore it in `afterAll`, or sign test tokens using `process.env.JWT_SECRET || 'dev_secret_key_change_in_production_min_32_chars'`.

## BullMQ worker.close(force) default aborts in-flight jobs on SIGTERM
**Symptom:** When shutting down the worker service on deploy (Render SIGTERM), active background sweep jobs were abruptly killed mid-execution.
**Cause:** BullMQ's `worker.close(force = false)` defaults to waiting for running jobs (`whenCurrentJobsFinished(false)`). However, `NoPickupEvaluationJob.close(force = true)` defaulted `force` to `true`, and `onModuleDestroy()` called `await this.close()` without arguments, immediately forcing the worker offline instead of letting active sweeps conclude.
**Fix:** Changed `close(force = false)` default parameter to `false` and explicitly passed `false` in `onModuleDestroy()`, reserving `force = true` only for startup connection failure bailouts.

## Prisma schema migrations in dual-service Render blueprint
**Symptom:** Deploying to Render without schema migration produces a live API running against an empty database with zero tables.
**Cause:** Render does not run database migrations automatically. If migrations are run in the container startup script of both the web service and the background worker, concurrent deploys race on migration advisory locks.
**Fix:** Declared `preDeployCommand: npx prisma migrate deploy` on the `type: web` service only in `render.yaml`. Render executes this once per deploy in the runtime network before routing web traffic, halting deployment on failure, while the worker service omits `preDeployCommand` to eliminate race conditions.

## Coupling container health check (liveness) to external dependency reachability
**Symptom:** Deployments failed or containers entered restart loops when a transient external dependency (Postgres or Redis) was slow or temporarily unavailable during deployment.
**Cause:** Single `/health` endpoint checking both process liveness and external databases/queues. Orchestrators like Render kill containers when their health check fails, preventing pre-deploy migrations or worker contexts from recovering gracefully.
**Fix:** Split into two distinct endpoints: `GET /health` (cheap liveness returning static `{ status: 'ok' }` without checking dependencies, used by Render deploy/container probes) and `GET /health/ready` (fast readiness check testing Postgres and Redis with a 2-second timeout, returning 503 naming failed dependencies, used by monitoring and alerting).

## Circular staleness monitoring inside background worker processes
**Symptom:** A background worker process failure, OOM crash, or Redis disconnection resulted in complete silence rather than an alert, making a stalled job indistinguishable from a healthy system.
**Cause:** Scheduling the staleness check inside the same background worker that is being monitored. When the worker process dies, the watchdog dies with it.
**Fix:** Separated staleness evaluation into the always-on web service (`SweepMonitoringService`, gated on `PROCESS_ROLE !== 'worker'`), persisting sweep completions into a dedicated `JobRun` table and alert deduplication/recovery state into a `JobAlertState` table. If the sweep gap exceeds 36 hours, the web service dispatches a critical alert via `AlertService` with a 6-hour throttle, and sends a recovery notification once the sweep resumes.

## Replacement guarantee window evaluation and nullable placement joinedDate
**Symptom:** Evaluating a 60-day replacement guarantee window when `placement.joinedDate` is null could either throw a TypeError or silently permit out-of-guarantee dropout requests.
**Cause:** In `schema.prisma`, `Placement.joinedDate` is nullable (`DateTime?`). While active placements should have a recorded join date, legacy or inconsistent data records may omit it. Furthermore, confusing the candidate search clock pause (`clockPaused`) with the guarantee eligibility window risked incorrectly extending the 60-day replacement guarantee.
**Fix:** Checked `joinedDate` explicitly in `recordDropout`: if null, refused the dropout with a clear error message and recorded a `placement_dropout_refused` audit log. Positioned `replacementGuaranteeDeadline` and `isWithinReplacementGuarantee` alongside `refundGuaranteeDeadline` in `src/common/money/money.ts` using identical millisecond arithmetic (`60 * 24 * 60 * 60 * 1000`). Enforced strict boundary conditions (day 60 accepted, day 61 refused), proved clock pauses do not extend the guarantee, and preserved exemption for `business_breach`.

## Unbounded caller-supplied dropout dates and money-affecting refund triggers
**Symptom:** Call agents or field agents could supply arbitrary past or future dates for `dropoutReportedAt` on placement dropouts, which starts the 15-day cash-refund countdown.
**Cause:** `RecordDropoutDto.dropoutReportedAt` was accepted directly without verifying temporal ordering or origin. Backdating by 15 days immediately made cash refunds payable, creating a financial vulnerability. Furthermore, without recording whether the date was caller-supplied or server-defaulted, approvers could not verify whether a refund clock was started by manual input.
**Fix:** Treated `dropoutReportedAt` validation as an anti-fraud control: strictly refused future dates relative to server clock with zero tolerance (no grace period backdoor), refused dates earlier than `joinedDate` ("employee cannot leave before they started"), and cleanly composed messages so "before you started" (`DROPOUT_BEFORE_JOINED_DATE`), "guarantee expired" (`REPLACEMENT_GUARANTEE_EXPIRED`), and "future date" (`FUTURE_DROPOUT_DATE`) are unmistakably distinct. Added a `dropoutDateCallerSupplied` Boolean column on `Placement` via Prisma migration, recorded the flag on dropout and in audit logs, and surfaced it during refund review and approval (`approveRefund` response and audit trail).

## Shared refund eligibility logic vs duplicate listing implementations
**Symptom:** Listing due refunds separately from the approval endpoints risked diverging rules: a listing could present a candidate that approval would reject (wasted effort / customer conflict), or omit a candidate that approval would allow (missed refund guarantee liability).
**Cause:** Re-implementing multi-step domain rules (30-day window, offer_rejected hit, placement status, 15-day search window, replacement acceptance) in a listing service query separately from approval controllers.
**Fix:** Extracted pure domain evaluators (`evaluateJobSeekerRefundEligibility` and `evaluatePlacementRefundEligibility`) that enforce locked domain rules in lockstep for both approval endpoints and the `GET /refunds/due` listing. Executed queries set-based in bulk (resolving candidate hits, existing refund payments, and replacement candidate states in single queries rather than 2N loops), indexed `(status, paymentReceivedAt)` on `JobSeeker`, `(jobSeekerId, reason)` on `JobSeekerHit`, and `(status, eligibility)` on `Placement`. Computed values fresh on every request without cached flags, and ordered results longest-owed first.

## Fail-closed database seed guards and execution environment defaults
**Symptom:** The database seed script checked only `if (NODE_ENV === 'production')`, meaning any other environment string (such as `staging`, `prod`, or unset `undefined`) was allowed to run, risking seeding default public credentials and permanently disabling the CEO bootstrap endpoint.
**Cause:** Block-list instead of allow-list for destructive/administrative operations. Furthermore, running tests in CI without setting `NODE_ENV=test` relied on Jest defaults, and local `npm run seed` did not set `NODE_ENV=development`, causing fail-closed guards to block developers locally unless the npm script sets the environment variable.
**Fix:** Refactored `prisma/seed.ts` to enforce a strict allow-list: `assertSeedAllowed` refuses unless `NODE_ENV` is explicitly `'development'` or `'test'`, stating the exact value found in the error message. Updated `package.json` scripts (`"seed": "NODE_ENV=development ts-node prisma/seed.ts"` and `"prisma": { "seed": "NODE_ENV=development ts-node prisma/seed.ts" }`) and explicitly set `NODE_ENV: test` under CI's test workflow step.

## Prisma Payment model schema fields and test data consistency
**Symptom:** Integration specs creating activation payment records failed TypeScript compilation with `error TS2353: Object literal may only specify known properties, and 'paymentType' does not exist in type 'PaymentCreateInput'`.
**Cause:** In `prisma/schema.prisma`, the payment discriminator field is named `type` (not `paymentType`), and requires `gatewayReference`, `subjectType`, and `subjectId` relations.
**Fix:** Consistently populated `Payment` rows with `type: 'activation'`, unique `gatewayReference`, `subjectType: 'job_seeker'`, and `subjectId` (matching `jobSeekerId`), ensuring strict type checking and DB constraints pass cleanly across all test suites.

## applyTrustProxy expects INestApplication instance, not Express instance
**Symptom:** In test suite `beforeAll`, calling `applyTrustProxy(app.getHttpAdapter().getInstance())` threw `TypeError: app.getHttpAdapter is not a function`.
**Cause:** `applyTrustProxy`'s first argument is typed as `INestApplication` and internally invokes `app.getHttpAdapter().getInstance()`. Passing the Express instance directly resulted in `getInstance().getHttpAdapter()` being called.
**Fix:** Pass `app` directly with the desired hop count string: `applyTrustProxy(app, '1')`.

## Rate limiter bucket coupling across test suites on auth-adjacent endpoints
**Symptom:** Calling throttled endpoints (`POST /staff/:id/reissue-invite` or `POST /staff/:id/reactivate`) in integration tests intermittently failed with `429 Too Many Requests` (`Received: 429, Expected: 200`).
**Cause:** `AuthThrottlerGuard` buckets requests by client IP (derived from `req.ip` via trusted proxy). When multiple tests or assertions hit throttled endpoints without setting distinct `X-Forwarded-For` client IPs, they share the `127.0.0.1` bucket and exhaust the 5 requests/minute quota.
**Fix:** In test suites exercising throttled endpoints, enable trust proxy with `applyTrustProxy(app, '1')` and supply a unique simulated IP on each request via `.set('X-Forwarded-For', freshIp())`.

## Constant-time comparison of arbitrary-length secrets via SHA-256 digests
**Symptom:** Passing caller-supplied bootstrap secrets of varying lengths directly into `crypto.timingSafeEqual(bufA, bufB)` throws a `RangeError: Input buffers must have the same length` when lengths differ, leaking length metadata or crashing the request handler.
**Cause:** `timingSafeEqual` is strictly designed for fixed-length message authentication codes or pre-sized hashes; invoking it on arbitrary user strings requires equal byte length buffers.
**Fix:** Hash both candidate strings using SHA-256 (`createHash('sha256').update(s).digest()`) before invoking `timingSafeEqual(hashA, hashB)`. Both digests are fixed 32-byte buffers, eliminating the length constraint while preserving constant-time comparison without leaking length information.

## Call agent vacancy and placement scope alignment in RBAC_MATRIX
**Symptom:** In `src/common/rbac/rbac.types.ts`, `call_agent.vacancy` and `call_agent.placement` had `scope: 'own_captured'`, but `rbac.guard.ts` had no implementation for `'own_captured'` and silently evaluated it as allowed.
**Cause:** Historical RBAC declaration declared a phantom scope that was never enforced. Call agents require city-wide visibility over vacancies and placements to match candidates across Bengaluru, and existing test suites already asserted that call agents can read vacancies in any area.
**Fix:** Updated `RBAC_MATRIX` to set `scope: 'all'` for call agent vacancy and placement read/write operations, and removed `own_captured` from `AccessScope`. This documents existing behavior rather than widening access, as the guard previously fell through to true.

## Mid-month joiner target pro-rating, floor-to-zero semantics, and rate metric exemption
**Symptom:** Setting targets for mid-month joiners naively scaled all metrics (including rate ceilings like refund rates) or rounded to zero without distinguishing between an unmeasured period and a zero-expectation target.
**Cause:** Volume metrics (candidate activations, placements) scale with active days, but rate ceilings (refund rate) define quality ratios that become unreasonably strict if scaled down. Furthermore, rounding down fractional targets (via Math.floor) for late-month joiners can yield 0, which incorrectly reads in dashboards as expecting 0 performance rather than representing an unmeasured period.
**Fix:** Pro-rate volume targets using inclusive days worked: `factor = (daysInMonth - creationDay + 1) / daysInMonth`. Round with `Math.floor`, and if the resulting target is 0, return explicit state `status: 'not_measured'` with `isMeasured: false` and `effectiveTarget: null`. Rate ceiling metrics (`refundRate`) are explicitly marked `proRateable: false` and preserved unscaled.

## Call agent refund rate denominator cohort scoping and 30-day lag
**Symptom:** The monthly refund rate denominator in `CallAgentMetricsService` counted all historical candidate registrations (`paymentReceivedAt <= maxPaymentDate` with no lower bound), turning monthly targets into lifetime cumulative metrics that barely moved and permanently penalized agents for early cohorts.
**Cause:** Without a lower bound on `paymentReceivedAt`, all historical matured candidates were queried rather than the cohort whose 30-day refund guarantee window matured in that specific calendar month.
**Fix:** Scoped the denominator query to `paymentReceivedAt` between `startUtc - 30 days` and `endUtc - 30 days` using shared `REFUND_GUARANTEE_WINDOW_MS` (30 days). Documented the intentional 30-day lag: an agent's November refund rate measures the performance of their October registrations maturing in November. Added `MIN_REFUND_RATE_DENOMINATOR = 5` constant to prevent small-sample noise from triggering breach flags.

## Field agent metric timestamp scoping, revenue integrity, and 15-day margin protection
**Symptom:** Counting placements before business payment rewards work that produces no revenue; counting replacement vacancies filled after day 15 rewards placements that failed to protect company margin.
**Cause:** Placement closing is a dual-event milestone requiring both candidate joining and business placement fee collection. For replacement vacancies, AGENTS.md §6 mandates a flat 100% fee refund if no replacement is found within 15 days of dropout report; filling a replacement on day 16 provides zero margin protection against the cash refund.
**Fix:** In `FieldAgentMetricsService`, evaluated `placementsClosed` using the dual-event timestamp `max(joinedDate, paymentDate)` within the period boundary, strictly requiring both `joinedDate != null` and a completed/succeeded `placement_fee` payment. Enforced strict 15-calendar-day boundary (`diffMs <= REPLACEMENT_SEARCH_WINDOW_MS = 15 * 24 * 3600 * 1000`) from `dropoutReportedAt` for replacement vacancies filled inside 15 days. Deduplicated `repeatBusinesses` by returning distinct business codes where the business had an earlier joined placement (`priorPlacement.joinedDate < thisPlacement.joinedDate`).

## Replacement candidate acceptance timestamp for margin protection metrics
**Symptom:** A field agent who secured an accepted replacement candidate on day 10 received no metric credit if the candidate served notice and joined on day 18.
**Cause:** The original metric specification required the replacement placement to reach `joined` status within 15 days of `dropoutReportedAt`. However, under AGENTS.md §6 and `placement-refund-eligibility.ts`, the business's 100% refund guarantee is cancelled immediately when a replacement candidate is *accepted* (`status === 'accepted'`), protecting the placement margin. Notice periods frequently push candidate start dates past day 15. Furthermore, `ReplacementCandidate` lacked an `acceptedAt` timestamp column.
**Fix:** Added `acceptedAt DateTime?` to `ReplacementCandidate` via a migration, populated with `now` in `acceptReplacementCandidate`. Re-keyed the metric ("replacements secured inside 15 days") on `acceptedAt` falling within the 15-day search window from `dropoutReportedAt` (evaluated using shared `calculateDaysElapsed`, respecting `clockPaused` freeze). Historical rows with null `acceptedAt` are excluded under the honest-null rule.

## Money at risk approaching-only window filtering and duplication prevention
**Symptom:** If money-at-risk calculations naively included expired guarantee deadlines, the CEO would see the same rupee counted twice across management dashboards: once as "money at risk" and once on `GET /refunds/due`.
**Cause:** Money past deadline (candidate past 30 days, business replacement past 15 days) is already lost money owed to the customer, belonging strictly to refund settlement workflows.
**Fix:** In `MoneyAtRiskService`, strictly enforce `daysRemaining > 0` (`now < deadline`). Candidates are included only when active, eligible, and within the approaching window (`0 < daysRemaining <= CANDIDATE_AT_RISK_WINDOW_DAYS = 7`). Dropped-out placements with open replacement vacancies are included only when within their replacement window (`0 < daysRemaining <= PLACEMENT_AT_RISK_WINDOW_DAYS = 5`). Disqualified candidates (placed, 3 hits, deactivated) and non-refundable placements (clock paused >2 rejects, replacement already accepted, breach) are excluded via shared eligibility logic. Stored in integer paise throughout and never persisted in database columns.

## Target behind-pace and refund rate breach evaluation boundaries
**Symptom:** Evaluating agent pacing naively in the first week or across all metrics resulted in false-positive behind-pace flags for new hires or for agents with low refund rates.
**Cause:** (1) In the first 7 days of the month, small-sample variance makes performance numbers erratic; (2) Refund rate is a quality ceiling metric (`lower_is_better`), where scaling expected pace by elapsed days is mathematically meaningless and falsely penalizes low refund rates; (3) Small matured cohorts (< 5 candidates) in refund rate calculations trigger false breach alarms on single noise events.
**Fix:** (1) Introduced `BEHIND_PACE_START_DAY = 8` and `BEHIND_PACE_THRESHOLD = 0.8` in `target.constants.ts`. Pacing is only evaluated from day 8 onward in the business timezone (`Asia/Kolkata`); (2) Pacing applies strictly to `higher_is_better` metrics, scaling effective target by `(daysElapsed / daysInPeriod)` from the agent's start date; (3) Refund rate has a dedicated breach flag that requires `maturedCount >= MIN_REFUND_RATE_DENOMINATOR (5)` and `actualRate > effectiveTarget`. Unset or floor-to-zero targets (`not_targeted` or `not_measured`) are never flagged.

## Leaderboard participant filtering and target secrecy
**Symptom:** Displaying raw agent lists on competitive leaderboards risked showing newly created accounts at position 0/last place on day one, and displaying target numbers exposed pro-rated targets, making part-month joiners look artificially good or bad compared to full-month peers.
**Cause:** Without target filtering, any field agent in the database is ranked regardless of whether they were actively targeted in that period. Publishing target figures leaks individual scheduling and pro-rating arrangements.
**Fix:** In `LeaderboardService`, query and rank only field agents who have a `placementsClosed` target set for the evaluated period. Return `staffCode`, `name`, `placementsClosed`, and sequential 1-based `position`, deterministically breaking ties by `staffCode` ascending. Exclude all target figures (`target`, `effectiveTarget`) from the response.

## 2026-11-02 — AGENTS.md §1/§6/§7 replaced from the Master Guide
**Symptom:** AGENTS.md still carried old locked rules that the business had since updated, creating discrepancies between domain documentation and future requirements.
**Cause:** Business updates were codified in the Laboura Master Guide on 2 November 2026.
**Fix:** AGENTS.md §1/§6/§7 replaced from the Master Guide. Old rules that the code still follows are listed in specs/data-design.md §16; do not change existing behaviour to match the new rules unless your current task says so.

## Never inject a money or rule dependency as optional with a silent fallback
**Symptom:** Activation, refunds, and money at risk kept charging ₹499 and the 30/60/15-day windows after a CEO changed `PricingPolicy`, including when the database read failed. `499 * 100` slipped past the no-literal check.
**Cause:** `PricingService` was injected with `@Optional()`, and each caller caught a missing or failed read and substituted hard-coded amounts. `RefundModule` and `TargetModule` did not import `PricingModule`, so those screens never saw the policy row.
**Fix:** `PricingService` is a required dependency. A failed policy read throws. Refund amounts come from the stored activation payment when one exists. The literal check also rejects `499 * 100` and hard-coded rule numbers in services.

## Review flags missed the staff id and the area on the token
**Symptom:** `GET /review-flags` and resolve did not scope to a Team Lead's agents, and creating a business as a field agent returned 403 before a `gps_mismatch` flag could be raised. The review-flag controller also failed to compile.
**Cause:** The controller passed the JWT payload through as the actor and read `actor.id`, but the staff id is `payload.sub`. It imported `RolesGuard`, which is not a file in this repo; role checks go through `RbacGuard`. The field-agent test token omitted `area`, so the own-area check on business create rejected `body.area`. `ReviewFlagService` was also `@Optional()`, so a missing injection would skip the GPS flag.
**Fix:** Map `{ id: user.sub, role: user.role }`, guard the routes with `RbacGuard`, put the staff area on field-agent tokens, and inject `ReviewFlagService` as required so a GPS mismatch always raises `gps_mismatch`.

## Login code secret looks unset, then the module still starts
**Symptom:** Deleting `LOGIN_CODE_SECRET` and compiling `LoginCodeModule` succeeded, so the startup test did not fail.
**Cause:** Constructing `PrismaClient` loads `.env` and fills any variable that is missing. A deleted variable is missing, so the file put the secret back before the service constructor ran. An empty string is already set, and dotenv does not override it.
**Fix:** The startup test sets `LOGIN_CODE_SECRET` to `''` (and to a 10-character value) instead of deleting it. The code is the first six decimal digits of `HMAC-SHA256(LOGIN_CODE_SECRET, requestId)`. Wrong attempts are counted from `login_code.wrong_code` audit rows, because `LoginCodeRequest` has no attempt column.

## A frozen login clock expires the session against the wall clock
**Symptom:** A staff-code login returned a token, then the next request with that token was 401 "Session has expired". A `totp_setup` token was 401 instead of 403.
**Cause:** `AuthService` stamps `StaffSession.expiresAt` from `AuthClock`. `JwtStrategy` compared that timestamp with `new Date()`. Tests that freeze `AuthClock` in the past create a session that is already expired on the wall clock, so the strategy rejects the token before the scope guard can return 403.
**Fix:** `JwtStrategy` reads `AuthClock` for the expiry check. Construction tests pass an `AuthClock` as the second argument.

## The access-token expiry is not the session limit
**Symptom:** A live session died at 15 minutes, or a test that moved the clock past 60 idle minutes still accepted the session.
**Cause:** `StaffSession.expiresAt` is only the short access-token window. `POST /auth/refresh` moves that field and does not move `absoluteExpiresAt`. Idle is `lastActivityAt` plus `idleLogoutMinutes`. The hard stop is `absoluteExpiresAt`, set once at login. The JWT `exp` claim still uses the wall clock, so freezing `AuthClock` does not expire the access token.
**Fix:** `JwtStrategy` ends the session from `sessionLifetimeEnd` (`max_length` before `idle`, and only when now is strictly later). `lastActivityAt` is written from `AuthClock`, at most once a minute. Refresh re-signs the same session id and updates `expiresAt` only.

## Five wrong passwords are throttled before the lock can be seen
**Symptom:** The attempt after five wrong passwords returned 429, so the test never saw the locked-account message.
**Cause:** `POST /auth/login` allows 5 requests a minute for one staff code and one IP. With `TRUSTED_PROXY_HOPS` at 0, changing `X-Forwarded-For` does not change that bucket.
**Fix:** The lockout test sets the trusted hop count to 1 and sends each attempt from a different `X-Forwarded-For`. The fifth wrong password is still 401 and sets `lockedUntil`. The correct password during the lock is refused with the unlock time.

## A UUID can look like a 12-digit Aadhaar number
**Symptom:** `real-kyc.provider.spec.ts` failed with `Expected pattern: not /\b\d{12}\b/` on a job seeker row that stored no Aadhaar number.
**Cause:** The check serialised the whole row. A UUID's last group is 12 hex characters, and this row's id ended in `961206566506`.
**Fix:** Assert the id is a UUID, then scan every other field for a 12-digit number.

## The first authenticator code after a cold start can miss its window
**Symptom:** The first management login in a new Jest process returned 401. The same kind of login passed in a later test in that file.
**Cause:** TOTP uses real time, not `AuthClock`. A code generated before the app finished booting can fall outside the allowed window.
**Fix:** Use `stableTotpCode` from `src/test-support/enrolled-login-spec.ts`. If login is not 200, throw the status and body so a later 401 is not mistaken for a lockout.

## Supertest raw body for HMAC signature verification
**Symptom:** In integration tests targeting webhook endpoints with HMAC verification (`/telephony/webhook/call-status`), sending a `Buffer` via Supertest's `.send(buffer)` returned `401 "Unauthorized"`.
**Cause:** When `rawBody: true` is enabled in NestJS, Express's `json` body parser attaches `req.rawBody` when parsing incoming JSON string payloads. Passing a `Buffer` into `.send()` circumvents JSON parsing or fails to attach `req.rawBody` as expected by `callStatusSignatureMatches`.
**Fix:** Pass the serialized JSON string `raw = JSON.stringify(payload)` into `.send(raw)` with `'Content-Type': 'application/json'`, and calculate the HMAC signature over that exact string using `signCallStatusBody(raw, secret)`.

## Dual-bucket rate limiting with @nestjs/throttler
**Symptom:** Adding a global connection IP limit (60 req/min) collided with the per-staff-code login rate limit (5 req/min), either ignoring the staff identity or throttling legitimate office traffic from 20 agents on the same IP.
**Cause:** Default `generateKey` logic only produces a single cache key per request.
**Fix:** Configure named throttlers (`default` and `connection`) in `ThrottlerModule`, override `generateKey(context, suffix, name)` in `AuthThrottlerGuard` to branch based on `name === 'connection'`, and apply dual `@Throttle({ default: { limit: 5, ttl: 60000 }, connection: { limit: 60, ttl: 60000 } })` decorators on the target controller endpoints.

## Consent was not enforced on candidate shortlists and matching calls
**Symptom:** An active job seeker could appear in a vacancy shortlist or receive an offer/follow-up call without active consent.
**Cause:** The shortlist filtered only by status, trade and salary, while the call service checked access and call timing but not consent.
**Fix:** Filter vacancy shortlists by active `job_matching` consent; require `call_recording` consent before job seeker calls except `consent_explain`, and require `job_matching` for `offer`, `follow_up` and `interview_result` calls.

## Job seeker consent withdrawal endpoint is deferred
**Symptom:** Phase 12 has no job-seeker-facing, OTP-protected route for withdrawing consent.
**Cause:** Phase 12 defines `ConsentService.withdraw` but does not define a public withdrawal request flow, and job seekers do not have accounts.
**Fix:** The Phase 12 gate proof calls `ConsentService.withdraw` directly, as decided for this task. A job-seeker-facing OTP-protected withdrawal flow remains missing and is deferred to a later phase.

## Phase 13 business locality is entered by the agent beside GPS coordinates
**Symptom:** The business profile requires a locality value, but Phase 13 specifies no reverse-geocoding provider.
**Cause:** Matching and the map use GPS coordinates only; locality is a display field and no external geocoder is part of this phase.
**Fix:** The agent enters the locality name and the system stores it alongside the GPS coordinates. Do not add reverse geocoding in Phase 13.

## Prisma scalar-list fields use empty arrays for existing records
**Symptom:** Prisma rejects nullable scalar-list fields, while Phase 13 list columns must be available on existing rows.
**Cause:** PostgreSQL scalar lists cannot be optional in Prisma's data model.
**Fix:** Declare Phase 13 scalar-list columns as `String[] @default([])` and add them with an empty-array default so existing rows mean “nothing recorded”, not a guessed value. Use this pattern for later scalar-list columns too.

## Business agreements retain the GST rate used when sent
**Symptom:** Data-design §5 omitted `gstPercent`, while Phase 13 Task 4 requires every agreement price figure to remain fixed after signing.
**Cause:** The agreement field list missed the GST snapshot column.
**Fix:** Store `gstPercent` from `PricingService.current()` on `BusinessAgreement` at link time alongside the fee and no-bypass values.

## Phase 13 assigned visits are independent of legacy areas
**Symptom:** A field agent with a confirmed visit assignment could be blocked from recording the visit because the business and staff had different legacy `area` values.
**Cause:** The old `own_area` guard and service check predate Phase 13 assignments; the current phase removes area-based ownership in Task 6, and the confirmed assignment is the authorization for this visit.
**Fix:** An open assignment for the business and assigned agent authorizes owner OTP and visit completion regardless of area. Keep the assignment status and assignee checks server-side until Task 6 replaces the remaining area permissions with `own_account`.

## Phase 13 permissions resolve from business ownership, not area fields
**Symptom:** Field-agent access and candidate priority lists still depended on legacy staff or business `area`, while call and placement services enforced their own area checks separately from RBAC.
**Cause:** Authorization had been split between JWT area claims, controller guards, and service checks, so removing an area filter in one place could leave stale restrictions elsewhere.
**Fix:** Resolve business, vacancy, and placement writes through the linked business's `accountAgentId`; allow only the documented own-lead and open-assignment exceptions. Read access remains city-wide, and legacy area fields stay unused until their removal phase.

## Phase 13 visit assignment queues use scalar ownership fields
**Symptom:** A Team Lead visit queue query using presumed `Business.accountAgent` or `Business.leadCreatedByStaff` relations failed TypeScript compilation.
**Cause:** Those ownership fields are scalar IDs in the current schema and do not have Prisma relations to `Staff`.
**Fix:** Load the Team Lead's staff IDs, filter `VisitAssignment.business` by `accountAgentId` or `leadCreatedByStaffId`, and return only the business summary fields the console needs. Field agents see only assignments currently assigned to them.

## Consent withdrawal eligibility uses the current pricing window on the server
**Symptom:** A console needs to decide whether to show the consent withdrawal action, but must not duplicate the answered-call age rule.
**Cause:** `consentWithdrawalCallWindowMinutes` is configurable in `PricingPolicy`, and a browser-side literal can disagree with the server's eligibility check.
**Fix:** Ask the authenticated eligibility endpoint for the agent's current qualifying call; it uses `PricingService.current()` and returns only eligibility plus the call record ID. The withdrawal endpoint revalidates the same conditions at submission time.

## No-documents business approval needs a fresh answered verification call
**Symptom:** A business can have its visit, photo, owner OTP, and signed agreement complete while still being correctly refused at approval.
**Cause:** For a no-documents business, the approving Team Lead or manager must personally make an answered system call after the business reaches `pending_tl_check`.
**Fix:** Keep that call check tied to the latest `pending_tl_check` transition. A pre-visit or unanswered call does not satisfy the approval condition.

## Console route assertions must target the relevant screen handler
**Symptom:** CI failed a test that rejected `/candidates` anywhere in the Field Agent app after the shortlist moved to the paged endpoint.
**Cause:** The Priority Dashboard still has an unrelated `/priority/candidates` endpoint, so a whole-page substring assertion matched valid dashboard code.
**Fix:** Assert the shortlist route inside its loader or inspect only the rendered shortlist card handler; keep unrelated console routes out of the assertion.
















## Relative links sent outside the app
**Symptom:** Links sent by SMS contained only a path, so recipients could not open them directly.
**Cause:** Link generation used relative paths or an unset base URL fallback.
**Fix:** Build all externally sent links from the required `PUBLIC_APP_URL`; tests must assert the full absolute link, not just the path.

