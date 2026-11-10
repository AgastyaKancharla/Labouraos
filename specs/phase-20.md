# Phase 20 — Registrations, Done Properly

**Goal:** every way a person or business enters Laboura works the way the Master Guide now says (redesigned 9 Nov). Job seekers are registered on one form after their mobile is checked by OTP. One registration link resumes from where they stopped, and every link survives a server restart. Trades and salary ranges come from one list the CEO manages. Referral partners are registered by agents. The business form gets its contact person, branches and staff-needed rows. Every vacancy is confirmed by the business's contact person with an OTP.

**Why this is next:** these are the base flows Laboura needs on 20 November, when it starts using the software. Phases 1–19 built the records, money, matching and rules. This phase brings the front door up to date.

**This phase is API only.** The screens for these flows are built separately, in parallel, from the approved designs (frontend specs). **Do not edit** `src/modules/console/templates/**` or anything under `public/`. Every new endpoint must be documented in `docs/api/phase-20.md`: route, who may call it, request, response and errors, with one example each. The frontend is built from that file.

**Interpretation to confirm with Agastya:** the Master Guide gives four legal minimum wages (unskilled to highly skilled) but doesn't say which applies to which trade. This spec gives each trade a level that the CEO sets, starting at unskilled for all.

**Read first:** `AGENTS.md`, `LESSONS.md`, this whole spec, and `specs/data-design.md` §4 (job seekers), §5 (businesses), §6 (vacancies) and §10 (money out, for referral payouts). Then read `src/modules/consent/consent-link.service.ts`, `src/modules/payout-account/payout-account.service.ts`, `src/common/otp/*`, `src/modules/job-seeker/job-seeker.service.ts` (`create`), `src/modules/referral/referral.service.ts`, `src/modules/business/business.service.ts` (`create`) and `src/modules/vacancy/vacancy.service.ts`.

**Known traps in the current code (checked 9 Nov night against `main` at 0bcc454; handle them, don't stop on them):**
- **Public link tokens live only in server memory.** `ConsentLinkService` keeps every consent, agreement, referral-terms and interview-action token in a `Map`. `PaymentService` keeps payout-details tokens in another `Map` (`payoutLinkTokens`), which `PayoutAccountService` reads. Every restart or deploy kills every link already sent by SMS. Task 1 fixes this first, and everything after builds on it. (Payment request links are fine: they use `Payment.upiReference`. Candidate introduction links are fine: they use `CandidateIntroductionLink.tokenHash`.)
- **OTP sessions in `RealOtpProvider` also live in a `Map`** (`sessions`). A deploy during a call loses the OTP being checked. Task 1 moves them to the database. `MockOtpProvider` may stay in memory: it is used only in tests and mock mode.
- `POST /otp/send` and `POST /otp/verify` exist, throttled at 5 a minute. There is **no 30-second resend wait and no limit of 3 resends** yet (Task 3).
- `JobSeeker`, `Business` and `Referral` creation already require an `otpRequestId` that `OtpService.isVerified` accepts. **Keep that check.** Task 3 adds the resend rules and the duplicate check around it.
- Trades are free strings today (`JobSeekerTrade.trade`, `Vacancy.tradeSkill`). Matching compares the strings. Task 2 adds the managed list **without breaking existing rows**.
- `Business.leadChannel` is set automatically (`field_visit` / `phone_call`). That is *how we found them*, not *how they heard about Laboura*. Keep it, and add a separate `heardFrom` field.
- Consent links last 24 hours today, payout-details links 24 hours. The new registration link lasts **48 hours**; the payment-only link **15 minutes**.
- `Vacancy.status` today is `open | filled | cancelled`, and matching reads `open`. New vacancies must not be matched until they are confirmed (Task 8).
- There is no legal-minimum-wage data anywhere yet (Task 2).

**Out of scope — do not build:** any screen; attendance, leave and notifications (Phase 21); new Finance features (Phase 22); payment for referring businesses (not decided); the field agent app; real vendors (they stay in mock until the company documents arrive).

---

## How this phase runs

One task after another, in order, each on its own branch. Build on the latest `main`, push, wait for GitHub Actions to go green **on the branch**, fix on the branch, merge by pull request, then tick the task in this file. **Commit and push after every meaningful change.**

GitHub Actions is the test runner. **Do not run Jest or `npm test` locally, and do not create or edit any `.env` file.** Every test closes the Nest app in `afterAll` inside `try … finally`. Before pushing, check that every import points to a file that exists.

If the spec and the code disagree in a way this spec doesn't answer, **stop and ask**. Don't guess a business rule.

---

### [x] Task 1 — Links and OTPs that survive a restart
**Branch:** `phase-20/task-1-persistent-links` · **Migration folder:** `20261113090000_public_links`

**Acceptance:**
- New table `PublicLink`:
  - `id`, `tokenHash` (SHA-256 of the token, unique; the raw token is never stored), `purpose` (closed list: `registration`, `payment_only`, `referral_registration`, `business_agreement`, `interview_owner_result`, `interview_candidate_result`, `offer_reply`, `payout_details`, `vacancy_confirm`).
  - `subjectType`, `subjectId`, `phone` (encrypted with the existing key helper, like `Staff.callRoutingPhone`), `language`, `expiresAt`, `usedAt`, `revokedAt`.
  - `openedAt`, `completedUserAgent` and `completedIpHash` (which device finished it, without storing the raw IP), `createdByStaffId`, `createdAt`.
- `ConsentLinkService` and the payout-details link use `PublicLink` instead of their `Map`s. Same URLs, same behaviour, same expiry as today for the existing purposes. Remove both `Map`s.
- OTP sessions for the real provider move to a table `OtpSession`:
  - `requestId` unique, phone hash, `verified`, `attempts`, `resendCount`, `lastSentAt`, `expiresAt`.
  - Whatever the provider currently checks stays the same.
  - `MockOtpProvider` is unchanged.
- A daily job deletes `PublicLink` and `OtpSession` rows that expired more than 30 days ago (the 12-month access-log rule doesn't apply; these are not logs).
- Tests:
  - A link created, the app closed and a new app instance started, still opens.
  - An expired, used or revoked link is refused.
  - No raw token or raw phone appears in the table.
  - The real OTP provider's verify works across two service instances sharing a database.
  - Every existing link and OTP test still passes.

### [x] Task 2 — The trade list, salary ranges and the legal minimum wage
**Branch:** `phase-20/task-2-trades` · **Migration folder:** `20261113100000_trades`

**Acceptance:**
- New table `Trade`:
  - `id`, `name` (unique, case-insensitive), `salaryMinPaise`, `salaryMaxPaise` (the typical Bengaluru monthly range), `minimumWageLevel` (`unskilled`, `semi_skilled`, `skilled`, `highly_skilled`; default `unskilled`), `active`, `sortOrder`, `createdAt`, `updatedAt`.
  - Seeded with Agastya's starting list (monthly, in paise):

    | Trade | Min | Max |
    |---|---|---|
    | Housekeeping | ₹16,000 | ₹23,000 |
    | Cook | ₹18,000 | ₹30,000 |
    | Kitchen helper | ₹15,000 | ₹20,000 |
    | Waiter | ₹15,000 | ₹22,000 |
    | Driver | ₹20,000 | ₹30,000 |
    | Delivery rider | ₹22,000 | ₹35,000 |
    | Security guard | ₹17,000 | ₹24,000 |
    | Electrician | ₹21,000 | ₹32,000 |
    | Plumber | ₹20,000 | ₹30,000 |
    | Carpenter | ₹20,000 | ₹32,000 |
    | Painter | ₹18,000 | ₹28,000 |
    | AC technician | ₹20,000 | ₹30,000 |
    | Helper / loader | ₹15,000 | ₹22,000 |
    | Warehouse packer | ₹19,000 | ₹27,000 |
    | Retail staff | ₹15,000 | ₹22,000 |
    | Caretaker / nanny | ₹15,000 | ₹23,000 |
- New table `TradeSuggestion`:
  - `id`, `typedName`, `typedByStaffId`, `subjectType`, `subjectId`, `status` (`waiting`, `added`, `mapped`, `dismissed`), `mappedToTradeId`, `decidedByStaffId`, `decidedAt`.
  - When an agent picks **Other** and types a trade, the profile or vacancy **saves straight away** with the typed name, and a `waiting` suggestion is created (one per distinct typed name; later typings of the same name only add the subject).
- **CEO and Manager** can:
  - list trades and waiting suggestions;
  - add, edit and deactivate a trade;
  - **Add** a suggestion (creates the trade);
  - **Map** a suggestion to an existing trade, which rewrites the typed name to the trade's name on every job seeker trade and vacancy that used it, in one transaction, audit-logged.
- Matching uses only listed, active trade names. A job seeker whose only trade is an unlisted Other is not matched until it is added or mapped (Master Guide).
- **Existing rows:**
  - The migration does not rename existing trade strings.
  - A read-only report endpoint (CEO/Manager) lists distinct existing trade strings that match no listed trade, with counts, so the CEO can map them using the same Map action.
- **Legal minimum wage:**
  - Four figures (`unskilled`, `semi_skilled`, `skilled`, `highly_skilled`, monthly basic in paise) and their `effectiveFrom` are kept with the pricing policy. Seed them with Bengaluru Zone 1 from 22 May 2026: ₹23,376 · ₹25,714 · ₹28,286 · ₹31,114.
  - Only the CEO changes them, audit-logged.
- Endpoint `GET /trades` (any logged-in staff) returns active trades in order, with the salary range and the legal minimum for each trade's level, for the forms' dropdown and hint.
- Tests:
  - The seed matches the table above.
  - Other saves immediately and creates one suggestion.
  - Map rewrites every use and is audit-logged.
  - An unlisted-only job seeker doesn't appear in matching, then does once mapped.
  - Only the CEO changes the minimum wage figures.
  - Managers can manage trades but not money settings.

### [x] Task 3 — Checking a mobile number by OTP during the call
**Branch:** `phase-20/task-3-phone-check` · **Migration folder:** `20261113110000_phone_check`

**Acceptance:**
- **Before sending an OTP, the number is checked for duplicates.**
  - `POST /otp/send` takes `{ phone, purpose }`. Purpose is one of `job_seeker`, `business_contact`, `referral`, `vacancy_confirm`, `branch_contact`.
  - If the number already belongs to a job seeker, business (main or additional contact, or a branch contact) or referral partner, it returns `{ alreadyRegistered: true, type, code }` (e.g. `JS-1042`) and **sends nothing**, so the screen can show "Already registered — open it". Only staff who may see that record get its code; others get `{ alreadyRegistered: true }` only.
  - For `vacancy_confirm` the duplicate check is skipped.
- **Resend rules** (Master Guide):
  - Resend unlocks **30 seconds** after the last send, **at most 3 resends** per request.
  - A wrong code returns a clear "wrong code" error and counts as an attempt; after 5 wrong attempts that request is dead and a fresh one is needed.
  - Responses include `resendAvailableAt` and `resendsLeft`.
- A verified OTP request can be used **once**, for the phone it was sent to, to create one record. Reusing it is refused.
- Every send and verify is in the audit log without the code and with the phone masked to its last 4 digits (keep the existing `otp.send_attempt` entry).
- Tests:
  - A duplicate number returns the existing code and sends no SMS.
  - A role that can't see the record gets no code.
  - Resend before 30 seconds is refused.
  - The fourth resend is refused.
  - The fifth wrong code kills the request.
  - A verified request can't create two records.

### [x] Task 4 — The one job seeker registration form
**Branch:** `phase-20/task-4-job-seeker-form` · **Migration folder:** `20261113120000_job_seeker_form`

**Acceptance:**
- **One create endpoint** used by call agents, field agents, Team Leads, Managers and the CEO.
- **Required when saving** (Master Guide, "Required on the first call"):
  - full name;
  - mobile with a verified OTP request (Task 3);
  - language for messages (`kn`, `hi`, `en`);
  - best time to call: one of the four slots `09-12`, `12-15`, `15-18`, `18-21`, or any time `09-21`. Store as today's window start/end.
  - date of birth: refused if under the policy's adult age, 18;
  - gender;
  - **how they heard about Laboura**: new field `heardFrom`, closed list `toll_free_missed_call`, `ad`, `referral_partner`, `field_visit`, `social_media`, `walk_in`, `other`. With `referral_partner` a valid referral partner may be given as `referredById`. A partner can never be credited for referring themselves (same phone).
  - locality and pincode, map pin, travel distance;
  - trade with years, plus up to **2 more** trades with years (each from the list or Other, Task 2);
  - available from, looking since;
  - expected salary minimum and maximum, per month or day;
  - shift preference, job type;
  - languages **spoken only**. New rows set `speaks = true`. Reads and writes are no longer asked; keep the columns, don't remove them.
- **Optional** fields stay as they are today (Master Guide, "Optional").
- **Salary warning:**
  - If the expected minimum is above the top of the primary trade's range, the response carries `warnings: ["salary_above_market"]` with the range. It still saves.
  - Store `guaranteeFloorPaise` = the lower of his monthly minimum and the top of the primary trade's range (Master Guide, "Market salary ranges and the guarantee"). For daily pay, convert with `salaryDaysPerMonth`.
  - If the primary trade is an unlisted **Other** with no managed range, registration can continue through consent, selfie and ID, but the terms-and-payment step stays blocked until a CEO or Manager adds or maps the trade. The status panel shows Payment as `stuck` with the reason `Waiting for the new trade to be added in the Command Center`. Until then, `guaranteeFloorPaise` is unset. Once the trade is added or mapped, calculate the floor normally as the lower of the candidate's monthly minimum and the trade's top, then unblock payment.
  - It is recalculated if the trade or minimum changes before payment, and **frozen at payment** (it is part of the terms he agrees to).
  - The matching engine treats an offer at or above `guaranteeFloorPaise` as suitable for hits, and lists near-misses down to 10% below it marked `below_minimum_ask_him`. Turning one down is never a hit.
- The record is created with status `lead`, and the job seeker gets a JS- ID. The response includes the code.
- **Drafts are not stored on the server** (the screen keeps them).
- Tests:
  - Every required field is enforced, one test per field group.
  - Under 18 is refused.
  - A fourth trade is refused.
  - Other creates a suggestion.
  - An unlisted primary Other has no guarantee floor and cannot proceed to payment until its trade is added or mapped; adding or mapping it calculates the floor and unblocks payment.
  - The salary warning appears and still saves.
  - The guarantee floor is the lower of the two and freezes at payment.
  - Matching counts an offer at the floor as suitable and lists a 9%-below offer as a near-miss, not a hit.
  - Self-referral is refused.

### [x] Task 5 — The registration link that resumes
**Branch:** `phase-20/task-5-registration-link` · **Migration folder:** `20261113130000_registration_link`

**Acceptance:**
- **One registration link by SMS, valid 48 hours** (`PublicLink` purpose `registration`). It opens only after an OTP sent to the job seeker's **own registered number**, wherever the link is opened.
- **Steps, in a fixed order:**
  1. **Consent:** each purpose ticked separately, using the existing consent capture.
  2. **Selfie:** live camera only. The page sends a capture taken from the camera stream. The server rejects a file upload marked as coming from the gallery and stores it with the existing candidate photo storage.
  3. **ID check:**
     - DigiLocker Aadhaar first, the Aadhaar QR fallback next. **PAN, driving licence or voter ID** are offered whenever Aadhaar fails (name mismatch, phone not linked) or the Aadhaar service is down.
     - Use the existing `IdentityVerification` (mock provider) and keep only result, last 4 and 18+.
     - **Under 18 stops here**, before payment.
     - A name mismatch that looks like a spelling difference raises a `name_check` review flag (add it to the closed list in `review-flag.constants.ts`) for the agent's Team Lead, and the step waits.
     - A provider or network failure (timeout, 5xx, connection error) marks the ID service **down**. A person's result (name mismatch, phone not linked, under 18) never marks the service down. Store the current `up`/`down` state and when it last changed, and expose both through the existing system status endpoint for the System Health screen.
     - Add `checkHealth()` to `KycProvider`. The mock reports healthy by default, with a test-only switch to report down. Every 15 minutes, a scheduled worker job probes with `checkHealth()` while the ID service is down. The job must also be runnable through the existing manual job trigger.
     - "Service down — tell me when it's back" stores a request. When the probe reports healthy, mark the service up, send the "ID check is working again" SMS once to each person who opted in, and resume their registration link at the ID step. If their old link expired, create a fresh link and revoke the old one.
  4. **Terms and ₹499:** the page shows his exact terms (trade, distance, shift, salary floor). He ticks to agree, then pays with the existing UPI collection flow.
- **Resuming:**
  - Every step already done is skipped; nothing is asked twice.
  - **Resend link** creates a new link that opens at the first unfinished step and **revokes the old one**.
  - The completing device is recorded (Task 1 fields).
- **Payment-only link:**
  - Once he reaches payment, he or the agent can send a payment-only link to **another number** (purpose `payment_only`, **valid 15 minutes**).
  - It shows only his first name, JS- ID and ₹499 — no profile, no consent.
  - A fresh one replaces it in one tap.
  - **If two activation payments succeed for the same job seeker, the later one is refunded automatically** and recorded as such (check what `upi-collection.service.ts` does today; add only what is missing).
- **Status panel endpoint** for the agent's screen: Phone verified, Consent, Selfie, ID check, Payment. Each has a state (`done`, `in_progress`, `not_started`, `stuck`), a time, and a plain reason when stuck (e.g. "UPI failed twice", "Name didn't match"), plus the link's expiry and whether a payment-only link is live.
- **Preview what he'll see:** a read-only render of the step he is on, for staff.
- **View signed consent:** a read-only view of the purposes ticked, language, time and OTP verified.
- **Status transitions:**
  - After consent the job seeker becomes `consented`.
  - After a successful payment the job seeker becomes `pending_activation` or `active` exactly as today.
  - Withdrawing consent pauses the profile (keep the existing rule).
- **The old separate consent link for job seekers is replaced by this link.** Keep the old route working for links already sent until they expire, then remove it in a later phase. Note it in `LESSONS.md`.
- Tests:
  - The full path consent → selfie → ID → payment.
  - Resuming after each step opens at the right step.
  - Resend revokes the old link.
  - The OTP always goes to the registered number.
  - Under 18 stops before payment.
  - Aadhaar failure offers the other IDs.
  - A provider/network error marks the ID service down; a name mismatch does not.
  - The recovery probe marks it up and sends one SMS per waiting person.
  - An expired registration link is replaced on recovery and the old link is revoked.
  - The payment-only link shows no profile data and expires after 15 minutes.
  - A second payment is refunded automatically.
  - The status panel shows the right state and reason at each point.
  - A gallery upload is refused.

### [x] Task 6 — Registering a referral partner
**Branch:** `phase-20/task-6-referral-partners` · **Migration folder:** `20261113140000_referral_partner_form`

**Acceptance:**
- **Registered by call agents and field agents** (and Team Leads and above). Anyone can be a partner, including a job seeker.
- **Fields:**
  - full name;
  - mobile checked by OTP (Task 3);
  - WhatsApp number;
  - language for messages;
  - **individual or business**:
    - individual: `auto_driver`, `shop_staff`, `shop_owner`, `security_guard`, `existing_worker`, `other`;
    - business: link an already registered business, or enter its type and name;
  - locality, pincode, optional map pin;
  - `heardFrom` (same list as Task 4).
- **On saving:**
  - an **RF- ID** is created and sent by SMS;
  - one resuming link (purpose `referral_registration`, 48 hours, OTP to their own number) takes them through: referral terms and call-recording consent (existing referral terms) → selfie (live camera) → ID check (as Task 5, any government ID) → UPI ID entered by them, checked against the name on the ID with the existing payout-account name check;
  - **agents never type a UPI ID** for anyone.
- Business partners go through the same steps.
- A partner earns the ₹200 only for a referred **job seeker who joins**. Nothing for referring businesses (not decided). Never for referring themselves.
- A status panel endpoint like Task 5's: terms, selfie, ID, UPI.
- Tests:
  - Each required field is enforced.
  - The RF- ID SMS is sent.
  - The link resumes.
  - The UPI name check flags a mismatch.
  - Self-referral earns nothing.
  - An agent can't submit a UPI ID through any staff route.

### [x] Task 7 — The business form and branches
**Branch:** `phase-20/task-7-business-form` · **Migration folder:** `20261113150000_business_form`

**Acceptance (Master Guide, "The registration form" for businesses):**
- **Contact person:**
  - name, role (`owner`, `manager`, `hr`, `supervisor`, `other`), mobile checked by OTP (Task 3), WhatsApp, language;
  - this person is Laboura's point of contact and may sign the agreement by ticking a box on the business's behalf. The existing agreement flow records who signed and their role.
- **Business:**
  - shop board name (existing `name`), legal name;
  - type from the list (`restaurant_hotel`, `bakery`, `retail_shop`, `supermarket`, `apartment_society`, `household`, `office`, `factory`, `warehouse`, `hospital_clinic`, `construction`, `security_agency`, `salon`, `other`);
  - employees now (bands `1-5`, `6-20`, `21-50`, `51-200`, `200+`);
  - years running (bands);
  - how often they hire;
  - opening and closing time;
  - working days.
  - **Household:** a family name instead of a legal name, and no GST or licence fields.
- **Address:** shop or building number, street, landmark, locality, pincode, map pin. Keep the existing storefront photo at the visit.
- **Documents, all optional:**
  - GSTIN (checked online as today), FSSAI (food businesses), Shop and Establishment / Udyam / trade licence, PAN;
  - or a **No documents** tick, which raises the existing extra-care check for the Team Lead.
- **Billing email** (for the GST invoice and agreement copy) and **`heardFrom`** (same list as Task 4).
- **Branches:**
  - new table `BusinessBranch`: `businessId`, name, address parts, locality, pincode, map pin, contact person name, role and OTP-checked mobile.
  - One business, one agreement, several branches.
  - A vacancy may belong to a branch. Interview results and payment links for that vacancy go to **that branch's contact person**.
- **Staff needed:**
  - rows of trade (from the list or Other), how many, salary range, shift, start date.
  - Each row becomes a **draft** vacancy (Task 8) that the agent completes later.
- Existing businesses keep working. New fields are nullable, and the migration copies the existing owner name and phone into the contact person.
- Tests:
  - Required contact fields are enforced and the OTP is checked.
  - A household hides GST and licences.
  - A branch gets the interview result message for its vacancy.
  - Staff-needed rows create drafts.
  - Old businesses still load and their contact is filled from the owner fields.
  - The duplicate check finds a branch contact's number.

### [ ] Task 8 — Every vacancy confirmed by OTP, and the minimum-wage warning
**Branch:** `phase-20/task-8-vacancy-confirm` · **Migration folder:** `20261113160000_vacancy_confirm`

**Acceptance:**
- **New vacancy statuses:**
  - `draft`: from staff-needed rows; incomplete.
  - `awaiting_confirmation`: complete, waiting for the contact person.
  - The existing `open | filled | cancelled` stay. **Matching, introductions and interviews only use `open`** (check every query that lists vacancies for matching).
- **Confirmation:**
  - Completing a vacancy sends the business's (or branch's) contact person an OTP with the details: trade, how many, salary, shift, start date.
  - The agent types the code the owner reads out, and the vacancy becomes `open`.
  - **If the owner isn't there:** a `vacancy_confirm` link by SMS (48 hours, OTP to the contact's number) lets them confirm later. The vacancy stays `awaiting_confirmation` until then.
  - Who confirmed, when and how (code on call or visit, or link) is recorded and audit-logged.
- **Existing open vacancies stay `open`** (no back-dated confirmation).
- **Legal minimum wage:**
  - If the monthly salary *from* is below the legal minimum for the trade's level (Task 2), saving needs `ownerToldMinimumWage: true`. The vacancy is marked `belowLegalMinimum`, and the response carries the figure.
  - A Team Lead and Manager list shows these vacancies.
  - Daily pay is converted with `salaryDaysPerMonth`.
- Call agents may add a vacancy to any business. The business's account agent gets a message. It counts towards the creator's "vacancies captured" (existing target metric), and only after confirmation.
- Tests:
  - A draft and an awaiting vacancy never appear in matching.
  - The code on the call opens it.
  - The SMS link confirms it later.
  - A wrong or expired code is refused.
  - Below-minimum without the tick is refused, and with the tick is saved and marked.
  - "Vacancies captured" counts only confirmed vacancies.
  - A branch vacancy's OTP goes to the branch contact.

---

## Phase 20 Gate

- [ ] Every public link and real-provider OTP survives a restart; no raw token or phone is stored — by test
- [ ] Trades come from the managed list; Other saves and is added or mapped by the CEO or a Manager; ranges and minimum wages are in force — by test
- [ ] OTP resend waits 30 seconds, allows 3 resends, and a duplicate number opens the existing record instead of sending — by test
- [ ] The job seeker form enforces the required fields; the guarantee floor is the lower of his minimum and the trade's top and freezes at payment — by test
- [ ] One 48-hour link resumes consent → selfie → ID → payment; the payment-only link lasts 15 minutes and shows nothing private; a second payment is refunded — by test
- [ ] Referral partners are registered by agents with an RF- ID and a resuming link ending in a name-checked UPI — by test
- [ ] Businesses have a contact person, branches and staff-needed drafts; vacancies open only after the contact's OTP; below-minimum vacancies are warned and marked — by test
- [ ] `docs/api/phase-20.md` documents every new endpoint
- [ ] **End-to-end proof, recorded in the report:**
  1. A call agent checks a new number by OTP, after a resend refused at 10 seconds and allowed at 31.
  2. The agent registers a housekeeper asking ₹25,000 (the range tops at ₹23,000): the warning shows and the floor is ₹23,000.
  3. The app restarts, and the registration link still works.
  4. The job seeker gives consent, takes a selfie, fails Aadhaar on a name mismatch and passes with PAN.
  5. The brother pays on a payment-only link. A duplicate payment is refunded automatically.
  6. A field agent registers a bakery with a second branch and two staff-needed rows. One draft is completed below the legal minimum (with the tick), and the branch contact confirms it by OTP. Only then does it appear in matching.
  7. A referral partner is registered and finishes their link with a UPI ID whose name matches.
- [ ] All earlier phase gate items still pass; CI green on `main`; every task branch was green before merging; `LESSONS.md` updated

**When the gate passes: stop and report to Agastya.** Include commits, CI links, test counts, one line per task, any tests changed and why, and the end-to-end proof. Do not start anything else.
