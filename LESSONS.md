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



