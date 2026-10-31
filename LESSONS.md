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

