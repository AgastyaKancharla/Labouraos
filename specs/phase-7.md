# Phase 7 — Telephony, Scale & Launch Hardening

**Goal:** swap every mocked external integration for the real thing, prove the system holds up at the 40-agent target headcount, and close out the Go-Live Checklist's technical items. This is the last phase before Laboura is live with real money moving.

**Why this is last:** every mock provider built from Phase 2 onward (OTP, payment, KYC, payout) exists specifically so this phase can swap in real vendor credentials without touching business logic. Scale and security work comes last because it only makes sense to load-test and harden a system whose behavior is already correct and fully tested.

**Out of scope for Phase 7:** new business features. If something here reveals a business-logic bug from an earlier phase, fix it in that phase's module and re-run that phase's gate — don't bolt a fix onto Phase 7's scope.

> Read `AGENTS.md`, the Playbook's Go-Live Checklist (§8), and Tech/Vendor Status (§7) before starting. Read `LESSONS.md` first.

---

## Tasks

### [ ] Task 1 — Real OTP/SMS vendor integration

**Acceptance:**
- `OtpProvider` (Phase 2 Task 1) gets a real implementation against the chosen vendor, behind the same interface — no calling code changes
- DLT-registered sender ID used for all SMS, per Playbook §5/§7 TRAI compliance
- Commercial/OTP messages respect the 09:00–21:00 window already enforced at the data layer (Phase 2 Task 2)

---

### [ ] Task 2 — Real payment gateway and payout API

**Acceptance:**
- `PaymentProvider` (Phase 2 Task 4) and the payout extension (Phase 6 Task 2) get real implementations
- Webhook signature verification uses the real vendor's actual verification method — re-run the Phase 2 Task 5 idempotency test against the real webhook shape
- Sandboxed/test-mode credentials used until go-live; switching to live credentials is an environment-variable change only

---

### [ ] Task 3 — Real Aadhaar e-KYC vendor

**Acceptance:**
- `KycProvider` (Phase 2 Task 7) gets a real implementation against the licensed OVSE vendor
- Re-run the Phase 2 Task 7 "no raw Aadhaar number stored" test against the real vendor's response shape — vendor responses sometimes echo more than expected; verify nothing is persisted beyond the result and reference

---

### [ ] Task 4 — Telephony integration (toll-free line)

**Acceptance:**
- Inbound missed-call-to-toll-free triggers a call agent callback queue entry
- Call recording, where enabled, triggers the DPDP-required consent announcement and logs consent (Playbook §5) as an auditable record, not just a recorded call
- Confirm with the vendor contract that concurrent-line capacity covers 40 agents calling at once (Playbook §7) — if this can't be verified in code, document the confirmation as a manual sign-off item in the gate below rather than skipping it silently

---

### [ ] Task 5 — Load and concurrency testing

**Acceptance:**
- A load test simulates 40 concurrent staff sessions performing realistic mixed traffic (onboarding, payments, vacancy capture, placement actions) against a staging environment
- No RBAC check, money calculation, or audit log entry is dropped or corrupted under concurrent load — specifically re-test concurrent webhook delivery and concurrent unique-ID generation (Phase 1 Task 5) at higher volume
- Document actual results (response times, error rate) — this is a measurement task, not a guess

---

### [ ] Task 6 — Observability

**Acceptance:**
- Structured logging across all modules (not `console.log`), with request IDs traceable through a call
- Error tracking/alerting wired to something the team actually monitors
- A basic uptime/health dashboard beyond the Phase 1 `/health` endpoint

---

### [ ] Task 7 — Security hardening

**Acceptance:**
- Dependency vulnerability scan clean (or documented exceptions)
- Rate limiting on auth and OTP endpoints (brute-force protection)
- Secrets audit: confirm nothing in Tasks 1–3's real-vendor work leaked a key into logs, error messages, or version control
- `.env` and all credentials confirmed never committed (re-check git history, not just the current state)

---

### [ ] Task 8 — Backup and disaster recovery

**Acceptance:**
- Automated database backups on a defined schedule, with a documented, tested restore procedure — actually restore once into a scratch environment and confirm it works, don't just assume a succeeding backup job means it's restorable

---

### [ ] Task 9 — Go-Live Checklist close-out

**Acceptance:**
- Walk the Playbook's §8 Go-Live Checklist line by line; for every technical item, confirm it's done and link the evidence (a passing test, a config, a signed-off manual check); for every non-technical item (company registration, legal review, contracts), confirm its status is accurately reflected and flag anything still blocking go-live

---

## Phase 7 Gate

- [ ] Every mocked provider (OTP, payment, payout, KYC) has a real implementation passing the same tests its mock passed
- [ ] The idempotency tests from Phases 2, 5 and 6 all still pass against the real webhook shapes
- [ ] Load test completed at 40-concurrent-agent volume with documented results and no data-integrity failures
- [ ] Security scan clean or exceptions documented and accepted
- [ ] A real backup has been restored successfully at least once
- [ ] Every item on the Playbook's Go-Live Checklist is either done-with-evidence or explicitly flagged as a remaining blocker
- [ ] All Phase 1–6 gate items still pass
- [ ] `LESSONS.md` updated

**This is the last gate. When it passes: stop. Report to Agastya — Laboura is ready for a go/no-go call, not an automatic launch.**