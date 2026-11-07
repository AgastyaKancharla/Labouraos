# Phase 15 — Offers and Interviews

**Goal:** an offer is a real interview at a real, verified business, checked as suitable by the software. The candidate replies within 48 hours — by tapping a link or on a recorded call. The business name and address reach the candidate only once they confirm. The owner records the result on their own phone by OTP, by 8 PM the same day; the candidate is asked separately whether they were offered the job, and any mismatch is flagged. A selected candidate becomes a placement waiting for payment — and the worker is marked `placed` only once the fee is actually paid.

**Why this is next:** step 7 of the build order in `specs/data-design.md` §16 (§8). Rules from the Master Guide: "The 30-day guarantee", "Hits", "From first visit to joining", "Stopping bypass".

**Decisions confirmed with Agastya (7 Nov):**
1. **The candidate can reply both ways:** tap Yes/No on the link in the offer SMS or WhatsApp, or tell an agent on a recorded call.
2. **If the owner never records a result:** after `interviewResultCloseHours` (48) from the end of the slot the interview closes as `no_result`. **It is not a hit**; the candidate goes back into matching; the business gets an `interview_no_result` flag.

**Read first:** `AGENTS.md`, `LESSONS.md`, this whole spec, `specs/data-design.md` §1, §2, §4 (`JobSeekerHit`), §8. Read `src/modules/placement/placement.service.ts` (`create`, `respond` — the old offer flow being replaced), the Phase 12 consent link/OTP machinery (reuse it for every link in this phase), the Phase 14 `MatchingService` and its two helpers `hasLiveOffer` and `businessRejected`, and the Phase 13 notice mechanism and `VisitAssignment`.

**Known traps in the current code (checked 7 Nov — handle them, don't stop on them):**
- Today `POST /placements` creates a placement in `offered` and `POST /placements/:id/respond` accepts it, creates the fee `Payment` and **sets the job seeker to `placed` immediately** — before any money is paid. That breaks the guide's rule. Both endpoints are removed for fresh vacancies (Task 5); `placed` is set only when the fee payment succeeds.
- `Placement.status` defaults to `offered`. Old rows keep their old values (test data) — readable, never written again.
- The replacement-candidate endpoints (`/placements/:id/replacement-candidates…`) stay exactly as they are; replacements move to the new flow in Phase 17. **Interviews in this phase are for fresh vacancies only** — refuse a vacancy with `replacementForPlacementId` set, with a clear message.

**Out of scope — do not build:** UPI collection, QR codes, bank confirmation and the GST invoice change (Phase 16 — until then the fee payment is created through today's existing payment path), replacement claims and the new guarantee rules (Phase 17), follow-up calls on day 7/30/90 (Phase 17), video interviews.

---

## How this phase runs

One task after another, in order, each on its own branch; build on the latest `main`, push, wait for GitHub Actions green **on the branch**, fix on the branch, merge by pull request, tick. Locally run only your own tests. Every rule number comes from `PricingService.current()`. Every link sent outside the app uses `publicLink()`. If the spec and code disagree in a way this spec doesn't answer, stop and ask.

---

### [x] Task 1 — The interview and the offer
**Branch:** `phase-15/task-1-interview-offer` · **Migration folder:** `20261108100000_add_interview`

**Acceptance:**
- `Interview` exactly as data-design §8, with an `INT` code prefix and sequence sync. `status` closed list: `offered`, `confirmed`, `declined`, `no_reply`, `completed`, `no_show`, `cancelled`, **`no_result`** (added 7 Nov). Add `cancelReason` (string?) and `vacancyInterviewSlotId`.
- New `PricingPolicy` column `interviewResultCloseHours`, default **48**.
- `POST /interviews` with `{ vacancyId, jobSeekerId, slotId }` (call agent; field agent for their own-account businesses; Team Lead, Manager, CEO). Refused unless:
  - the business is `verified` and the vacancy is not a replacement vacancy;
  - the candidate passes **every** Phase 14 matching rule right now (call `MatchingService` — don't re-implement the rules);
  - the slot belongs to the vacancy, is in the future, and has capacity left (`capacity` minus interviews in `offered`/`confirmed` on that slot).
- On success: status `offered`; `suitabilitySnapshot` stores the checks that passed (trade, salary, distance, shift, slot) — this is the evidence the offer was suitable; `offerSentAt` = now; `replyDueAt` = `offerSentAt` + `offerReplyHours`.
- The offer goes out at once through `MessagingService` as **both SMS and WhatsApp** (template `interview_offer`) with job type, area (locality), salary range, shift, day and time — **never the business name or address** — and a single-use Yes/No link.
- Booking logs a `CandidateIntroduction` with a new `channel` value `interview` (the no-bypass clause counts "an interview booked").
- Extend the Phase 14 helper `hasLiveOffer` to include an `Interview` in `offered` or `confirmed`.
- Tests: an offer to a candidate who fails any matching rule is refused; a full slot is refused; a replacement vacancy is refused; the offer messages contain no business name or address; `replyDueAt` is 48 hours later, read from `PricingPolicy`; booking writes an introduction; a candidate with a live offer no longer appears in matching.

### [x] Task 2 — The candidate's reply, and what a reply means
**Branch:** `phase-15/task-2-candidate-reply` · **Migration folder:** `20261108110000_interview_reply`

**Acceptance:**
- **By link:** the job seeker taps Yes or No on the single-use link. Yes → `confirmed`; No → `declined`. `candidateRespondedAt` set. The link expires at `replyDueAt`.
- **By call:** on an **answered** `CallRecord` with `purpose: offer` to that job seeker (Phase 11 — answered comes only from the webhook), the agent records `accepted_offer` → `confirmed`, or `rejected_offer` with a reason → `declined`. The interview stores the `callRecordId`. An unanswered call can't record a reply (Phase 11 rule already holds).
- **On `confirmed`:** the business name, address, time and contact person go to the candidate by SMS and WhatsApp (template `interview_booked`); `businessDetailsSentAt` set. The owner is sent the candidate's **first name, photo link and time only** (template `interview_candidate_for_owner`). The owner's number is never sent to the candidate.
- **On `declined`:** a `JobSeekerHit` with reason `offer_declined`, `interviewId` set, and `callRecordId` when declined on a call. This ends the refund (Phase 12 rule).
- **No reply by `replyDueAt`** (a scheduled job): if at least one call with `purpose: offer` was placed to the candidate after `offerSentAt` (answered or not), and the SMS and WhatsApp were sent, the interview becomes `no_reply` and a hit `offer_no_reply` is recorded. If **no call was ever placed**, it is not the candidate's fault: `cancelled`, `cancelReason: offer_not_followed_up`, **no hit**.
- Every status change writes `StatusHistory`.
- Tests: Yes by link confirms and sends the business details; No by link declines and records one hit; an agent can record a reply only on an answered offer call; a declined offer's hit carries the call id; no reply after a call → `no_reply` + hit; no reply with no call → `cancelled`, no hit; a used or expired link is refused; business details never go out before `confirmed`.

### [x] Task 3 — An agent at the interview when needed
**Branch:** `phase-15/task-3-attendance` · **No migration**

**Acceptance:**
- `agentAttendanceRequired` is set at booking when **any** is true: it is the first interview ever booked with this business; the business is `no_documents`; or the business has an open `business_many_rejections`, `business_stopped_after_interviews` or `interview_no_result` flag.
- When required, a `VisitAssignment` with `purpose: interview_attendance` and `relatedType: interview` is created on confirmation, suggested and assigned exactly like Phase 13 verification visits. The completed visit sets `attendanceVisitId`.
- Attendance is evidence only — it never replaces the owner's OTP result (Task 4).
- Tests: the first interview with a business requires attendance; the second doesn't (unless no-documents or flagged); a `no_documents` business always does; the attendance assignment is created on confirmation, not on offer.

### [x] Task 4 — The result, the deadlines and the candidate check
**Branch:** `phase-15/task-4-result` · **Migration folder:** `20261108120000_interview_result`

**Acceptance:**
- `resultDueAt` = `interviewResultDeadline` (20:00 IST) on the slot's day.
- When the slot ends, the owner gets a single-use link (template `interview_result_request`). On their own phone, after OTP, they choose: **selected** (and confirm the monthly salary and the joining date), **not selected** with a reason from the closed list (skills, experience, communication, salary_expectation, not_suitable, other), or **candidate didn't come**. `result`, `resultReason`, `resultOtpRequestId`, `resultRecordedAt` set; status → `completed` (or `no_show`). **No staff route can record a result** — the owner's OTP is the signature on a "not selected".
- **At the same moment** the candidate gets an automatic message (template `candidate_offer_check`) with a Yes/No link: "Did they offer you the job?" → `candidateCheckAnswer` (`offered_yes`, `offered_no`; `no_answer` if never tapped), `candidateCheckAt`.
- **Mismatch:** owner `not_selected` (or no result) **and** candidate `offered_yes` → `interview_result_mismatch` `ReviewFlag` to the Team Lead, the same day.
- **Candidate didn't come** → hit `interview_no_show` with `interviewId`.
- **Not selected** is never a hit. Extend the Phase 14 helper `businessRejected` so this business is never shown this candidate again.
- **Deadline jobs:** at `resultDueAt` with no result → a notice to the account agent to call the owner; at slot end + `interviewResultEscalateHours` (24) → `interview_result_overdue` flag to the Team Lead; at slot end + `interviewResultCloseHours` (48) → status `no_result`, **no hit**, the candidate is free for matching again, and an `interview_no_result` flag on the business (add it to the `ReviewFlag` closed list).
- Tests: only the owner's OTP submission records a result; a no-show records a hit, not-selected doesn't; a not-selected candidate is never matched to that business again; the mismatch flag is raised; each deadline fires at the right time and only once; after 48 hours the interview is `no_result`, no hit, and the candidate appears in matching again.

### [x] Task 5 — Selected becomes a placement waiting for payment
**Branch:** `phase-15/task-5-placement-from-interview` · **Migration folder:** `20261108130000_placement_from_interview`

**Acceptance:**
- New `Placement` columns from data-design §8: `interviewId`, `selectedAt`, `paymentDueAt`, `paidAt`, `joiningDate`, `rootPlacementId`, `replacementNumber`, `feePercentAtCreation`, `gstPercentAtCreation`, `guaranteeEndedReason`. Status closed list for new rows: `awaiting_payment`, `cancelled`, `confirmed`, `active`, `dropped_out`, `replaced`, `completed`, `guarantee_ended`. `clockPaused`, `clockPausedAt`, `replacementRejectionCount` marked `@deprecated` (Phase 17 stops using them).
- **A `selected` result creates the placement** in `awaiting_payment`: `selectedAt` = now, `paymentDueAt` = now + `placementPaymentDueHours` (24), `rootPlacementId` = its own id, `replacementNumber` 0, the salary the owner confirmed as `agreedSalary`. **The fee uses the business's signed agreement**, not today's price: `feePercentAtCreation` and `gstPercentAtCreation` are copied from the latest signed `BusinessAgreement`; `placementFee` = salary × fee percent; `gstAmount` = fee × GST percent; all in paise.
- **Until Phase 16**, the fee `Payment` is created through today's existing payment path, exactly as `respond` does now, so the system stays usable. Phase 16 replaces only that step.
- **The job seeker becomes `placed` only when the fee payment succeeds** — wire this into the existing payment-succeeded handling. At that moment: `paidAt` set, placement → `confirmed`, the joining date is confirmed to the candidate by SMS/WhatsApp (template `joining_confirmed`), and the candidate's full contact details may now be shared with the business.
- Unpaid at `paymentDueAt` → `payment_overdue` `ReviewFlag`; the joining date is **not** sent.
- **Remove** `POST /placements` and `POST /placements/:id/respond` (the old offer flow). Leave a test that each now returns 404 for every role, like earlier removed endpoints. The replacement-candidate endpoints stay.
- Tests: a selected result creates one `awaiting_payment` placement with the agreement's percentages; changing `PricingPolicy` afterwards doesn't change it; the job seeker is **not** `placed` before payment; payment success sets `placed`, `paidAt`, `confirmed` and sends the joining date once; an overdue payment raises the flag and sends nothing; the two old endpoints return 404.

### [x] Task 6 — Screens
**Branch:** `phase-15/task-6-screens` · **No migration**

**Acceptance (existing consoles, plain styling):**
- From a shortlist card: **Book interview** with the vacancy's slots and remaining capacity.
- Interview list per agent and per vacancy: status, reply due, result due, whether attendance is needed; an **Offer reply** form that appears only after an answered offer call.
- Team Lead view: overdue results, mismatches, `no_result` interviews.
- Placement page: awaiting payment, due time, paid or overdue.
- Tests: screens render for the allowed roles; no business name shows in the candidate's offer view before confirmation; no full phone number on any agent page.

---

## Phase 15 Gate

- [ ] An offer is refused unless the candidate passes every matching rule and the slot has room; the suitability snapshot is stored — by test
- [ ] The business name and address reach the candidate only after they confirm; the owner gets first name, photo and time only — by test
- [ ] A reply counts only from the candidate's own link tap or an answered, recorded offer call — by test
- [ ] Declined, no reply after a documented call, and no-show each record one hit; not selected and `no_result` never do — by test
- [ ] Only the owner, by OTP on their own phone, records a result; a mismatch with the candidate's answer is flagged — by test
- [ ] The 8 PM notice, the 24-hour flag and the 48-hour close each fire once at the right time — by test
- [ ] The fee comes from the signed agreement; the worker is `placed` only after payment succeeds — by test
- [ ] The old `POST /placements` and `/respond` are gone — by test
- [ ] **End-to-end proof, recorded in the report:** a matched candidate is offered a walk-in slot; the SMS has no business name; they tap Yes and receive the business address; the first-interview attendance visit is assigned; after the slot the owner selects them by OTP with ₹16,000 salary and a joining date; the candidate answers "yes, offered"; a placement appears `awaiting_payment` with the fee from the agreement; the job seeker is still `active`; the payment succeeds; the job seeker is `placed` and receives the joining date. Separately: a second candidate never replies after a recorded call → `no_reply` and a hit; a third interview gets no owner result → overdue flag at 24 hours, `no_result` at 48 hours, no hit, and that candidate reappears in matching.
- [ ] All earlier phase gate items still pass; CI green on `main`; every task branch was green before merging; `LESSONS.md` updated

**When the gate passes: stop and report to Agastya.** Commits, CI links, test counts, one line per task, any tests changed and why, and the end-to-end proof. Do not start the next phase.
