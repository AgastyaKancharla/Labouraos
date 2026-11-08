# Phase 17 — After Joining

**Goal:** a joining counts only when calls to both sides confirm it. The 60-day guarantee runs from the first worker's joining date and never restarts; a dropout is a claim with a fixed reason, reported within 7 days on a paid placement, decided by a Team Lead or Manager within 48 hours. Replacements go through the same interview flow as any candidate, free, at most two. Follow-up calls catch a worker about to leave and a business that quietly hired a "not selected" candidate. Pattern flags show businesses and agents that look wrong. The ₹200 joining reward is queued after 30 days in the job.

**Why this is next:** step 8 of the build order in `specs/data-design.md` §16 (§8 Placement rules, §9, §10 joining reward, §11). Rules from the Master Guide: "From first visit to joining", "Stopping bypass", "The 60-day replacement guarantee", "Refunds", and the decision of 7 Nov below.

**Decision recorded in the Master Guide (7 Nov):** a candidate who has paid and then withdraws consent for **job matching, profile sharing or call recording** gets **no ₹499 refund**. Withdrawing job updates or promotions changes nothing.

**Read first:** `AGENTS.md`, `LESSONS.md`, this whole spec, `specs/data-design.md` §1, §2, §8, §9, §10, §11. Read in `src/modules/placement/placement.service.ts`: `recordJoined`, `recordDropout`, `offerReplacementCandidate`, `rejectReplacementCandidate`, `acceptReplacementCandidate`, `approveRefund` and `evaluatePlacementRefundEligibility`; `src/modules/refund/refund.service.ts`; the Phase 15 interview code in `src/modules/vacancy/interview.service.ts`; the Phase 14 helper `firstIntroduction`.

**Known traps in the current code (checked 7 Nov — handle them, don't stop on them):**
- `recordJoined` lets any agent mark a placement joined with any date (default: now). It becomes call-confirmed (Task 1).
- `recordDropout` uses an `eligibility` switch (`employee_left` / `business_breach`) and the paused clock. It is **replaced** by `ReplacementClaim` (Task 2) and removed.
- `acceptReplacementCandidate` sets the job seeker `placed` directly, and the three replacement-candidate endpoints run outside the interview flow. They are **replaced** by interviews on a replacement vacancy (Task 3) and removed. `ReplacementCandidate` stays, plus `interviewId`, as the history record.
- `approveRefund` / `evaluatePlacementRefundEligibility` read `clockPaused`, `clockPausedAt` and `eligibility`. They are rewritten to the new rules; the deprecated columns are no longer read.
- Phase 15 refuses interviews on replacement vacancies. Task 3 lifts that.
- **Money out is not changed here.** The way a refund, referral payout or reward is actually paid stays exactly as it is; Phase 18 replaces it. This phase decides **who is owed what, and when**.

**Out of scope — do not build:** paying money out, `PayoutAccount`, collecting the candidate's UPI ID (Phase 18), billing a bypass charge (flag only — the legal notice is manual), the field agent app.

---

## How this phase runs

One task after another, in order, each on its own branch; build on the latest `main`, push, wait for GitHub Actions green **on the branch**, fix on the branch, merge by pull request, tick. **Commit and push the task branch after every meaningful change.** GitHub Actions is the test runner. Every rule number comes from `PricingService.current()`; every link sent outside the app uses `publicLink()`. If the spec and code disagree in a way this spec doesn't answer, stop and ask.

---

### [x] Task 1 — Joining confirmed by calls; the placement completes on day 60
**Branch:** `phase-17/task-1-joining` · **Migration folder:** `20261110100000_joining_confirmation`

**Acceptance:**
- Add `joining_confirmation` to the `CallRecord.purpose` closed list.
- `POST /placements/:id/joined` now requires, for a `confirmed` placement on or after its `joiningDate`: an **answered** `CallRecord` with `purpose: joining_confirmation` to the **job seeker** and one to the **business**, both made on or after `joiningDate`. Both call ids are stored on the placement (`joiningWorkerCallId`, `joiningBusinessCallId`). Otherwise refused with what's missing. `joinedDate` = the day both were confirmed — never a date typed by an agent.
- On joining: placement → `active`; the referral partner's ₹200 is queued exactly as today (no change to how it is paid).
- A daily job moves an `active` placement to `completed` on day `replacementWindowDays` (60) after its **root** placement's `joinedDate`, unless a claim is open on it or its guarantee has ended.
- Tests: joining is refused with only one side confirmed, with an unanswered call, or before the joining date; with both it sets `active` and `joinedDate`; no request field can set `joinedDate`; day 60 completes the placement once; an open claim stops completion.

### [x] Task 2 — Replacement claims
**Branch:** `phase-17/task-2-claims` · **Migration folder:** `20261110110000_add_replacement_claim`

**Acceptance:**
- `ReplacementClaim` exactly as data-design §9, with a `RCL` code prefix. `reason` closed lists — **accept:** `resigned`, `absconded_3_days`, `never_joined`, `serious_misconduct`, `repeated_absence`, `skill_gap_15_days`, `misrepresentation`; **reject:** `business_closed`, `role_changed`, `salary_unpaid`, `unsafe_workplace`, `fired_without_reason`, `hired_own_person`. Add `exit_call` to the `CallRecord.purpose` list if missing.
- **Reporting:** `POST /placements/:id/claims` by the account agent, any call agent, Team Lead, Manager or CEO, recorded **on an answered call with the owner** (`callRecordId` of that call is required and stored), with `workerLeftOn`, the reason and optional evidence uploads (private storage, as Phase 13 photos). Only for an `active` placement whose worker left within `replacementWindowDays` of the **root** `joinedDate`.
- **Automatic rejection, with the reason recorded:** reported more than `claimReportDays` (7) after `workerLeftOn` (`reportedWithinDeadline = false`), or the root placement's fee not fully paid (`feePaidInFull = false`), or a reason from the reject list.
- Otherwise the claim waits for a decision; `decisionDueAt` = `reportedAt` + `claimDecisionHours` (48). An **exit call** to the worker is created as a follow-up task (Task 4) and its `CallRecord` is stored as `exitCallRecordId` when done.
- **Decision:** a Team Lead (own team) or Manager accepts or rejects with a required reason; a Manager may overrule a Team Lead's decision with a reason (`overruledByStaffId`, `overruleReason`). Not decided by `decisionDueAt` → `claim_decision_overdue` `ReviewFlag` to the Manager (add it to the closed list).
- **Accepted:** the placement → `dropped_out`; the replacement search starts (Task 3). **Rejected:** the placement stays as it is; the guarantee is not used.
- **Remove** `POST /placements/:id/dropout`; leave a 404 test for every role.
- Tests: a claim without an answered owner call is refused; a report on day 8 is auto-rejected; an unpaid fee is auto-rejected; a reject-list reason is auto-rejected; only Team Lead/Manager decide; a Manager overrule is recorded; the overdue flag fires once; the old endpoint is gone.

### [x] Task 3 — Replacements through interviews, and the guarantee rules
**Branch:** `phase-17/task-3-replacements` · **Migration folder:** `20261110120000_replacements_via_interviews`

**Acceptance:**
- Accepting a claim creates a **replacement vacancy** (`replacementForPlacementId` = the dropped placement), copying the original vacancy's details. Phase 15's refusal of replacement vacancies is lifted; matching, offers, replies and the owner's OTP result work exactly as for a fresh vacancy. `ReplacementCandidate` gets `interviewId` and a row is written for each replacement interview, as history.
- **A `selected` result on a replacement vacancy creates a free replacement placement:** no fee and no payment; `rootPlacementId` = the root; `replacementNumber` = 1 or 2; status straight to `confirmed`; the job seeker becomes `placed` at selection (the root's fee already paid); the joining date is sent to the candidate. Joining is confirmed by calls as in Task 1.
- **The guarantee clock never restarts:** every window is counted from the **root** placement's `joinedDate`.
- **At most `maxFreeReplacements` (2) per root.** If the second replacement also leaves (an accepted claim on `replacementNumber` 2) → the root and its chain end: `guarantee_ended`, `guaranteeEndedReason: second_replacement_left`, no refund.
- **Rejections:** each owner `not_selected` result on a replacement interview for the same root counts as a rejection (counted from interview results — `replacementRejectionCount` is no longer read or written). At `maxReplacementRejections` (2) → `guarantee_ended`, reason `two_rejections`, no refund. A later hire is a fresh placement at the normal fee.
- **The 15-day rule:** if no replacement has been `selected` within `replacementSearchDays` (15) of the claim being accepted, the business is owed a **100% refund of the placement fee**: the root gets `guaranteeEndedReason: refunded` once the refund is approved. The refund is approved by CEO or Finance through the existing `approveRefund` (rewritten to these rules; the way the money is sent is unchanged until Phase 18).
- **Remove** the three replacement-candidate endpoints (`/placements/:id/replacement-candidates`, `/reject`, `/accept`); leave 404 tests. `clockPaused`, `clockPausedAt`, `replacementRejectionCount` and `eligibility` are no longer read anywhere.
- Tests: a replacement interview needs no payment and the job seeker is `placed` at selection; a third replacement is refused; the second replacement leaving ends the guarantee with no refund; two replacement rejections end it with no refund; day 16 with no selection makes the fee refundable and approving it sets `refunded`; windows count from the root's joining even after two replacements; the old endpoints are gone; nothing reads the deprecated columns.

### [x] Task 4 — Follow-up calls, the refund check and catching bypass
**Branch:** `phase-17/task-4-follow-ups` · **Migration folder:** `20261110130000_add_follow_up_task`

**Acceptance:**
- `FollowUpTask` exactly as data-design §11. New `PricingPolicy` column `followUpGraceDays` (default **2**).
- A daily job creates, once each:
  - `not_selected_day_7`, `_day_30`, `_day_90` — to a candidate counted from a `not_selected` interview result; assigned to the staff member who proposed that interview;
  - `placement_check_in_day_7`, `_day_30` — to the worker, counted from `joinedDate`; assigned to the business's account agent;
  - `refund_check` — for a candidate whose ₹499 refund is about to become due; assigned to a call agent of the candidate's registering team;
  - `exit_call` — created by Task 2 on a claim.
- **A task can only be completed with an answered call** to its subject (`callRecordId` required; purpose `follow_up`, `check_in`, `refund_check` or `exit_call`). The agent records `answer` from the closed list. For `working_at_introduced_business` the agent picks the business from **only the businesses introduced to this candidate** (Phase 14 `CandidateIntroduction`), stored as `answerBusinessId`. Not done by `dueAt` + `followUpGraceDays` → `missed`.
- **Bypass:** `working_at_introduced_business` naming a business that was introduced within `noBypassMonths` of the first introduction (`firstIntroduction`) and has **no paid placement** for this candidate → `bypass_suspected` `ReviewFlag` to the Team Lead and Manager, naming the business and the evidence (introduction date, interview result, call recording).
- **The ₹499 refund is blocked** while a `bypass_suspected` flag is open for that candidate, or if the `refund_check` answer is `working_at_introduced_business`.
- **Candidate refund eligibility** (in `refund.service.ts`) adds the 7 Nov decision: not eligible if they withdrew `job_matching`, `profile_sharing` or `call_recording` after paying. The existing rules (not placed, not deactivated, no disqualifying hit) stay.
- Tests: each kind is created once on the right day; a task can't be completed without an answered call; the business list offered is only introduced businesses; an introduced unpaid business raises `bypass_suspected` and blocks the refund; a business that paid does not; a candidate who withdrew job matching is not refund-eligible; one who withdrew promotions still is.

### [x] Task 5 — Pattern flags
**Branch:** `phase-17/task-5-pattern-flags` · **Migration folder:** `20261110140000_pattern_flag_policy`

**Acceptance:**
- New `PricingPolicy` columns (defaults are starting points the CEO can change): `patternWindowDays` (**60**), `patternBusinessMinInterviews` (**5**), `patternStopDays` (**30**), `patternAgentMinInterviews` (**10**), `patternAgentRejectionPercent` (**80**).
- A daily job raises, at most one open flag of each kind per subject:
  - `business_many_rejections` — in the last `patternWindowDays`, at least `patternBusinessMinInterviews` interviews with a result and **none** selected;
  - `business_stopped_after_interviews` — had interviews, then no new vacancy for `patternStopDays` after the last one, and no paid placement in between;
  - `agent_rejection_pattern` — across the agent's account businesses in the window, at least `patternAgentMinInterviews` results with `not_selected` at or above `patternAgentRejectionPercent`.
- These flags feed Phase 15's attendance rule (an agent attends interviews at a flagged business).
- Tests: each pattern fires at its threshold and not one below; a second run doesn't duplicate an open flag; thresholds come from `PricingPolicy`.

### [x] Task 6 — The joining reward queue
**Branch:** `phase-17/task-6-joining-reward` · **No migration**

**Acceptance:**
- A daily job queues a `Payment` of type `joining_reward` (amount `joiningRewardPaise`, ₹200) for the worker when a placement has been `active` for `joiningRewardAfterDays` (30) and the worker is still there (no accepted claim on it). Once per placement. Status `pending`, waiting for release by CEO or Finance — **how it is paid is Phase 18**; until then it simply waits, and nothing pays it automatically.
- Replacement placements earn it the same way, counted from their own joining.
- Tests: queued on day 30, not day 29; not queued if a claim was accepted before day 30; never twice; nobody but CEO and Finance can release it.

### [x] Task 7 — Screens
**Branch:** `phase-17/task-7-screens` · **No migration**

**Acceptance (existing consoles, plain styling):**
- Placement page: joining checklist (worker call, business call), guarantee days left counted from the root, replacements used, rejections used, open claim and its decision due time.
- Claim form (only after an answered owner call) and a decision screen for Team Leads and Managers with the exit call recording.
- My follow-ups list for each agent (due, missed) with the answer form after an answered call.
- Team Lead and Manager: bypass and pattern flags with their evidence.
- Tests: screens render for the allowed roles; no full phone number on any agent page.

---

## Phase 17 Gate

- [ ] Joining needs answered calls to both worker and business; the joining date can't be typed — by test
- [ ] A claim needs an answered owner call; late, unpaid or reject-list claims are rejected automatically; only Team Lead/Manager decide, within 48 hours or flagged — by test
- [ ] Replacements are free interviews on a replacement vacancy; at most 2; the clock counts from the root's joining and never restarts — by test
- [ ] Second replacement leaving or two rejections end the guarantee with no refund; no replacement in 15 days makes the fee refundable by CEO/Finance — by test
- [ ] Follow-ups are created on schedule and completed only with an answered call; working at an introduced unpaid business raises `bypass_suspected` and blocks the ₹499 refund — by test
- [ ] A candidate who withdrew job matching, profile sharing or call recording after paying is not refund-eligible — by test
- [ ] Pattern flags fire at their thresholds from `PricingPolicy`, without duplicates — by test
- [ ] The joining reward is queued on day 30 only for a worker still there, and is never paid automatically — by test
- [ ] The old `dropout` and replacement-candidate endpoints are gone; nothing reads `clockPaused`, `replacementRejectionCount` or `eligibility` — by test
- [ ] **End-to-end proof, recorded in the report:** a paid placement; on the joining date the agent calls worker and owner (both answered) and joining is recorded; the day-7 check-in is created and done; on day 20 the worker resigns and the owner reports it on a call on day 22; the Team Lead accepts within 48 hours after the exit call; a replacement vacancy opens; the first replacement candidate is rejected by the owner's OTP, the second is selected free and joins; on day 30 of the root the original worker's reward is not queued (they left) but the replacement's is queued 30 days after their own joining; on day 60 of the root the replacement placement completes. Separately: a not-selected candidate says on the day-30 follow-up that they work at that business, which never paid → `bypass_suspected`, and their refund is blocked.
- [ ] All earlier phase gate items still pass; CI green on `main`; every task branch was green before merging; `LESSONS.md` updated

**When the gate passes: stop and report to Agastya.** Commits, CI links, test counts, one line per task, any tests changed and why, and the end-to-end proof. Do not start the next phase.
