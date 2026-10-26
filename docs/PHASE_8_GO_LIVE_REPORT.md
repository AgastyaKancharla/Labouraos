# Phase 8 — Go-Live Close-out Report (Task 8)

Run on `main` @ `0d6d781` plus the changes on branch `phase-8/task-8-golive-closeout`,
2026-10-26. Everything below was re-run in this pass, not recalled from earlier gates.

**Verdict: not ready for a go decision yet.** The code gates pass. There are
2 code-level blockers, 3 items only Agastya can close, and several
deployment/ops gaps. Task 8 is deliberately left unticked.

---

## 1. Full re-run of every phase gate (one pass, current tree)

| Check | Result |
| --- | --- |
| `npm test` | **exit 0 — 56/56 suites, 394/394 tests, 0 skipped/pending** |
| `npm run lint` | exit 0 |
| `tsc --noEmit` | exit 0 |
| CI on `main` (`gh run list`) | latest 4 runs green; the run before them (`e88eb88`) was red and was repaired by `62f148b` |
| Prisma migrations | "Database schema is up to date" |

Gate items for Phases 1–8 were mapped to named passing tests from the Jest JSON
output (each mapped item has ≥1 passing test, none failing). Boundaries the
spec demands are tested by name: refund flat rule at days 0, 10, 14, 15, 16, 30,
45, 61; job-seeker guarantee at days 29/30/31 (injectable clock); 3rd hit
deactivates + zeroes refund in one transaction; duplicate webhooks (activation,
placement fee, telephony, real-Razorpay shape) are no-ops; finance never sees
phone/KYC; 403 tests for call agent, field agent, finance, team lead.

Gate text that no longer matches reality (not rewritten, per history rule):

- `phase-1.md` still says refund ladder "100/50/25/0%". Superseded by the flat
  rule locked 2026-10-20 (`calculateRefund`, AGENTS §6); the test asserts the flat rule.
- `phase-1.md` says `grep Float prisma/schema.prisma` returns nothing. It returns
  4 lines: `latitude`/`longitude` on `Business` and `BusinessVisit`.
  Coordinates, not money; every money column is an integer.
- `AGENTS.md` §3 lists `/console/admin` and `/console/call-agent`. Those routes
  do not exist; the real routes are `/admin`, `/call-agent`, `/field-agent`.

## 2. Phase 8 gate items — evidence

| Item | Evidence |
| --- | --- |
| GST invoice = fee + GST | `gst-invoice.spec.ts` (7 tests, incl. uneven-salary paisa rounding) |
| DPDP erasure anonymizes only PII, audited | `dpdp-erasure.spec.ts` (10 tests, incl. RBAC denial) |
| No automatic retention job | `src/jobs/` = `no-pickup-evaluation.job.ts`, `jobs.module.ts` only; grep for retention/expire/purge/anonymi/erase/delete in `src/jobs` (non-spec): none |
| Placement export excludes PII | `placement-export.spec.ts` |
| Request ID traceable incl. inside a BullMQ job | `observability.spec.ts` ("BullMQ Job Request ID Threading") |
| Login/OTP rate limit → 429 | `security-hardening.spec.ts` §5; `trust-proxy.spec.ts` (limiter not keyed on spoofable `X-Forwarded-For`) |
| TOTP 2FA, all roles, not SMS | `two-factor-enforcement.spec.ts`, `security-hardening.spec.ts` |
| Unrecognised Field Agent device needs step-up TOTP | `security-hardening.spec.ts` §2 (4 tests) |
| Revoked session dead on next request | `security-hardening.spec.ts` §3; `staff-management.spec.ts` |
| Cloudflare gates Admin + Call Agent only | `security-hardening.spec.ts` §4 and §4b (added in this task: `/call-agent` was ungated-by-test); `/field-agent` and API routes verified reachable without it |
| No MDM / IP allowlisting | grep of `src` for mdm / android enterprise / allowlist / whitelist: none |
| Backup restored once, sanity-checked | `docs/DISASTER_RECOVERY.md` §3 + `backup-restore.spec.ts` |
| New staff can't log in pre-invite; deactivated rejected | `staff-management.spec.ts` |
| No secrets committed | tracked files contain only `.env.example`; `.env` gitignored; no key patterns (`sk_live`, `rzp_live`, `AKIA…`, private keys, `xox*`, `AIza…`) in tracked files |

## 3. Blockers and risks (ranked)

### B1 — Real-mode payouts can double-pay. **Blocks `PAYMENT_PROVIDER_MODE=real` for payouts.**
Proven, not inferred: two concurrent `PaymentService.disbursePayout` calls on one
`pending` payment called the provider **twice** and both succeeded (throwaway probe,
not committed). Causes:
1. `disbursePayout` reads `status === 'pending'`, calls the provider, then writes — no atomic claim in between.
2. `RealPaymentProvider.disbursePayout` builds `reference_id` with `Date.now()`, so every attempt is a new reference, and no payout idempotency header is sent — the gateway cannot dedupe.
3. A network error returns `status: 'failed'` although the gateway may have accepted the payout; and `processing` is mapped to `succeeded`.
4. There is **no payout webhook handler**, so reversals/failures after acceptance are never reconciled. The Phase 7 gate item "duplicate payout webhook does not double-pay" is satisfied only vacuously.

This violates AGENTS §2 rule 7. Not fixed here: it is Phase 7 scope and touches money
flow, so §11 says ask first. Recommended fix: atomic claim
(`updateMany where status='pending' → 'processing'`, proceed only if count = 1), a
stable idempotency key derived from the payment id, treat `processing` as
non-final until a verified payout webhook arrives, add that webhook with a
double-delivery test.

### B2 — Cloudflare Access guard is a header-presence check, and off by default.
`CloudflareAccessGuard` passes if either `cf-access-jwt-assertion` or
`cf-access-authenticated-user-email` is present; it never verifies the JWT
signature/audience, and does nothing unless `CLOUDFLARE_ACCESS_ENFORCED=true`.
If the Render origin URL is reachable directly, anyone can forge the header.
Mitigation needed before launch: either validate the Access JWT against the team's
certs + AUD, or guarantee the origin only accepts Cloudflare traffic; and set the
env var in production. Note this only protects the HTML shells; the data is behind
JWT + RBAC + TOTP regardless, so impact is limited to the console pages being
reachable, not data exposure.

### B3 — Playbook §8 Go-Live Checklist was not available.
Not in the repo, and a Drive search for the Playbook returned nothing. I have **not**
walked it line by line and have not marked any of its items done. Needs the text from Agastya.

### B4 — Telephony concurrent-line capacity for 40 agents: UNVERIFIED.
Pending a real vendor contract; Phase 7 gate item stays unticked (manual sign-off).

### B5 — Dependency scan is not clean; exceptions need Agastya's acceptance.
Production (`npm audit --omit=dev`): was 6 high, now **5 high** after patching
`body-parser` 2.3.0→2.4.0 (lockfile only; reachable on every JSON request, non-breaking).
Remaining, proposed as accepted exceptions:

| Package | Advisory | Why proposed acceptable |
| --- | --- | --- |
| `multer`, `@nestjs/platform-express` | DoS via async `fileFilter` (GHSA-q7qp-rjg7-q26m) | no multipart/upload route exists in `src/`; fix is a framework downgrade/major |
| `prisma`, `@prisma/config`, `deepmerge-ts` | stack exhaustion merging recursive objects (GHSA-ggr8-5vv4-36mx) | CLI/config tooling, not a request path; fix is Prisma 7 (major) and AGENTS locks 6.19.3 — ask-first |

Dev-only findings (10 more: e.g. `picomatch`) are not shipped to production.

### B6 — Backups: platform side unverified, offsite script unscheduled.
- `scripts/backup.sh` is not invoked by any scheduler in the repo (no cron, no job, no workflow). The runbook calls it "automated"; it is not.
- Daily snapshots / PITR are claimed for Render Managed Postgres; retention depends on the Render plan and I can't verify it from here.
- The restore exercise ran against the local dev database (1075 `Staff` rows are test residue), not Render. The procedure is proven; the production backup source is not.

### B7 — Deployment config is not in the repo.
No `render.yaml` / Dockerfile. Production env (`JWT_SECRET`, `CLOUDFLARE_ACCESS_ENFORCED`,
`TRUST_PROXY_HOPS`, `*_PROVIDER_MODE`, GSTIN placeholders, `DATABASE_URL` with
`connection_limit`) lives only in the Render dashboard. `TRUST_PROXY_HOPS` must be
verified on the deployed service (LESSONS.md says so) or rate limiting will key on the
wrong address.

### B8 — Load-test report caveats.
Real run on this tree (40 concurrent staff, local 2-core host, Postgres in Docker):

| Group | n | p50 ms | p95 ms | p99 ms |
| --- | --- | --- | --- | --- |
| businessRegistration | 20 | 1332 | 1685 | 1685 |
| jobSeekerOnboarding | 20 | 682 | 908 | 908 |
| vacancyCapture | 20 | 763 | 1910 | 1910 |
| priorityDashboard | 20 | 1965 | 2730 | 2730 |
| uniqueIdGeneration | 4 | 204 | 892 | 892 |
| concurrentWebhooks | 1 | 1404 | 1404 | 1404 |

Caveats: in-process against a dev DB, **not the staging environment Task 1 asks for**;
one request per agent per group, so p95 = p99 ≈ max; the table's "Errors" column is
hardcoded to 0 (`calculatePercentiles`) — zero errors is still true because any non-2xx
inside the traffic loop fails the run, but it is not a measurement. A staging run
before launch is still outstanding. `priorityDashboard` (~2 s p50 under load) is the
slowest read and worth a look.

### B9 — Non-technical items: status unknown to me.
Company registration / real GSTIN (invoices use the placeholder env defaults), legal
review, vendor contracts and vendor selection. Need Agastya's confirmation; none are marked done here.

## 4. Open ticks

Task 8 and these Phase 8 gate items are intentionally **not** ticked: load-test
report reviewed on staging (B8), dependency scan (B5), Playbook §8 (B3), and
"all Phase 1–7 gate items still pass" (Phase 7's telephony sign-off, B4, is open).
