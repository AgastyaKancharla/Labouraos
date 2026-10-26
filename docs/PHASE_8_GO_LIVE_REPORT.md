# Phase 8 — Go-Live Close-out Report (Task 8)

Branch `phase-8/task-8-golive-closeout`, built on `main` @ `0d6d781`, 2026-10-26.
Everything below was re-run in this pass, not recalled from earlier gates.

**Verdict: not ready for a go decision yet, and not because of the code.** Both
code-level blockers found in the first pass are fixed (section 3). What remains is
business/vendor/legal setup (section 4, which is Agastya's), a few deployment and ops
gaps (section 5), and one real-money residual on payouts (R1). Task 8 stays unticked.

---

## 1. Full re-run of every phase gate (one pass, current tree)

| Check | Result |
| --- | --- |
| `npm test` | **exit 0: 58/58 suites, 421/421 tests, 0 skipped/pending** |
| `npm run lint` | exit 0 |
| `tsc --noEmit` | exit 0 |
| CI on `main` (`gh run list`) | latest runs green; the run before them (`e88eb88`) was red and was repaired by `62f148b` |
| Prisma migrations | "Database schema is up to date" |

Gate items for Phases 1–8 were mapped to named passing tests from the Jest JSON output
(each mapped item has at least one passing test, none failing). Boundaries the spec
demands are tested by name: refund flat rule at days 0, 10, 14, 15, 16, 30, 45, 61;
job-seeker guarantee at days 29/30/31 (injectable clock); 3rd hit deactivates and zeroes
refund in one transaction; duplicate webhooks (activation, placement fee, telephony,
real-Razorpay shape) are no-ops; finance never sees phone/KYC; 403 tests for call agent,
field agent, finance, team lead.

Gate text that no longer matches reality (not rewritten, per the history rule):

- `phase-1.md` still says refund ladder "100/50/25/0%". Superseded by the flat rule locked
  2026-10-20 (`calculateRefund`, AGENTS §6); the test asserts the flat rule.
- `phase-1.md` says `grep Float prisma/schema.prisma` returns nothing. It returns 4 lines:
  `latitude`/`longitude` on `Business` and `BusinessVisit`. Coordinates, not money; every
  money column is an integer.
- `AGENTS.md` §3 lists `/console/admin` and `/console/call-agent`. Those routes do not
  exist; the real routes are `/admin`, `/call-agent`, `/field-agent`.

## 2. Phase 8 gate items: evidence

| Item | Evidence |
| --- | --- |
| GST invoice = fee + GST | `gst-invoice.spec.ts` (7 tests, incl. uneven-salary paisa rounding) |
| DPDP erasure anonymizes only PII, audited | `dpdp-erasure.spec.ts` (10 tests, incl. RBAC denial) |
| No automatic retention job | `src/jobs/` = `no-pickup-evaluation.job.ts`, `jobs.module.ts` only; grep for retention/expire/purge/anonymi/erase/delete in `src/jobs` (non-spec): none |
| Placement export excludes PII | `placement-export.spec.ts` |
| Request ID traceable incl. inside a BullMQ job | `observability.spec.ts` ("BullMQ Job Request ID Threading") |
| Login/OTP rate limit gives 429 | `security-hardening.spec.ts` §5; `trust-proxy.spec.ts` (limiter not keyed on spoofable `X-Forwarded-For`) |
| TOTP 2FA, all roles, not SMS | `two-factor-enforcement.spec.ts`, `security-hardening.spec.ts` |
| Unrecognised Field Agent device needs step-up TOTP | `security-hardening.spec.ts` §2 (4 tests) |
| Revoked session dead on next request | `security-hardening.spec.ts` §3; `staff-management.spec.ts` |
| Cloudflare gates Admin + Call Agent only | `security-hardening.spec.ts` §4 (signed-JWT tests for both routes; `/field-agent` and API verified reachable without it) and `cloudflare-access.verifier.spec.ts`; see section 3 for what this does and does not prove |
| No MDM / IP allowlisting | grep of `src` for mdm / android enterprise / allowlist / whitelist: none |
| Backup restored once, sanity-checked | `docs/DISASTER_RECOVERY.md` §3 + `backup-restore.spec.ts` (caveats in section 5) |
| New staff can't log in pre-invite; deactivated rejected | `staff-management.spec.ts` |
| No secrets committed | tracked files contain only `.env.example`; `.env` gitignored; no key patterns (`sk_live`, `rzp_live`, `AKIA…`, private keys, `xox*`, `AIza…`) in tracked files |

## 3. Blockers from the first pass: fixed

### B1 — Payout double-pay: fixed (scope as authorised); one residual remains (R1)
Reproduced first (two concurrent `disbursePayout` calls called the provider twice, both
succeeded), then fixed:

- `PaymentService.disbursePayout` now claims the payment with a single conditional
  `updateMany` (`pending` to `processing`) and requires `count === 1` **before** calling the
  provider. Losers get a `BadRequestException` and never reach the gateway.
- `RealPaymentProvider.disbursePayout` derives `reference_id` from `payment.id` alone (36-char
  UUID, within the gateway's 40-char limit) and sends the same value as RazorpayX's
  `X-Payout-Idempotency` header. The header is what RazorpayX actually dedupes on, so it was
  added alongside the reference; a missing `paymentId` now throws instead of silently falling
  back to a non-idempotent key.
- If the provider throws, whether money moved is unknown, so the payment is left in
  `processing` for a human to reconcile; it is never released back to `pending`.
- Tests (`payout-idempotency.spec.ts`, `real-payment.provider.spec.ts`): two concurrent
  disbursements make exactly one provider call; a burst of 10 makes one call and one audit row;
  the provider receives the payment id; a thrown provider call cannot be retried; the real
  provider sends an identical reference and header on a retry and refuses to run without a
  `paymentId`. Verified to fail without the service fix (4 of 5 fail) and pass with it.

**R1 — not covered by the authorised fix, still open before `PAYMENT_PROVIDER_MODE=real`
pays anyone:**
1. There is still **no payout status webhook**. `processing` from the gateway is recorded as
   `succeeded`, and a later failure or reversal is never reconciled. The Phase 7 gate item
   "duplicate payout webhook does not double-pay" therefore holds only vacuously.
2. A network error or timeout is recorded as `failed` even though the gateway may have
   accepted the payout; a `failed` payment cannot be retried through the API, so it needs
   manual reconciliation against the RazorpayX dashboard.

Recommended: add a verified payout-status webhook (idempotent, with a double-delivery test) and
record `processing` as non-final until it arrives. Left alone because it is a new feature in
Phase 7 scope and touches money flow.

### B2 — Cloudflare Access guard: fixed to verify the JWT; live verification outstanding
`CloudflareAccessGuard` no longer trusts header presence. A new `CloudflareAccessVerifier`:

- reads the `Cf-Access-Jwt-Assertion` token and requires **RS256** (rejects `alg: none` and
  HS256-with-public-key confusion before any network call);
- fetches the team's keys from `https://<CLOUDFLARE_ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs`,
  caches them for an hour, refetches on an unknown `kid`, and rate-limits that refetch to once a
  minute so random key ids cannot drive traffic at Cloudflare;
- checks signature, **audience** (`CLOUDFLARE_ACCESS_AUD`), **issuer**
  (`https://<team domain>`) and expiry;
- ignores `cf-access-authenticated-user-email` entirely (it is forgeable);
- fails closed (403) if team domain or AUD is missing, and refuses to boot when
  `CLOUDFLARE_ACCESS_ENFORCED=true` without them. New env vars are in `.env.example`.

Tests mock the JWKS response at the `fetch` layer and use real RSA keys and real signed
tokens: a genuine token passes; forged (right `kid`, wrong key), unsigned, HS256-confusion,
wrong audience, wrong issuer, expired, garbage, JWKS 5xx, missing config, key rotation and
the refetch cooldown are all rejected or handled. HTTP-level tests cover `/admin` and
`/call-agent` for the same cases plus the old email-header bypass, and confirm
`/field-agent` and API routes stay reachable. Verified to fail against the old guard.

**What this does not prove: end-to-end behaviour against real Cloudflare Access.** Still
needs a real Access deployment to confirm: (a) the team domain and AUD values; (b) that the
issuer, JWKS path and header name behave as implemented (taken from Cloudflare's documented
behaviour, not exercised live); (c) that Access is actually attached to the Render hostname
and that `CLOUDFLARE_ACCESS_ENFORCED=true` is set in production. Forged headers no longer grant
access even if the origin is reachable directly. Note this only protects the HTML console
shells; data was already behind JWT + RBAC + TOTP.

## 4. Playbook §8 Go-Live Checklist, walked line by line

Status key: **OPEN** = not done and not mine to mark done; **CODE READY** = the software side
exists and is tested, the real-world step is still open. You told me everything from payment
gateway activation onward is genuinely blocked on the business/vendors/legal; those stay
open. For the first five items I have no confirmation either way, so they are also shown open
until you tell me otherwise.

| # | Playbook item | Status | Evidence / what is left |
| --- | --- | --- | --- |
| 1 | Company registration (Pvt Ltd) | OPEN | Agastya. Nothing in the repo depends on it except items below. |
| 2 | PAN / TAN | OPEN | Agastya. Gates DLT registration (#8). |
| 3 | Current account | OPEN | Agastya. |
| 4 | GST registration | OPEN | Invoice generator reads GSTIN / legal name / address from env with placeholder defaults (Phase 8 Task 2, tested), so the build is not blocked. The real GSTIN must be set before the first real invoice. |
| 5 | Karnataka Shops & Establishments | OPEN | Agastya. |
| 6 | Payment gateway activation | OPEN (CODE READY) | `RealPaymentProvider`: HMAC-verified, idempotent webhooks, integer paise (`real-payment.provider.spec.ts`). Needs the live Razorpay account and `PAYMENT_PROVIDER_MODE=real` plus keys in Render. |
| 7 | Payout API setup | OPEN (CODE READY, see R1) | Disbursement now atomic and idempotent (section 3). **R1 must be closed before real payouts**: no payout status webhook, and ambiguous network failures need manual reconciliation. Also needs the RazorpayX account number. |
| 8 | DLT registration (needs PAN) | OPEN (CODE READY) | `RealOtpProvider` with DLT sender/template/entity env vars (`real-otp.provider.spec.ts`). Blocked on #2. |
| 9 | WhatsApp Business API setup | OPEN (CODE READY) | `WhatsAppProvider` real implementation wired behind `WHATSAPP_PROVIDER_MODE`; needs the Meta account, phone number id and token. |
| 10 | Toll-free number + routing (concurrent-line capacity for up to 40 agents) | OPEN / **UNVERIFIED** | Webhook idempotency and consent-gated recording are tested. Capacity cannot be verified in code and is pending the vendor contract; Phase 7 gate item stays unticked (manual sign-off). |
| 11 | KYC vendor contract | OPEN (CODE READY) | `RealKycProvider` stores only `{status, vendorReference}`, never an Aadhaar number (`real-kyc.provider.spec.ts`). Needs the contract and API key. |
| 12 | Consent form + T&C (lawyer-reviewed) | OPEN | Legal. The system captures consent before retaining any recording (`telephony.spec.ts`), but the wording is a lawyer's call. |
| 13 | Business agreement template | OPEN | Not software. |
| 14 | Call agent + field agent scripts | OPEN | Not software. |
| 15 | Positioning / branding | OPEN | Not software. |
| 16 | Agent employment contracts | OPEN | Legal / HR. |
| 17 | Grievance / refund SOP | OPEN | Human process. The system side (flat refund rule, CEO/Manager-only approval, audit trail) is tested; the written SOP is not in the repo. |
| 18 | Data retention policy (nothing auto-deleted, manual erasure only) | **Technical: DONE. Written policy: confirm** | No retention job exists (`src/jobs/` grep, section 2); CEO/Manager-only manual erasure anonymizes only PII and is audit-logged (`dpdp-erasure.spec.ts`). AGENTS.md §6 is the engineering rule, not a customer-facing policy document; whether a separate written policy is required and exists is for Agastya to confirm. |
| 19 | Accounting / GST-filing setup | OPEN (CODE READY) | GST invoices (SAC 9985, fee + 18% GST, integer paise) and placement export exist and are tested. The accountant's filing process is not software. Blocked on #4. |

## 5. Remaining risks and gaps

### Dependency scan is not clean; exceptions need Agastya's acceptance
Production (`npm audit --omit=dev`): was 6 high, now **5 high** after patching `body-parser`
2.3.0 to 2.4.0 (lockfile only; reachable on every JSON request, non-breaking). Remaining,
proposed as accepted exceptions:

| Package | Advisory | Why proposed acceptable |
| --- | --- | --- |
| `multer`, `@nestjs/platform-express` | DoS via async `fileFilter` (GHSA-q7qp-rjg7-q26m) | no multipart/upload route exists in `src/`; fix is a framework downgrade/major |
| `prisma`, `@prisma/config`, `deepmerge-ts` | stack exhaustion merging recursive objects (GHSA-ggr8-5vv4-36mx) | CLI/config tooling, not a request path; fix is Prisma 7 (major) and AGENTS locks 6.19.3, so ask-first |

Dev-only findings (10 more, e.g. `picomatch`) are not shipped to production.

### Backups: platform side unverified, offsite script unscheduled
- `scripts/backup.sh` is not invoked by any scheduler in the repo (no cron, no job, no
  workflow). The runbook calls it "automated"; it is not.
- Daily snapshots / PITR are claimed for Render Managed Postgres; retention depends on the
  Render plan and cannot be verified from here.
- The restore exercise ran against the local dev database (1075 `Staff` rows are test
  residue), not Render. The procedure is proven; the production backup source is not.

### Deployment config is not in the repo
No `render.yaml` / Dockerfile. Production env (`JWT_SECRET`, `CLOUDFLARE_ACCESS_*`,
`TRUST_PROXY_HOPS`, `*_PROVIDER_MODE`, GSTIN placeholders, `DATABASE_URL` with
`connection_limit`) lives only in the Render dashboard. `TRUST_PROXY_HOPS` must be verified on
the deployed service (LESSONS.md says so) or rate limiting will key on the wrong address.

### Load-test caveats
Real run on this tree (40 concurrent staff, local 2-core host, Postgres in Docker):

| Group | n | p50 ms | p95 ms | p99 ms |
| --- | --- | --- | --- | --- |
| businessRegistration | 20 | 1332 | 1685 | 1685 |
| jobSeekerOnboarding | 20 | 682 | 908 | 908 |
| vacancyCapture | 20 | 763 | 1910 | 1910 |
| priorityDashboard | 20 | 1965 | 2730 | 2730 |
| uniqueIdGeneration | 4 | 204 | 892 | 892 |
| concurrentWebhooks | 1 | 1404 | 1404 | 1404 |

In-process against a dev DB, **not the staging environment Task 1 asks for**; one request per
agent per group, so p95 = p99 = max; the "Errors" column is hardcoded to 0
(`calculatePercentiles`), though zero errors is still true because any non-2xx inside the
traffic loop fails the run. A staging run before launch is outstanding. `priorityDashboard`
(~2 s p50 under load) is the slowest read and worth a look.

## 6. Open ticks

Task 8 and these Phase 8 gate items are intentionally **not** ticked: load-test report
reviewed on staging, dependency scan (exceptions awaiting acceptance), Playbook §8 (items
open per section 4), and "all Phase 1–7 gate items still pass" (Phase 7's telephony sign-off
is open).
