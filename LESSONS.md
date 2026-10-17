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