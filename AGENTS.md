# AGENTS.md — Laboura

Project instructions for every coding agent working in this repository
(Antigravity, Claude Code, Cursor). Read this fully before writing any code.

Built by **AgastyaOne** for the client **Laboura**.

---

## 1. What this project is

Laboura is a staffing service in Bengaluru, India, launching city by city. It connects verified job seekers with businesses that need salaried staff, and guarantees the result on both sides: a job seeker pays ₹499 and gets an offer within 30 days or a full refund; a business pays 50% of the first month's salary and gets free replacements if the worker leaves within 60 days.

**Source of truth.** The business rules are owned by Agastya in the *Laboura Master Guide*. Sections 6 and 7 of this file mirror it. `specs/data-design.md` defines every table, column and status for the redesign. If they disagree with each other, stop and ask.

**Matching.** The software includes a rule-based matching engine: fixed filters and a ranking, no AI. It is built in its own phase. Until then, don't add scoring anywhere else.

**Transition.** The current code still follows older rules in several places. `specs/data-design.md` §16 lists the phases that change them. Do not change existing behaviour to match §6 or §7 unless your current task says so. When a task touches an area, build it to §6 and §7.

Four kinds of people use it:
- **Call agents** — onboard job seekers, referrals and businesses by phone
- **Field agents** — visit businesses in person, capture vacancies, arrange interviews
- **Management** (CEO, Manager, Team Leads) — oversight and targets
- **Finance** — invoices, refunds, GST ledger

Job seekers, businesses and referral partners can also sign in to **the Laboura app** (customer app, decided 14 Nov): a native Expo app in `customer/` for the Play Store and the App Store. They sign in with Google or a mobile number + OTP; a verified mobile is required before any profile is registered. Customer sign-in is a **separate realm** from staff login: its own accounts, sessions, key and audience (`src/common/customer-auth/`, routes under `/customer-api/v1/...`, guarded by `@CustomerRoute()`). A customer token is never accepted by a staff route and a staff token never by a customer route. Every customer request works only on the caller's own records, worked out on the server from the sign-in; a profile id the app sends only picks among the caller's own profiles. API contract: `docs/customer-app-api.md`. The SMS link pages (`/p/...`) keep working for people without the app.

---

## 2. Non-negotiables

These are the quality floor. Breaking any of these is a defect regardless of
whether tests pass.

1. **Money is stored as integer paise. Never floats.** `₹499` is `49900`.
   Floating-point money causes silent rounding corruption. There is no
   exception to this rule.
2. **All access control is enforced server-side**, in the API layer, on every
   request. Never rely on the UI hiding a button.
3. **Never store a raw Aadhaar number.** Aadhaar is checked in-house from
   UIDAI's Secure QR (`src/modules/aadhaar-qr`); store only what the guide
   lists (the result, the QR's reference = last 4 digits + time stamp, name,
   date of birth, gender, area, pincode, the checks' results, the consent).
   Never the full number, a picture of the card, the e-Aadhaar PDF/XML, the
   full address or the QR's raw text. This is a legal requirement, not a preference.
4. **Every sensitive write is audit-logged** (see §7) with actor, timestamp,
   before-value and after-value.
5. **All timestamps are stored in UTC.** Convert to IST (UTC+05:30) only for display.
6. **Never invent a business rule.** If a rule isn't written in §6 or in the
   current phase spec, stop and ask. Guessing a refund percentage is worse
   than not writing the code.
7. **Every external call is idempotent.** Payment and telephony webhooks will
   be delivered more than once. A repeat must be a no-op, never a double charge.
8. **No secrets in code or in git.** Use environment variables. If you find a
   secret committed, stop and report it.

---

## 3. Tech stack

| Layer | Choice | Notes |
| --- | --- | --- |
| Runtime | Node.js 24.21.0 | Pinned in `.nvmrc` |
| Language | TypeScript 5.7.3, `strict: true` | `strict` is mandatory, never disable it |
| Framework | NestJS 11.2.7 | Pinned in `package.json` |
| Database | PostgreSQL 17+ | Managed (Supabase / Neon / cloud provider) |
| ORM | Prisma 6.19.3 | `schema.prisma` is the single source of truth for the data model |
| Tests | Jest 29.7.0 (NestJS default) | Pinned in `package.json` |
| CI | GitHub Actions | `.github/workflows/test.yml` |
| Jobs | BullMQ on Redis | For schedulers and webhook retries |
| Frontend Consoles | React 19 + TypeScript + Vite 7 web app in `web/` (decided 11 Nov) | CEO, Manager, Team Lead and Finance portals, call agent console and public job seeker pages, served by NestJS at the site root of `app.laboura.com` (`/login`, `/ceo`, `/manager`, `/team-lead`, `/finance`, `/call-agent`, `/p/...`; decided 14 Nov — old `/app/...` links redirect). Conventions: `web/README.md`. **Retired consoles (14 Nov):** the old HTML-string consoles are retired; a browser opening `/admin`, `/console/admin`, `/map` or `/console/map` goes to `/login`, `/console/call-agent` to `/call-agent`, and `/field-agent` or `/console/field-agent` to Laboura Field (301, `SiteRoutingMiddleware`). The old Admin Dashboard (`/console/admin`) went last (14 Nov), once the new screens did its final four jobs: Finance adds a bank credit from the statement and sets a credit aside (FN-MoneyIn, FN-Bank, FN-Match; the CEO can set one aside on C-Payments), Finance resolves payment and payout flags (FN-MoneyIn, FN-Payouts), and "Report worker left" (the replacement claim) is on C-Placement, MG-Requests, T-Requests, placement search results and Laboura Field's FA11. Only `/setup` (first CEO) is left of the old consoles. |
| Field agent app | Laboura Field: Expo SDK 58 (React Native 0.88, expo-router, TanStack Query) in `field/` (decided 9 and 11 Nov) | One codebase for the installed web app served by NestJS at the root of `field.laboura.com` (`FIELD_HOST`) and at `/field` on other addresses (iPhone: Safari → Add to Home Screen) and later the Android APK / store apps via EAS. Kannada, English, Hindi. Conventions: `field/README.md`. Add packages with npm 11 and exact versions. |
| Hosting | Render (LOCKED 2026-10-25) | Web service (API + consoles) + a separate Background Worker service for BullMQ + managed Postgres + managed Redis. Chosen over Vercel because Vercel's serverless model doesn't support BullMQ's always-on worker process. Domain DNS records are at **Hostinger**, where laboura.com was bought (app.laboura.com and field.laboura.com are DNS records there pointing to Render; Master Guide, 14 Nov). Cloudflare Access (next row) needs the gated hostnames to go through Cloudflare, so how it is switched on depends on that set-up. |
| Cloudflare Access Gating | Identity-gated office consoles | Gated routes: the office web app's staff pages (`/login`, `/ceo`, `/manager`, `/team-lead`, `/finance`, `/call-agent`), checked in `SiteRoutingMiddleware` (the old Admin Dashboard and its `CloudflareAccessGuard` are gone). Public pages (`/p/...`), Laboura Field (`field.laboura.com`, `/field`) and API routes are explicitly exempt: field agents reach Laboura Field from phones outside the Cloudflare Access perimeter (the old `/field-agent` page and its exemption are retired; it now redirects to Laboura Field). |
| Load Testing | Node.js Concurrency Harness / Artillery | Simulates ~40 concurrent staff sessions (20 call agents, 20 field agents) performing realistic mixed traffic |

**Exact versions pinned above.**
Do not leave version ranges like `^11.0.0` in this file.

**Provider switching (mock vs real, from Phase 7 onward):** every external
integration (OTP/SMS, WhatsApp, telephony, payment collection, payout
disbursement) is bound through NestJS DI to an interface — `OtpProvider`,
`PaymentProvider`, `WhatsAppProvider` and `TelephonyProvider` —
with a mock implementation and a real one. Which one gets injected is
controlled by a per-provider environment variable (`OTP_PROVIDER_MODE`,
`PAYMENT_PROVIDER_MODE`, `WHATSAPP_PROVIDER_MODE`, `TELEPHONY_PROVIDER_MODE`),
each defaulting to `mock` when unset. Never add a second way to pick a
provider implementation — extend this one. ID checks have no outside provider
at all (guide, 14 Nov): Aadhaar is checked in-house from its Secure QR and
PAN / driving licence / voter ID by the Team Lead from a live photo of the card.

---

## 4. Project structure

```
/prisma/schema.prisma      ← the data model, single source of truth
/src/
  /modules/                ← one folder per entity, self-contained
    /job-seeker/
    /referral/
    /business/
    /vacancy/
    /placement/
    /payment/
    /staff/                ← call agents, field agents, leads, finance
  /common/
    /auth/                 ← login, tokens
    /rbac/                 ← permission guards
    /audit/                ← audit logging
    /money/                ← paise helpers, GST calculation
  /jobs/                   ← scheduled jobs and queue workers
/test/                     ← end-to-end tests
/specs/                    ← phase specs and architecture; read before working
/.github/workflows/        ← CI
LESSONS.md                 ← known bugs and their fixes
```

A module owns its own controller, service, DTOs and tests. Modules talk to
each other through services, never by reaching into another module's internals.

---

## 5. Commands

```bash
npm install          # install dependencies
npm run dev          # start the API locally
npm test             # run all tests  ← must pass before any task is done
npm run test:watch   # tests in watch mode while developing
npm run lint         # lint and format check
npx prisma migrate dev --name <name>   # create a migration after schema change
npx prisma studio    # browse the database visually
```

**`npm test` must pass before you mark any task complete.** Not "should" — must.

---

## 6. Domain rules — decided by the business (Master Guide, 2 November 2026)

Every number below lives in the `PricingPolicy` table, never as a literal in code.

### Job seekers
- **₹499** to register, flat — no GST added on top.
- **Order:** name and mobile → consent (separate items, before payment) → profile → payment → Aadhaar verification.
- **30-day guarantee** from the moment the payment is confirmed in Laboura's bank account.
- **An offer is a confirmed interview** at a real business, for a vacancy that passes the suitability check done by the software: same trade, salary inside the candidate's range, within their travel distance, matching their shift preference. The candidate has **48 hours** to reply.
- **A hit** is: no pickup (morning and evening calls unanswered plus a WhatsApp or SMS, all on the same day — reported by the phone system, never typed by an agent), declining a suitable offer, not replying to it, or not turning up to the interview. The last three also **end the refund**. A business saying "not selected" is never a hit.
- **3 hits** → deactivated, no refund. Paying ₹499 again resets the hits and the 30-day clock.
- A Team Lead can reverse a wrong hit, with a reason; the CEO and Manager are notified.
- **Refunds are released by a person** (CEO or Finance), never automatically, after a check that the candidate isn't working at a business Laboura introduced.
- Mobile verified by OTP. Calls only between **09:00 and 21:00** and inside the candidate's preferred window.
- **Never collect** religion, caste, marital status or health conditions.
- **Joining reward:** ₹200 to the candidate after 30 days in a job joined through Laboura, released by CEO or Finance, to a UPI ID collected at joining and name-checked.

### Businesses
- **Fee:** 50% of the agreed first-month salary plus 18% GST, paid **the moment the candidate is selected**, within 24 hours. The joining date is confirmed only after payment. No deposit.
- **Interviews:** walk-in, 10:30 AM–6:00 PM by default. The owner records the result in the app by OTP **by 8 PM the same day**; the candidate is asked at the same time whether they were offered the job.
- **Account agent:** every business has one — the field agent who onboarded or verified it. Only the account agent, their Team Lead and management edit it. Call agents may add vacancies to any business by phone; the account agent is notified.
- **A business that calls in** is a lead until a field agent's verification visit. No candidate is shown to an unverified business.
- **No-documents businesses** (no licence, no GST): live photo, location check, and Team Lead approval before any candidate is shown.
- **Agreement signed by OTP**, including the no-bypass clause: hiring anyone Laboura introduced within **12 months** costs the full fee **plus 50%**.
- **60-day guarantee** from the first employee's joining date. **Up to 2 free replacements**, on the same clock. If the second replacement also leaves, the guarantee ends with no refund. If the business rejects **2 replacement candidates**, the guarantee ends with no refund.
- No replacement within **15 days** of an accepted claim → **flat 100% refund**, released by CEO or Finance.
- **Claims:** reported within **7 days** of the worker leaving, fee paid in full, reason from the fixed list, a recorded exit call to the worker, decision by a Team Lead or Manager within 48 hours.

### Referral partners
- **₹200** when the referred candidate **joins** — not when they pay. Released by CEO or Finance.
- Payout UPI or bank details are checked by name; changing them needs an OTP and a 48-hour wait.

### Money
- All amounts in integer paise.
- **Collected by UPI straight into the company current account**, with a separate QR code or link per payment carrying the exact amount and a reference. A payment gateway is used only when the payer chooses a card.
- **A screenshot is never proof of payment.** A payment counts only when the bank confirms it.
- Everything going out — refunds, payouts, rewards — is released by the CEO or Finance.

### Identity
- Aadhaar (decided 14 Nov): an in-house check of UIDAI's Secure QR — scanned with his own phone in his link (or read from his e-Aadhaar PDF in the browser), or live in Laboura Field; only the QR's text reaches the server, which checks UIDAI's signature, 18+, the name and whether his OTP-verified phone is linked (not linked: a flag, not a block). No verification company and no outside ID service. PAN, driving licence or voter ID are always offered too: a live camera photo of the card plus the typed number, checked by the Team Lead by eye in T-Verify (pending until approved; only the type and last 4 digits are kept; the photo is deleted after the decision or 30 days). Store only: verified yes/no, method, time, the QR's reference (last 4 + time stamp), name, DOB, gender, area, pincode, name match, phone linked, 18+, the consent; the QR photo only until the Team Lead's check (30 days at most). **Never** the full number, any image of the card, the XML or PDF or the address.

### Keeping data (replaces the 25 October "never delete" rule)
| Data | Kept | Then |
| --- | --- | --- |
| Payments, invoices, refunds, payouts | 8 years | deleted |
| Job seeker, business, referral profiles | 23 months after last activity | anonymised |
| Identity verification | result only | — |
| Call recordings | 1 year, or until a dispute closes | deleted |
| Login and access logs | 1 year | deleted |

Personal data never goes into the audit log or status history.

### Legal documents (Master Guide rev 176, 15 Nov)
- **Versions:** job seeker terms **1.1**, business agreement **1.1**, referral partner terms **1.0**, consent notice **1.2** (`src/modules/legal/legal-documents.ts` `LEGAL_DOCUMENT_VERSIONS`, `consent.constants.ts` `DEFAULT_NOTICE_VERSION`). Changing a text means a new version, a migration-free content edit and re-consent.
- **Texts** live in `src/modules/legal/content/*.{en,kn,hi}.ts`. English is the owner-approved text, word for word. **Kannada and Hindi are machine drafts** (flagged at the top of each file) until a human translator checks them. Every number is a `{{placeholder}}` filled from `PricingPolicy`; company CIN, registered office, GSTIN and the Grievance Officer come from Settings (C-Privacy → Company details) and read "to be added after registration" until the CEO fills them.
- **Shown as** "In short" first, then "Read the full terms", in the person's language, on every link, in Laboura Field (read aloud) and in the customer app. Ticks are itemised and never pre-ticked.
- **Every acceptance** writes a `LegalAcceptance` row (document, version, language, OTP request, notice version, purposes, context) pointing at the exact rendered HTML in `LegalDocumentText` (keyed by its sha256). The business agreement's signed copy holds the **full** v1.1 text plus the filled acceptance record (S1). Job seekers' guarantee terms keep the version, language and hash they accepted at payment (`JobSeeker.termsAccepted*`); a running guarantee keeps that version (18.2).
- **Re-consent:** anyone whose latest acceptance is an older version (or notice) sees a blocking "We've updated our terms" screen on their link, in the customer app and as a banner in Laboura Field; consents given under 1.1 stay valid until then, but the server refuses paying, ID checks, interview bookings and accepting an offer with `RECONSENT_REQUIRED` (409) until the new version is accepted (`src/modules/legal/legal-status.ts`). The guarantee terms ticked at payment never decide the notice version. Re-consent is only for someone who did the first consent step; the page sends the hash of the text it showed and the server refuses a mismatch. Staff screens show which version each person accepted, with "View signed copy" (`GET /legal/acceptance-text/:id`, Manager/CEO).
- **Partners** give a separate ID-check consent (`aadhaar_verification`, S2) before any ID check.
- **Claims (D1):** "medically unfit or moved out of the city" (`medically_unfit_or_relocated`) is a covered reason. **D2:** replacing a selected candidate who never joined takes the same place in the chain and is **not** counted as one of the 2 free replacements (`Placement.countsAsReplacement = false`). **D3 (rev 181):** a replacement hired above the **highest** salary already paid a fee on in the chain (the first fee or any paid difference) pays the fee percent of the difference above that highest salary plus GST (₹25,000 fee → ₹20,000 → ₹25,000 = nothing; ₹12,000 → ₹14,000 paid → ₹15,000 = fee on ₹1,000; agreement clause 10.8) (`replacement_upgrade` UPI request, invoice line, Finance sees it) before the joining date is released. **M2 (rev 178):** unpaid after `PricingPolicy.upgradePaymentCancelDays` (7) from the selection, the daily placement job cancels the replacement (payment closed, vacancy reopened, candidate freed, `countsAsReplacement = false`, business told in the app and by SMS `replacement_upgrade_cancelled`); a Manager or the CEO can "Cancel now" with a reason. **M4 (rev 178):** a 100% business refund is the first fee plus every paid salary difference in the chain (`chain-refund.ts`; each part shown with its GST; the refund itself stays fees only until the CA answers). The refund payment saves its parts (`Payment.refundParts`) and credit notes, the GST screens and FN-Refund measure it against them (`refundBasis`). An awaiting-payment replacement counts as selected, and ending a guarantee by refund cancels any open salary-difference request. H3: cancelling a replacement sets the job seeker back to active only when he has no other confirmed or active placement; the selected job seeker is told (`selection_cancelled`, app + SMS). The daily cancel job isolates each row (logged) and always resumes ended suspensions.
- **Closing an unpaid replacement (`placement/cancel-upgrade.ts`):** one path for "not paid in time", "Cancel now" and a guarantee ended by a refund — placement locked first, only a row still awaiting payment changes, payment closed, candidate cancelled, job seeker freed (H3), the business and job seeker told, audited. Only the first two reopen the search (paused at once if the business is suspended).
- **Money after a closed request (C1, Fable re-check):** a payment that lands after its placement or ₹499 request closed (cancelled, or the person permanently banned) is never swallowed: it is marked failed and raises a `payment_mismatch` flag with reason `paid_after_request_closed`, `paid_after_gateway_failed` (closed by an earlier gateway "failed") or `paid_while_permanently_banned` (one open flag per payment) and the placement / job seeker code; a bank credit used for it is released. A paid claim that updates 0 placements is flagged too. Lock order everywhere: the placement (or the job seeker, for ₹499) `FOR UPDATE` first, then the payment.
- **D6 suspension:** CEO only, 30–90 days or permanent, with a reason, audited. While suspended a business adds no vacancies, is shown no candidates and books no interviews; placements, guarantees and payments already made carry on. **D11 permanent ban:** Manager or CEO, only for forged ID, fraud, theft or violence; audited; the same phone or ID fingerprint (Aadhaar, PAN, driving licence, voter ID, GSTIN) can never register again as a job seeker, business or partner. The hashes are HMAC with `PERMANENT_BAN_HASH_KEY` (never change it, or old bans stop matching). His open ₹499 requests close at ban time and money arriving later never reactivates him (flagged for a refund); a banned business cannot be given a time-limited suspension. **M9 (rev 178):** a ban covers every profile of the person on the same phone or ID fingerprint (job seeker, business owner, referral partner) — now and for new registrations; `PermanentBan.coveredProfiles` keeps what each was. **M7:** only the CEO lifts a ban (`POST /permanent-bans/:type/:id/lift`, reason required, audited); the row stays, marked lifted, and every profile goes back to what it was (a job seeker whose earlier status was not kept, or was anything but active / paused / inactive, is paused for review). **H1 (overlapping bans):** a ban never re-covers a profile another live ban already covers (it copies that ban's `before`); lifting one ban skips profiles still under another; the cover lookup and insert run in one transaction under an advisory lock. **H2 (rev 181):** only a phone or Aadhaar match auto-covers and blocks. A voter ID / driving licence / PAN match (type + last 4 + name) raises a `possible_banned_person` review item for a Manager or the CEO (C-Audit-Flags, MG-Flags): "Confirm — same person" covers the profile under the ban, "Not the same person" clears it (`POST /permanent-bans/possible-matches/:flagId/confirm` / `not-same`, reason required, audited; the generic Resolve refuses it). Until decided, the ID check, the ₹499 and the terms step answer `409 UNDER_REVIEW` with a neutral "being checked" message — never "ban". An existing ₹499 waits too (re-send, payment page, card start; the public summary returns `underReview: true` and no way to pay); money that still arrives is recorded but does not activate him (`payment_mismatch`, `paid_while_ban_review_open`), and "Confirm — same person" raises a refund flag for it. One open item per profile (raised under a per-profile advisory lock); an ID sent before a ban is checked against it when approved; "not the same" for one ban never hides another ban on the same ID. A ban, its lift and "Confirm" share the `permanent-ban` advisory lock (the lift re-reads the ban inside it and dismisses that ban's open items, audited); both decisions close the item only while it is still open. The example `PERMANENT_BAN_HASH_KEY` from `.env.example` is refused in production. **M10:** a suspended business interviews no one (replacements included); the 15-day replacement clock of its open claims pauses (`ReplacementClaim.searchPausedAt` / `searchPausedSeconds`, `claim-clock.ts`) and continues when the suspension ends; refund lists, money at risk, guarantee exposure and refund approval respect it; a permanent suspension keeps it paused and the claim shows on C-Claims for a Manager or the CEO. **M3 (rev 181):** a refund already due before a suspension began stays owed (only pauses that began earlier are subtracted). **M4 (Fable re-check):** a suspension cancels the business's upcoming offered and confirmed interviews (`cancelReason = 'business_suspended'`) and tells both sides (`interview_cancelled`); a "selected" result is refused while suspended. Pause and the suspended list cover only open searches.
- **S10:** `offer_rejected` is treated as `offer_declined` everywhere (a hit that ends the refund). **D17:** invoices never print the candidate's phone; the candidate's full name and joining date show only after the payment is received.

### Staff
- Everyone is salaried. No commission for anyone.
- Monthly targets as built in Phase 6.7.

---

## 7. Access control and login (Master Guide, 2 November 2026)

Enforced server-side on every request, through the guard — never by hiding a button.

| Role | Job seekers / referrals | Businesses | Vacancies / placements | Payments | Pricing | Targets |
| --- | --- | --- | --- | --- | --- | --- |
| CEO | all | all | all | all; releases money | **only writer** | all |
| Manager | all, phone numbers masked | all, masked | all | **none — no rupee figure anywhere** (reconfirmed 11 Nov) | **none** | own tree |
| Team Lead | own team | own team's businesses | own team | none | none | own team |
| Call Agent | create and edit | read all; create leads; add vacancies to any business | read all | none | none | own |
| Field Agent | city-wide | read all; edit only where account agent | read all; act on own businesses | none | none | own |
| Finance | read, personal data masked | read, masked | read | all; releases money | none | none |

- **Only the CEO sees full phone numbers**, and every answer that gives him one is audit-logged with the records it named. Agents, Team Leads and Managers see the last 4 digits; Finance sees none. Calls go through the calling system.
- **Managers see no money:** money-only endpoints refuse them and every other answer has its money fields stripped (`src/common/rbac/money-visibility.ts`).
- **A Manager acts only inside their own reporting tree** (create, lock, unlock, deactivate, re-issue, targets, audit log) and cannot create CEO, Manager or Finance accounts. A Team Lead reads only their own team's audit rows.
- **Every route has a role guard or `@Public(reason)`**; `src/common/rbac/route-guard-coverage.spec.ts` fails the build otherwise.
- **Nobody below Manager** can download or export lists.
- Every sensitive write is audited with actor, time, reason and the fields that changed.

### Login (Master Guide rev 174–175, 15 Nov)
- Staff log in with their **staff code** and password (at least **8 characters**). Email is optional for every role and is never a login identifier.
- **New accounts: a temporary password, no link.** Creating any staff account (and "New temporary password", "Reset sign-in completely", reactivation, the first CEO from `/setup`) gives a temporary password shown once to the senior next to the staff code: 8 characters as two groups of 4 (`K7M4-Q2PX`), capitals and digits without 0/O/1/I/L, accepted in any case and with or without the dash. Stored only as a bcrypt hash (`Staff.tempPasswordHash`), never logged, answers carrying it are `Cache-Control: no-store`. Valid 24 hours, works once; a newer one kills the older. The account stays "Not signed in yet" (`pending_invite`) until set-up finishes. Invite links are gone. The temporary password box offers **Share on WhatsApp** only for call agent and field agent accounts (they still need device approval and a login code); for the CEO, Managers, Finance and Team Leads it is Copy only, read out on a call.
- **First login** (web `/login` and Laboura Field): staff code + temporary password → **no session**, a 15-minute set-up ticket bound to that device id (`/auth/setup/*`) → live selfie (required whenever none is on file; the server refuses the password before it) → new password twice (not the temporary one) → CEO/Manager/Finance/Team Lead: authenticator QR + first code in the same step → password and authenticator switch on in one conditional update that also clears the temporary password → "Password set — sign in" → normal sign-in. An authenticator user whose temporary password came with a reset that kept their authenticator types a code from it instead. Wrong authenticator codes count like wrong passwords; a locked account (5 wrong tries or a senior's lock) gets no use of its ticket, and the lock ends the ticket.
- **Who signs in how.** CEO, Managers, Finance and **Team Leads** use their own authenticator app (TOTP) — no login code (`src/common/auth/sign-in-roles.ts`). A password alone never opens a session for them: without an authenticator they are refused and a senior gives them a temporary password to set it up. Call agents and field agents need a **6-digit login code** at every sign-in, revealed by a senior on the login code screen and recorded; codes are never stored. Login codes: a Team Lead for their own team, a Manager for people in their teams, the CEO for anyone.
- **Approved devices only**, for every role. An agent's new device is approved by their Team Lead (or a Manager/the CEO); a Team Lead's by a Manager or the CEO; a Manager's or Finance's by the CEO; the CEO approves his own with his authenticator code (decided 11 Nov).
- **Owner agent accounts** may report directly to an active CEO (no Team Lead); their login codes and device approvals then come only from a CEO (a founder may approve his own owner account — a different staff row, recorded; reset reveals and temporary passwords for it carry `ownOwnerAccount: true` in the audit row).
- **Forgot password** (login page, web and Field): staff code → a red **PASSWORD RESET** card on the code screens of those allowed to approve it (a Team Lead for their own agents; a Manager for people below Manager in their teams; a CEO for anyone; a CEO's reset only by the other CEO; Finance by a CEO; never one's own) → they call back from their own contacts and reveal a 6-digit reset code: single use, 15 minutes, only on the device and sign-in that asked, its own HMAC label (never a login code), 5 wrong tries end it → code + new password (+ their own authenticator code for authenticator roles, who keep it). The request answers the same whether the staff code exists: no request is made for an unknown, inactive or limited account, and the answer carries a stand-in id worked out from the staff code, device and 15-minute window, which repeats like a real open request; completing answers the same for an unknown request, one not revealed yet and a wrong code. 1 open request per account (also a partial unique index); a request from the person's own approved device replaces one from an unknown device, and unknown-device requests never count against an approved device's 3 an hour per staff code. The public `/auth/setup/*` and `/auth/password-reset/request|complete` routes are throttled per connection only (nothing in the body opens a fresh bucket). Wrong reset codes take a try before the comparison (never more than 5). The old password works until the reset completes; only a senior's lock refuses the completion and ends the request; 5 wrong codes on the request end it. The login-code step names a CEO (`codeFrom: 'ceo'`) for an owner account that reports to a CEO, otherwise the Team Lead.
- **Lost authenticator and forgotten password together:** Forgot password cannot finish for an authenticator role (it asks for a code from the authenticator they keep); accepted (Fable L-D): the way out is a senior's temporary password ("Reset sign-in completely").
- **Locks during set-up and reset:** only a lock a senior placed stops a set-up ticket or a reset request (and ends it). A wrong-password lock from the login page does not, because anyone who knows a staff code can cause one. Authenticator guessing is stopped on the ticket or request itself: 5 wrong codes end it (on a reset request, wrong reset codes and wrong authenticator codes share the 5 tries). Wrong set-up codes also count on the account, so a new ticket waits for that lock to end. Signing in with the temporary password no longer clears earlier wrong tries; only a finished set-up does. After the code is accepted, completing a reset answers like a stand-in (`code_invalid`) for another app, an ended request or a refused one; the page shows "run out, ask again" from its own end time. The stand-in's end time is the end of its 15-minute window. Staff codes over 32 characters and device ids over 128 get the usual answer. `/auth/setup/*` allows 20 requests a minute per connection (onboarding days); `GET /health/proxy-check` (CEO only) checks `TRUST_PROXY_HOPS` (DEPLOY.md F11, a gate before going live).
- **Lost phone or authenticator: never from the login page.** A senior uses "Reset sign-in completely" (authenticator removed, every session ends, back to "Not signed in yet", temporary password; approved devices stay). A locked-out single CEO: the break-glass server command (DEPLOY.md), not reachable over HTTP.
- **After any reset:** every session ends, approved devices stay, a bell to the person's boss and the CEO, a notice at their next sign-in ("Your password was reset on … approved by …"), full audit; history on `GET /staff/password-resets`.
- **One login at a time.** Logout after 1 hour idle or 2 hours at most. In Laboura Field, closing the app does **not** log out: a refresh token restores the session while it is inside the 1-hour idle and 2-hour limits (`POST /auth/field/refresh`). The office web screens still log out when the browser closes.
- **5 wrong passwords** lock the account for 15 minutes or until unlocked by a Team Lead, Manager or CEO.
- Staff log in from any network: there is no office-network rule (owner decisions 12 and 14 Nov). Every agent login needs a one-time code from a senior and every CEO, Manager, Finance and Team Lead login the authenticator code; field agents use their approved phone plus a location check. No fixed login hours; logins at odd hours are flagged.
- The CEO or a Manager can lock any account instantly.

### Security rules (red-team fixes, 16 Nov)
- **Edit routes write only an allowlist (AC-1).** `PATCH /referrals/:id`, `/businesses/:id`, `/vacancies/:id`, `/placements/:id` (and `/job-seekers/:id`) write only the scalar columns in their `ALLOWED_*_UPDATE_FIELDS` set; any other key is 400 before the permission check (`pickEditableFields`). `EditPolicyService.diffAndValidateReason` also refuses unknown keys, relations (nested create/update/connect) and values of the wrong type for the column (objects or operator objects on plain columns, arrays outside list columns). Never on an edit list: phone without OTP, status, verification and documents fields, GST/licence/PAN numbers, the account agent, paid/fee/GST/invoice fields, pause and suspension fields, confirmation fields, who registered or captured a record, and relations — each has its own route. A referral partner's or business owner's new phone needs an OTP on the new number (`phoneOtpRequestId`, purpose `referral` / `business_contact`), like a job seeker's. A paid placement's agreed salary is CEO only (D3 measures upgrade fees against it). Closing a vacancy is `POST /vacancies/:id/close` (Team Lead of the team, Manager, CEO; reason required). Never pass a request body (or a spread of it) to a Prisma write: `edit-field-allowlist.unit.spec.ts` scans `src/` for `data: dto`, `data: body` and `...dto` / `...body` inside Prisma writes.
- The office web app's staff pages stay behind Cloudflare Access. Laboura Field is exempt (field agents use it from their phones); the old `/field-agent` console is retired.

---

## 8. Unique IDs

Every core record carries a human-readable prefixed ID that agents read aloud
on phone calls. Generate sequentially, zero-padded to 5 digits.

`JS-00001` job seeker · `RF-` referral · `BZ-` business · `VC-` vacancy ·
`PL-` placement · `FA-` field agent · `CA-` call agent

These are in addition to the database primary key, not a replacement for it.

---

## 9. Testing

Tests are the contract. The rule: **code is not done until it compiles clean
and `npm test` passes.**

**Must have tests, no exceptions:**
- Every money calculation (fees, GST, refund ladder, payouts)
- Every state machine transition (hit cycle, placement lifecycle)
- Every RBAC rule — specifically, tests that assert a role is **denied**
- Every webhook handler, including being called twice with the same payload

**Time-based logic must use injectable time**, never `new Date()` inline, so
tests can fast-forward the clock. Refund-ladder tests must assert the correct
amount at day 15, 16, 30, 31, 45, 46 and 61.

Write the test in the same task as the code. Do not batch tests for later.

---

## 9a. Background jobs (one queue, one worker, a fixed number of Redis connections)

The free Render Key Value accepts about 50 connections and a zero-downtime deploy runs two copies of the app at once, so **a process opens at most 2 Redis connections** (web 1, worker/all 2; budget `REDIS_CONNECTION_BUDGET`, default 12). `src/jobs/redis-connection-budget.spec.ts` boots the app for each `PROCESS_ROLE` and fails if that grows; `src/common/redis/redis-connections.spec.ts` fails if any file other than `src/common/redis/redis-connections.ts`, `src/jobs/job-queue.ts` or `src/jobs/legacy-queues.ts` writes `new Redis(`, `new Queue(`, `new Worker(`, `new QueueEvents(` or `new FlowProducer(`.

- **Redis:** always `sharedRedis()` (and `whenRedisReady` / `pingRedis` for checks) from `src/common/redis/redis-connections.ts`. Never open your own connection, and never close the shared one (shutdown does).
- **Queues and workers:** every job uses the one queue `laboura-jobs` and the one Worker in `src/jobs/job-queue.ts` (`jobQueue`), which runs the handler registered under the job's **name**. Two runs of the same job never overlap; different jobs run side by side.

**How to add a scheduled job** (copy `src/jobs/win-back.job.ts`):
1. In `src/jobs/<name>.job.ts`: export `<NAME>_QUEUE = LABOURA_JOBS_QUEUE` and a unique job name `<NAME>_SWEEP`; `getQueue()` returns `jobQueue.queue()`; `readonly handle: JobHandler = () => recordJobRun(this.prisma, <NAME>_SWEEP, () => this.process())`; `getWorker()` returns `jobQueue.worker(<NAME>_SWEEP, this.handle)`; `schedule()` calls `this.getQueue().upsertJobScheduler('<scheduler-id>', <repeat from job-schedules.ts>, { name: <NAME>_SWEEP, opts })`; `onModuleInit()` returns unless `runsJobs()` and then calls `startScheduledJob({ name, handler: this.handle, schedule, startWorker, onError })`; `close()` calls `jobQueue.release(<NAME>_SWEEP)`.
2. Add the entry to `JOB_CATALOG` in `src/jobs/job-catalog.ts` (`queue: SHARED_JOB_QUEUE`, `jobName`, `schedulerId`, `runName`, `label`; no `legacyQueue`).
3. Add the job to `JobScheduleKeeper` (constructor and `handles`) and to `JobsModule` providers.
That is all: it automatically uses the shared queue and worker, the keeper puts its schedule back after a Key Value restart, `/health/ready` checks it, and it adds no connection.

**A one-off job** (queued by code, not on a schedule, like the recording copy): register the handler with `jobQueue.register('<name>', handler)` in `onModuleInit` when `runsJobs()`, and queue runs with `jobQueue.add('<name>', data, opts)` wrapped in a timeout on HTTP paths.

Nothing that starts with the app may wait for Redis: the app must start and answer `/health` with Redis down (`startScheduledJob` gives up after `REDIS_STARTUP_TIMEOUT_MS`, default 2 s, and the keeper catches up when Redis answers).

---

## 10. Git workflow

- One branch per task: `phase-1/task-3-rbac-guard`
- Commit when a task's tests pass, not before
- Commit message: what changed and why, one line, present tense
- Never force-push. Never commit directly to `main`
- Never commit `.env`, keys, or credentials

---

## 11. Boundaries

**Do freely:**
- Write code, tests and migrations for the current phase's tasks
- Refactor within a module you're already working in
- Add dependencies that are clearly needed and widely used

**Ask first:**
- Changing `prisma/schema.prisma` in a way that drops or renames a column
- Adding a new external service or paid API
- Changing anything in §2 or §6
- Starting work on a task from a different phase
- Any change touching how money is calculated

**Never:**
- Change a business rule in §6 to make a test pass
- Disable, skip or comment out a failing test
- Set TypeScript `strict: false`, or add `any` to silence a type error
- Store raw Aadhaar numbers or commit secrets
- Delete migration files that have already been applied

---

## 12. How to work a phase

1. Read `/specs/phase-N.md` — the current phase only. Ignore later phases.
2. Read `LESSONS.md` before fixing any bug; the answer may already be there.
3. Take **one task at a time**, in order. Do not start task 4 while task 3 is open.
4. For each task: write the code, write its tests, run `npm test`.
5. If tests fail, fix them. If you cannot after a genuine attempt, stop and report — do not disable the test.
6. When green, commit, then tick the task's checkbox in the phase spec.
7. Append any non-obvious bug and its fix to `LESSONS.md`.
8. When every task is ticked, run the **phase gate** at the bottom of the spec.
9. **Do not begin the next phase.** Report that the gate passed and stop.

---

## 13. LESSONS.md protocol

Before fixing an error, search `LESSONS.md` for it. After fixing a non-obvious
one, append:

```
## <short description of the error>
**Symptom:** what you saw
**Cause:** what was actually wrong
**Fix:** what resolved it
```

This stops the same bug being solved three different ways in three sessions.

---

## 14. When in doubt

Stop and ask. On this project, an agent that stops and asks about a refund
rule is doing its job correctly. An agent that guesses one is creating a
financial liability for the client.