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