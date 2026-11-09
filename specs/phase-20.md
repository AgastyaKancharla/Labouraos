# Phase 20 — The Look, the Targets Screens, and a Free Preview

**Goal:** every screen wears the Command Center design Agastya approved on 1 Nov; agents see their own monthly targets and progress; management sees the team, the leaderboard and money at risk; and the whole platform can be opened on a free online preview to look at and click through, with pretend SMS shown on screen so every journey can be followed end to end.

**Why this is next:** all 11 build steps of the data design are done. Three things were knowingly left out of every phase: the restyle ("plain styling" in every spec), the targets **screens** (the targets data, metrics and API were built in Phase 6.7, but no console shows them), and a way for Agastya to see the software running.

**Read first:** `AGENTS.md`, `LESSONS.md`, this whole spec, the Master Guide rules quoted below, and **the design reference in `docs/design/command-center/`** — five files exported from the approved design: `Main.dc.html` (admin Command Center), `JobSeekers.dc.html` (a drill-down list), `CallAgent.dc.html`, `FieldAgent.dc.html` (phone), `DesignSystem.dc.html` (type, rules, components). They are HTML mockups: open them in a browser to see them (the `/_blob/…` images won't load; the logo comes from `public/brand/` — Task 2).

**The design is the LOOK, not the rules.** The mockups were drawn on 29 Oct, before the redesign. Where a mockup shows something the current rules forbid, **the rules win** — keep the look, change the content:
- The call agent header shows **Calls / Connected / Meetings set** counters. Calls dialled and connected are **never** shown as targets or scores (Master Guide, "Monthly targets"). Show the agent's real targets instead (Task 5).
- The call outcome buttons include **Connected** and **No answer**. Whether a call connected comes only from the calling company (Phase 11); the outcome form appears **only after an answered call** and uses the closed list (interested, accepted_offer, rejected_offer, callback_requested, not_interested, working_now, other).
- Phone numbers appear as `98xxx xx412`. The rule is **last 4 digits only** (`******1234`) for agents and Team Leads.
- The field agent header shows an **area** ("Koramangala"). There are **no areas** (Phase 13).
- "Pending KYC" badges → the Phase 12 statuses (`lead`, `consented`, `pending_activation`, `active`, `paused`…).
- Any mockup number is sample data; every figure on a real screen comes from the API.

**Out of scope — do not build:** the native field agent app, the public marketing website, any new business rule, changes to the API's behaviour (screens only call what exists, except the two small additions in Tasks 1 and 5).

---

## How this phase runs

One task after another, in order, each on its own branch; build on the latest `main`, push, wait for GitHub Actions green **on the branch**, fix on the branch, merge by pull request, tick. **Commit and push after every meaningful change.** Every test closes the Nest app in `afterAll` inside `try … finally`. Before pushing, check every import points to a file that exists. If the spec and code disagree in a way this spec doesn't answer, stop and ask.

---

### [ ] Task 1 — A free online preview, with a pretend-message outbox
**Branch:** `phase-20/task-1-free-preview` · **Migration folder:** `20261113100000_preview_outbox`

**Acceptance:**
- **`render-preview.yaml`** — a separate Render Blueprint (the real `render.yaml` is untouched) that creates, on Render's **free** plan: one web service `laboura-preview` and one free Key Value. No background worker (Render has none free). Every secret (`JWT_SECRET`, `LOGIN_CODE_SECRET`, `CALL_ROUTING_KEY`, `PAYOUT_ACCOUNT_KEY`, `STAFF_BOOTSTRAP_SECRET`, all webhook secrets) uses Render's `generateValue: true`, so nobody types them. All providers in `mock` mode. `PUBLIC_APP_URL` = `https://laboura-preview.onrender.com`. `PREVIEW_MODE=true`. Only `DATABASE_URL` (from Supabase) is entered by hand.
- **`PREVIEW_MODE`** safety: the server **refuses to start** if `PREVIEW_MODE=true` while any provider (SMS, WhatsApp, telephony, payment, KYC, bank feed) is not in mock mode — so a preview can never send a real message or touch real money.
- **Pretend-message outbox** (preview only): new table `PreviewOutbox` (`id`, `channel`, `template`, `toMasked` (last 4 digits), `link`, `createdAt`). When `PREVIEW_MODE=true`, the mock SMS and WhatsApp providers also write each message's template and its link here (never a full phone number, never other personal data). A CEO screen **"Pretend messages"** lists the latest 200 with clickable links, so the consent page, agreement page, offer reply, payment page and payout-details page can be opened by hand. Rows older than 7 days are deleted daily. When `PREVIEW_MODE` is not `true`, the table is never written and the screen and its route return 404.
- **Background jobs without a worker:** the existing manual job trigger stays available to the CEO in preview, with a **"Run daily jobs now"** button, so the midnight checks, deadlines and day-30/60 jobs can be seen working.
- **Sample data** (preview only): a CEO button **"Load sample data"** creates a small, clearly fake set — about 10 job seekers in different stages, 4 businesses (one household with no documents), 6 vacancies, a few interviews, one placement awaiting payment, one paid, one with a claim — with names like "Sample Worker 1" and phone numbers in a fake range. Refused unless `PREVIEW_MODE=true`.
- **`DEPLOY-PREVIEW.md`** — step-by-step for someone who has never used a terminal: create a free Supabase project (region **Southeast Asia (Singapore)**), copy its connection string, create the Render Blueprint from `render-preview.yaml`, paste the string, wait for the first deploy, create the first CEO with the bootstrap flow, set up the authenticator app, log in, load sample data. With screenshots described in words (no images needed), what to click, what you should see, and what to do if it says "spinning up" (wait about a minute; the free plan sleeps after 15 minutes without use).
- Tests: the server won't start with `PREVIEW_MODE=true` and a real provider; the outbox is written only in preview and never holds a full phone number; the outbox route is 404 outside preview; sample data is refused outside preview; the Blueprint file declares no worker and generated secrets.

### [ ] Task 2 — The design foundation
**Branch:** `phase-20/task-2-design-foundation` · **No migration**

**Acceptance:**
- One shared stylesheet served by the app (e.g. `public/css/laboura.css`) carrying the design tokens exactly as in the reference files' `:root`: ink `#0B1E4A`, ink-soft `#49588A`, ink-faint `#8290B8`, background `#EEF3FC`, surface `#FFFFFF`, border `#DCE4F3`, blue `#0055C0` with the header gradient `#0055C0 → #003593`, navy `#032B73`, cyan `#02D0F8`, gold `#FCCE00`, orange `#FB6800`, red `#FE2901`, the **swoosh** strip gradient, status colours (green `#1C9A6C`/`#E1F5EC`, amber `#92670A`/`#FFF4CC`, cyan `#0B6E82`/`#DCF6FD`, tomato `#BB232B`/`#FAE2E1`, critical `#B94E12`/`#FFE7D6`), radii, shadows; display font **Sora**, body font **IBM Plex Sans**.
- **Fonts served from the app itself** (install `@fontsource/sora` and `@fontsource/ibm-plex-sans`, pinned versions), not Google's servers, so the consoles work under a strict content-security policy and offline from Google.
- Shared building blocks used by every screen: the blue header with logo, title, date and user chip; the swoosh strip; stat tiles; cards; status badges; tables that scroll inside a box on a phone; form fields with labels; primary/secondary/danger buttons; empty states; the queue card; a progress bar.
- **Logo:** `public/brand/laboura-logo.png` (provided by Agastya — until it is there, show the word **LABOURA** in Sora 700 in its place; never an empty box).
- Accessibility from `DesignSystem.dc.html`'s "Rules for every screen": text contrast at least 4.5:1 (the mockups' 11 px grey labels must use shades that pass), real `<button>`/`<a>`/`<label>`, touch targets at least 44 px, icons as inline SVG with `aria-hidden` or labels — no emoji.
- Every screen works at phone width (390 px): menus stack, toolbars wrap, tables scroll in their box, no sideways page scroll.
- Tests: the stylesheet and fonts are served; a page using the shared header renders with the logo or the LABOURA fallback; no console page loads a font from an outside domain.

### [ ] Task 3 — Restyle the management screens
**Branch:** `phase-20/task-3-restyle-admin` · **No migration**

**Acceptance:**
- Login screens (staff code, password, authenticator code, login-code screen), the admin dashboard (`admin-dashboard.html.ts`) and the map page follow `Main.dc.html` and `JobSeekers.dc.html`: greeting header, "Needs your attention" (review flags, overdue results, payment mismatches, claims due), live activity, pipeline, revenue and joins by week, supply vs demand by trade, team performance, pricing and policy in force (read from `PricingPolicy`), system health.
- Every panel uses real API data; a panel with no data shows an empty state, never sample numbers. Panels and actions keep their Phase 9–19 permissions exactly (a Manager still can't release money, Finance sees money screens, etc.).
- "Open vacancies by area" in the mockup becomes **by locality** (no areas).
- Tests: each management role sees the panels it is allowed and no others; no full phone number or exact candidate location appears; the page renders at 390 px and 1440 px.

### [ ] Task 4 — Restyle the agent screens and the public pages
**Branch:** `phase-20/task-4-restyle-agents` · **No migration**

**Acceptance:**
- **Call agent console** follows `CallAgent.dc.html`: header (with targets from Task 5, never calls/connected counts), today's queue as queue cards, the profile panel, **Call** button, the outcome form only after an answered call, notes, "Save & next". Numbers last 4 digits only.
- **Field agent screens** (the web version used until the app exists) follow `FieldAgent.dc.html` at phone size: header without an area, today's figures, **Check in**, **Capture new candidate / business**, my assignments, my captures, bottom navigation.
- **Public pages** — consent, business agreement, referral terms, offer reply, interview result, candidate "did they offer you the job", payment page, payout details — restyled phone-first in the same look, in Kannada, Hindi and English as they are today. These are what workers and owners see; they must be simple and readable on a cheap phone.
- Tests: no full phone number on any agent page; the outcome form is absent until an answered call; every public page renders at 360 px wide; no area appears anywhere.

### [ ] Task 5 — Targets and progress screens, and the behind-pace flag
**Branch:** `phase-20/task-5-targets-screens` · **Migration folder:** `20261113110000_pace_policy`

**Acceptance:**
- **My targets** for call agents and field agents (on their home screen and its own tab): this month's target and progress for each metric of their role, from the existing Phase 6.7 target and metrics endpoints — **call agent:** candidates activated, refund rate (lower is better), vacancies captured; **field agent:** placements closed, replacements filled in 15 days, repeat businesses. A progress bar and "on pace / behind pace" for each. Interns see the same numbers as paid agents.
- **Field agents who register job seekers:** show their candidates activated as an extra figure on their screen, **with no target attached** (the Master Guide leaves this open; a target can be added later only by changing the rule).
- **Leaderboard** ranks agents on **placements closed** only, and **never shows anyone's target** (Master Guide).
- **Team Lead:** their team's agents with progress and pace on each metric. **Manager and CEO:** every team, plus **money at risk** (₹499 refunds due soon and placement fees on replacements running out of time — the existing endpoint).
- **Setting targets:** a CEO/Manager screen to set each agent's monthly targets (the existing `POST /targets`), with the month, the role's metrics, and a copy-from-last-month button.
- **Behind pace:** new `PricingPolicy` columns `paceFlagFromDay` (default **10**) and `paceThresholdPercent` (default **80**). A daily job: from day `paceFlagFromDay` of the month, an agent whose progress on a metric is below `paceThresholdPercent`% of where they should be by now (target × days elapsed ÷ days in month; for refund rate, the reverse) gets a `behind_pace` `ReviewFlag` (add to the closed list) to their Team Lead and Manager — at most one per agent per metric per month.
- **Calls dialled and calls connected never appear as a target, score or ranking**, anywhere.
- Tests: each agent sees only their own targets; the leaderboard has no target values; a Team Lead sees only their team; the behind-pace flag fires at the threshold from day 10 and not before, and only once a month; refund rate's pace works in the right direction; no screen shows calls dialled or connected as a metric.

### [ ] Task 6 — Screenshots of every screen
**Branch:** `phase-20/task-6-screenshots` · **No migration**

**Acceptance:**
- A Playwright script (the CI already has a database) that starts the app in preview mode, loads sample data, logs in as each role, and takes a screenshot of every screen at **1440 px** and **390 px** wide, plus every public page at 360 px. GitHub Actions uploads them as one downloadable artifact on each run of this workflow (it can run on demand and on pull requests that touch `src/modules/console` or `public/`).
- `docs/screens.md` lists every screen, who sees it, and its screenshot name.
- This is the first step of the robot testing that follows this phase; keep the login and navigation helpers reusable.
- Tests: the script runs green in CI and the artifact contains a screenshot for every screen listed in `docs/screens.md`.

---

## Phase 20 Gate

- [ ] Every console screen and public page uses the shared design foundation (tokens, fonts served locally, header, swoosh, components) and works at phone width — by test
- [ ] No screen shows calls dialled/connected as a metric, a full phone number to agents, an area, or an outcome button before an answered call — by test
- [ ] Agents see their own targets and pace; the leaderboard ranks on placements closed and shows no targets; Team Leads see their team; CEO/Manager set targets and see money at risk — by test
- [ ] The behind-pace flag fires from day 10 below 80% of pace, once a month per metric, numbers from `PricingPolicy` — by test
- [ ] `PREVIEW_MODE` can't run with any real provider; the pretend outbox and sample data exist only in preview and never hold full phone numbers — by test
- [ ] Screenshots of every screen at 1440 and 390 px are produced by CI — by test
- [ ] **End-to-end proof, recorded in the report:** in preview mode, the CEO loads sample data; a call agent registers a worker and sends the consent link; the CEO opens it from "Pretend messages", completes consent by OTP (mock code) — the worker becomes `consented`; a field agent sees their targets and progress; the CEO sets next month's targets; running the daily jobs raises a behind-pace flag for an agent below pace on day 12. Screenshots of each step are attached to the run.
- [ ] All earlier phase gate items still pass; CI green on `main`; every task branch was green before merging; `LESSONS.md` updated

**When the gate passes: stop and report to Agastya.** Commits, CI links, test counts, one line per task, any tests changed and why, the end-to-end proof, and the link to the screenshots artifact. Do not start anything else.
