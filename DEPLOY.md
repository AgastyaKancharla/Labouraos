# Putting Laboura online (Render + Supabase)

This guide is for someone who has never used a terminal. **No command line or terminal is required.** Every step is a click in a web browser, in the Render dashboard or the Supabase dashboard.

Read each step to the end before you start clicking. Keep a password manager (or a private note) open: you will copy several long values from one website and paste them into another.

---

## What you are building

| Part | Where | What it does |
| --- | --- | --- |
| **Web service** `laboura-api` | Render, Singapore | The API, the webhooks, the office web app (login and portals at `app.laboura.com/login`, `/ceo`, `/manager`, `/team-lead`, `/finance`, `/call-agent`, public pages at `/p/...`) and Laboura Field (`field.laboura.com`, and `/field` on the Render address) |
| **Background worker** `laboura-worker` | Render, Singapore | Every scheduled job: the midnight no-pickup check, payment deadlines, day-60 completions, refunds due, follow-up tasks, data clean-up |
| **Job queue** `laboura-redis` | **Render Key Value**, Singapore | The queue the worker reads. It sits on Render's private network, so only the two services above can reach it |
| **Database** | Supabase, Singapore | Every record (PostgreSQL) |
| **Uploaded files** | Supabase Storage, Singapore | Candidate selfies, shop photos, signed agreements, call recordings |

The file `render.yaml` in the code describes the three Render parts. Render reads it and creates all three for you (a "Blueprint"). You never create the Render Key Value by hand.

### Times

Every daily job runs on **India time** (Asia/Kolkata): the no-pickup check and the forgotten-logout close at 00:00, payment and placement checks between 00:15 and 01:00, data clean-up at 02:00, and follow-up tasks at 06:00 so they are ready before the working day.

### How the database tables get created

Render does not create tables by itself. Before each new version starts taking requests, Render runs this **Pre-Deploy Command** on the web service:

```text
npm run migrate:deploy
```

It applies every database change (a "migration") that is not in the database yet, using the exact Prisma version pinned in the code. You do not run it yourself. It runs only on `laboura-api`, never on the worker, so two copies can never change the database at the same time.

### What it costs each month

Render web $7 + worker $7 + Key Value about $10, and Supabase Pro $25. Supabase must be on **Pro** before real data goes in, because Pro is what keeps daily backups.

> [!TIP]
> **Testing first, for free?** Skip to [Free tier for testing](#free-tier-for-testing). It uses one free Render web service, one free Key Value and a free Supabase project in Mumbai, for made-up data only.

---

## The steps, in order

1. Create the Supabase project
2. Copy the two database addresses
3. Create the four private file buckets and copy the storage keys
4. Turn off the Supabase Data API
5. Create everything on Render from the Blueprint
6. Check that it is running
7. Create the first CEO account
8. Create a second CEO account on a different phone
9. Before any real data: the go-live checklist
10. Test one restore
11. Emergency recovery (Agastya only)

At the end: [all settings](#all-settings), [webhook addresses](#webhook-addresses-for-vendors), [moving an older Render setup over](#if-laboura-was-already-on-render-before-this-guide) and [troubleshooting](#troubleshooting).

---

### Step 1: Create the Supabase project

1. Go to **[supabase.com/dashboard](https://supabase.com/dashboard)** and sign in.
2. Click **New project**.
3. Fill in the form:
   - **Organization**: Laboura's organisation.
   - **Project name**: `laboura-production`.
   - **Database password**: click **Generate a password**. Copy it into your password manager now; Supabase will not show it again. If the password contains symbols such as `@ # / ? %`, generate again until it is only letters and numbers. Symbols break the database address in Step 2.
   - **Region**: **Southeast Asia (Singapore)**. This must be Singapore, the same place as the Render services.
   - If you see a checkbox called **Automatically expose new tables** (Data API), leave it **unticked**.
4. Click **Create new project** and wait one or two minutes.
5. Before real data goes in, move the organisation to the **Pro** plan: click the organisation name at the top left, then **Billing**, then change the plan to **Pro**.

---

### Step 2: Copy the two database addresses

Laboura needs two addresses for the same database. Both come from the same screen.

1. Open the `laboura-production` project.
2. Click the **Connect** button at the top of the page. (In older dashboards: the gear icon **Project Settings** at the bottom left, then **Database**, then **Connection string**.)
3. Choose the **Connection String** tab, type **URI**. You will see three blocks: **Direct connection**, **Transaction pooler** and **Session pooler**. Do **not** use "Direct connection": it only works over IPv6, which Render cannot reach.
4. **`DATABASE_URL`, the Transaction pooler (port 6543).** Copy the address under **Transaction pooler**. It looks like:
   ```text
   postgresql://postgres.abcdefghijkl:[YOUR-PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres
   ```
   - Replace `[YOUR-PASSWORD]` (including the square brackets) with the password from Step 1.
   - Add this to the very end, with no spaces:
     ```text
     ?pgbouncer=true&connection_limit=5&sslmode=require
     ```
   - The finished value ends in `:6543/postgres?pgbouncer=true&connection_limit=5&sslmode=require`. Save it as **DATABASE_URL**. This is what the running app uses. `pgbouncer=true` is required on port 6543: without it, requests fail with "prepared statement already exists".
5. **`DIRECT_URL`, the Session pooler (port 5432).** Copy the address under **Session pooler**. It is the same address with port `5432`:
   ```text
   postgresql://postgres.abcdefghijkl:[YOUR-PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
   ```
   - Replace `[YOUR-PASSWORD]` with the password.
   - Add `?sslmode=require` to the end.
   - Save it as **DIRECT_URL**. It is used only to apply database changes (migrations), which cannot run through the transaction pooler.

---

### Step 3: Create the four private file buckets and copy the storage keys

Uploaded files are kept in Supabase Storage. Laboura needs four buckets, all **private**. They hold personal data (selfies, shop photos, signed agreements, recorded calls) and must never be public. `candidate-photos` holds every live camera selfie: job seekers, referral partners (under `referrals/`) and the staff photos shown on login code requests (under `staff/`).

1. In the project, click **Storage** in the left menu (the bucket icon).
2. Click **New bucket**.
3. **Name**: `candidate-photos`. Leave **Public bucket** switched **off**. Click **Create bucket** (or **Save**).
4. Repeat for the other three, each with **Public bucket** off:
   - `business-photos`
   - `agreements`
   - `recordings`
5. Check that the Storage page lists exactly these four names, spelled exactly like this, none marked "Public".
6. Copy the storage keys:
   - Click **Project Settings** (gear icon), then **API** (in newer dashboards: **API Keys** and **Data API**).
   - Copy the **Project URL** (like `https://abcdefghijkl.supabase.co`). Save it as **SUPABASE_URL**.
   - Find the **service_role** key (sometimes called the **secret** key). Click **Reveal** and copy it. Save it as **SUPABASE_SERVICE_ROLE_KEY**. Treat it like a bank password: it can read every file. Never paste it into chat or email.

The production server refuses to start unless all four `*_STORAGE_MODE` settings are `supabase` and both of these keys are filled in. `render.yaml` already sets the four modes to `supabase` on the web service and the worker; you only paste the two keys.

---

### Step 4: Turn off the Supabase Data API

Supabase can publish every database table as a public web API (the "Data API"). Laboura does not use it: the app talks to the database directly. Leaving it on would let anyone holding the project's public key try to read tables. Two protections are in place; do both.

1. **Turn the Data API off.** In the project, click **Integrations** in the left menu, then **Data API**. Switch **Enable Data API** off and confirm. (In older dashboards: **Project Settings**, then **API** or **Data API**, then the same switch.) File storage keeps working; it does not use the Data API.
2. **Row level security is switched on by the code.** A database change in the code turns on **row level security** for every table, with no rules that let anyone in, so even if the Data API were switched back on it would return nothing. The app is not affected, because it connects as the owner of the tables. After Step 6, open **Advisors** in the left menu, then **Security Advisor**, and check that it shows no "RLS disabled in public" errors.

Every new table added to the code later must also switch row level security on. The automated tests check this and fail if a new table forgets it.

---

### Step 5: Create everything on Render from the Blueprint

1. Go to **[dashboard.render.com](https://dashboard.render.com)** and sign in.
2. Click **New** (top right), then **Blueprint**.
3. Connect GitHub if Render asks, and pick the repository **Labouraos**. Branch: **main**.
4. **Blueprint name**: `laboura`.
5. Render reads `render.yaml` and lists three things to create:
   - `laboura-api` (Web Service, Singapore)
   - `laboura-worker` (Background Worker, Singapore)
   - `laboura-redis` (Key Value, Singapore)
6. Render then asks for every setting that has no value in the file. Fill these in now. Leave a box empty only where the table says so.

   | Setting | What to paste |
   | --- | --- |
   | `DATABASE_URL` | The transaction pooler address from Step 2 (port 6543, ending `?pgbouncer=true&connection_limit=5&sslmode=require`) |
   | `DIRECT_URL` | The session pooler address from Step 2 (port 5432, ending `?sslmode=require`) |
   | `PUBLIC_APP_URL` | The public web address of the app, used to create the links sent by SMS and WhatsApp. **The server refuses to start without it.** Until Laboura has its own domain, use the address Render gives the web service, `https://laboura-api.onrender.com` (Render shows the exact address at the top of the `laboura-api` page; if it differs, correct this setting afterwards). Must start with `https://`. |
   | `SUPABASE_URL` | From Step 3 |
   | `SUPABASE_SERVICE_ROLE_KEY` | From Step 3 |
   | `COMPANY_LEGAL_NAME` | `Laboura Private Limited` |
   | `COMPANY_GSTIN` | The 15-character GSTIN, once issued. Empty until then. |
   | `COMPANY_UPI_VPA`, `COMPANY_UPI_PAYEE_NAME` | Empty until the company current account opens. See [UPI details](#upi-details). |
   | `ALERT_WEBHOOK_URL` | A Slack (or similar) incoming-webhook address for error alerts. Empty is allowed: alerts then only go to the logs. |
   | `CLOUDFLARE_ACCESS_TEAM_DOMAIN`, `CLOUDFLARE_ACCESS_AUD` | Empty for testing. Required before real data (Step 9). |
   | Vendor keys (`SMS_*`, `DLT_*`, `WHATSAPP_*`, `TELEPHONY_VENDOR`, `TOLL_FREE_NUMBER`, `KYC_*`, `RAZORPAY*`) and webhook secrets (`*_WEBHOOK_SECRET`) | Empty until each vendor is signed up. Every vendor runs in mock mode until then. |

7. Click **Deploy Blueprint** (some screens say **Apply**).
8. Render creates the Key Value first, then builds and starts the web service and the worker. The first build takes several minutes.

Settings that Render creates by itself, and that you never type, are `JWT_SECRET`, `LOGIN_CODE_SECRET`, `STAFF_BOOTSTRAP_SECRET`, `CALL_ROUTING_KEY` and `PAYOUT_ACCOUNT_KEY`. The worker copies the ones it needs from `laboura-api`. Both services must share the same `LOGIN_CODE_SECRET`, or a code shown on the login code screen will not match. `REDIS_HOST` and `REDIS_PORT` are filled in from `laboura-redis` automatically, with `REDIS_TLS` set to `false`: the private address does not use TLS and has no password.

> [!IMPORTANT]
> **Settings written in `render.yaml` are put back every time Render syncs the Blueprint** (for example `NODE_ENV`, `PROCESS_ROLE`, the `*_STORAGE_MODE` and `*_PROVIDER_MODE` values). Changing one of those in the dashboard lasts only until the next sync. To switch a vendor from `mock` to `real`, ask Claude to change `render.yaml` on both services. The settings you pasted in step 6 are yours: Render never overwrites them.

---

### Step 6: Check that it is running

1. **The build and the database changes.** In Render, open **`laboura-api`**, then **Events**, and click the newest deploy. You should see, in order:
   - Build: `npm ci --include=dev && npx prisma generate && npm run build` ending without errors.
   - Pre-Deploy: `npm run migrate:deploy` printing `All migrations have been successfully applied.` (or `No pending migrations to apply.` on later deploys).
   - Start: `Nest application successfully started`.
2. **The web service is alive.** Open `https://<your laboura-api address>/health` in the browser. It shows `{"status":"ok", ...}`. Render itself watches this address and restarts the web service if it stops answering.
3. **The database, the queue and the worker are all reachable.** Open `https://<your laboura-api address>/health/ready`. It shows `"status":"ready"`, `"postgres":"ok"`, `"redis":"ok"` and a `"worker"` section with `"status":"alive"`. If any of them fails, the page answers with an error that names which one (`postgres`, `redis` or `worker`). Point an uptime monitor (for example UptimeRobot, free) at this address so someone is told when it fails.
4. **The worker.** Open **`laboura-worker`**, then **Logs**. Near the top:
   ```text
   Starting background worker application context...
   Worker application context initialized and running (PROCESS_ROLE=worker)
   ```
   `PROCESS_ROLE` is what keeps the scheduled jobs in the worker only: it is `web` on `laboura-api` and `worker` on `laboura-worker`. Never change it. If the worker cannot reach the Key Value, it stops with "Worker cannot reach Redis" and Render restarts it. That is deliberate: a worker without its queue would run no jobs while looking healthy.
5. **The tables.** In Supabase, open **Table Editor**. You should see tables such as `JobSeeker`, `Business`, `Vacancy`, `Placement`, `Payment`, `Staff`, `AuditLog`.
6. **The security check.** In Supabase, open **Advisors**, then **Security Advisor**, and click **Rerun**. There must be no "RLS disabled in public" error.

---

### Step 7: Create the first CEO account

When the app first starts, no staff accounts exist. A one-time "bootstrap" request creates the CEO. You send it from **Laboura's own set-up page**, so no terminal is needed.

> [!IMPORTANT]
> **Never type the bootstrap secret, the CEO password or a login token into any other website** (for example online "API testers" such as ReqBin or Postman's web version). Those sites pass what you type through their own servers. Use only the page below, on your own Laboura address.

1. **Copy the bootstrap secret.** In Render, open **`laboura-api`** (on the free tier: `laboura-test`), then **Environment**. Find `STAFF_BOOTSTRAP_SECRET` and click the eye icon to show it. Copy it.
2. **Open the set-up page on your own Laboura address:** `https://<your laboura-api address>/setup`. Check that the address bar shows your own Laboura address (for example `https://laboura-api.onrender.com/setup`) before typing anything.
   - **CEO name**, for example `Sanket`.
   - **CEO email**, for example `ceo@laboura.in`.
   - **Password** (twice): at least 12 characters. Save it in your password manager first.
   - **Bootstrap secret**: paste the value from 1.
   - Click **Create the CEO account**. The page shows the staff code, for example `CEO-00001`. Write it down. The page works only while no staff account exists; after that it answers that set-up is already done.

   *If the set-up page does not open*, use the browser console on your own Laboura address instead (still nothing goes through another website): open `https://<your laboura-api address>/health` in Chrome, press **Ctrl+Shift+J** (Mac: **Cmd+Option+J**), paste this with your own values, and press **Enter**:
   ```js
   fetch('/staff/bootstrap', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ name: 'Sanket', email: 'ceo@laboura.in', password: 'A-long-password', secret: 'THE-BOOTSTRAP-SECRET' }),
   }).then((r) => r.json()).then(console.log);
   ```
   The answer includes `"code": "CEO-00001"`. Close the console afterwards.
3. **Set up the authenticator app on the first login.** Open `https://<your laboura-api address>/login`.
   - Log in with the **staff code** (for example `CEO-00001`) and the password. Not the email.
   - The page shows a QR code and a secret key (shown only this once). Scan it, or type the key, in Google Authenticator, Microsoft Authenticator or Authy.
   - Type the 6-digit code from the app and click **Turn on**.
   - Log in again with the staff code, the password and a fresh 6-digit code. That login also approves this browser as the CEO's device, and opens the CEO Command Center (`/ceo`).

Managers and Finance also use an authenticator app. Team Leads and agents instead wait on the "Ask your Team Lead for your code" page until someone reveals their code on the Login codes screen.

Staff log in from any network: there is no office-network rule (owner decision 14 Nov). Every login already needs a one-time code from a senior or the authenticator code.

---

### Step 8: Create a second CEO account on a different phone

Do this straight after Step 7. If the only CEO phone is lost before a second CEO exists, nobody can get back in through the software.

1. Log in at `/login` as the first CEO.
2. In **Team & access** (`/ceo/team`), click **+ Invite staff** and invite a second CEO-level account (for example `ceo2@laboura.in`).
3. On a **different phone**, open the invitation link, set the password and add the authenticator code on that phone.
4. Log in once with the second account to check it works.

---

### Step 9: Before any real data, the go-live checklist

Up to here the system may hold only made-up test data. Tick every line before a real candidate, worker or business is entered.

- [ ] Supabase is on the **Pro** plan (daily backups).
- [ ] **Cloudflare Access is on.** `CLOUDFLARE_ACCESS_ENFORCED` MUST be set to `true` before any real candidate, worker or business data is entered. See the box below.
- [ ] Step 10 (test one restore) has been done once and written down.
- [ ] `COMPANY_LEGAL_NAME`, `COMPANY_GSTIN` and `COMPANY_ADDRESS` are the real values, otherwise invoices print placeholders.
- [ ] `ALERT_WEBHOOK_URL` is set, so errors reach a person and not only the logs.
- [ ] An uptime monitor watches `/health/ready`.
- [ ] Supabase **Security Advisor** shows no "RLS disabled" errors, and the Data API is off (Step 4).
- [ ] The four buckets exist and are private (Step 3).

> [!WARNING]
> **Cloudflare Access must be on before real data.**
>
> In `render.yaml`, `CLOUDFLARE_ACCESS_ENFORCED` is `"false"`. That is acceptable **only** while testing with made-up data. **`CLOUDFLARE_ACCESS_ENFORCED` MUST be set to `"true"` before any real candidate, worker or business data is entered into this system.** While it is `false`, the office web app (`/login`, `/ceo`, `/manager`, `/team-lead`, `/finance`, `/call-agent`) and the old admin dashboard (`/console/admin`) are not behind Cloudflare's identity check.
>
> 1. In **Cloudflare Zero Trust** (`one.dash.cloudflare.com`), open **Access**, then **Applications**, and add a self-hosted application for `app.laboura.com` covering `/login*`, `/ceo*`, `/manager*`, `/team-lead*`, `/finance*`, `/call-agent*` and `/console/admin*`. Leave out `/p/*` (job seekers and businesses open those), `field.laboura.com` and `/field*` (field agents use them from their phones).
> 2. Add a policy that lets in only Laboura's staff email addresses.
> 3. Copy the application's **Audience (AUD) tag**.
> 4. Ask Claude to change `CLOUDFLARE_ACCESS_ENFORCED` to `"true"` in `render.yaml` (a value written in that file is put back on every sync, so changing it only in the dashboard does not last).
> 5. In Render, `laboura-api`, **Environment**: set `CLOUDFLARE_ACCESS_TEAM_DOMAIN` (like `laboura.cloudflareaccess.com`) and `CLOUDFLARE_ACCESS_AUD` (the tag from step 3). Click **Save Changes**. With enforcement on and either value missing, the server refuses to start, so set both.
> 6. Once Cloudflare sits in front of Render, ask Claude to change `TRUST_PROXY_HOPS` from `1` to `2`.

#### UPI details

Every payment into Laboura (the ₹499 registration and the business placement fee) is collected by UPI straight into the company current account, with a separate QR code or link per payment.

1. In Render, open **`laboura-api`**, then **Environment**.
2. `COMPANY_UPI_VPA`: the company's UPI ID from the bank, like `laboura@icici`.
3. `COMPANY_UPI_PAYEE_NAME`: the name as registered with the bank. Payers see it in Google Pay, PhonePe, Paytm or BHIM.
4. Click **Save Changes**. The worker copies both from `laboura-api`.

> [!NOTE]
> Neither is needed for the server to start or for staff to log in, so the server can start without it while the bank account is being opened. Creating a payment request without them fails with a clear message, and `/health` shows "UPI collection not configured" until both are set.

---

### Step 10: Test one restore

A backup you have never restored is a hope, not a backup. Do this once before real data, and again every three months. It does not touch the live database.

1. In Supabase, open the `laboura-production` project, then **Database**, then **Backups**.
2. Open the **Restore to a New Project** tab. Pick the newest daily backup and click **Restore**. Supabase shows the cost of the new project first; it is charged only while the project exists.
3. **Never** use the plain **Restore** button on the live project for a test: that replaces the live database and takes it offline.
4. When the new project is ready, open its **SQL Editor** (in the browser), paste this and click **Run**:
   ```sql
   SELECT 'Staff' AS tbl, count(*) FROM "Staff" UNION ALL
   SELECT 'JobSeeker', count(*) FROM "JobSeeker" UNION ALL
   SELECT 'Business', count(*) FROM "Business" UNION ALL
   SELECT 'Placement', count(*) FROM "Placement" UNION ALL
   SELECT 'Payment', count(*) FROM "Payment";
   ```
5. Run the same in the live project's SQL Editor. The numbers should match (or the live ones be a little higher, from work done since the backup).
6. Write down the date, the backup used, how long it took and the counts, and ask Claude to add them to the exercise record in `docs/DISASTER_RECOVERY.md`.
7. Delete the scratch project: open it, **Project Settings**, **General**, **Delete project**.

Database backups do not include uploaded files (photos, agreements, recordings). See `docs/DISASTER_RECOVERY.md`.

---

### Step 11: Emergency recovery (Agastya only)

Only if every CEO login and every authenticator phone is lost at once. Done by **Agastya only**, written down and recorded in the incident log afterwards.

1. In Supabase, open `laboura-production`, then **SQL Editor**.
2. Run, with the right email:
   ```sql
   UPDATE "Staff"
   SET "status" = 'active',
       "totpSecret" = NULL,
       "totpEnabled" = false
   WHERE "email" = 'ceo@laboura.in';
   ```
3. Then end that person's open sessions:
   ```sql
   DELETE FROM "StaffSession"
   WHERE "staffId" IN (SELECT "id" FROM "Staff" WHERE "email" = 'ceo@laboura.in');
   ```
4. The CEO logs in at `/login` with the staff code and the password and is taken through the authenticator set-up again.
5. Record what was done and why in the incident log.

---

## Free tier for testing

Use this section to put Laboura online **for testing with made-up data only**, for free. It uses one free Render web service, one free Render Key Value and a free Supabase project. Nothing here costs money. **No command line or terminal is required:** every step is a click in a web browser.

Do **not** apply `render.yaml` on the free tier: that file describes the paid setup and creates paid services. The free setup is described in a second file, `render.free.yaml`.

### How the free setup differs from the paid one

| Paid setup (`render.yaml`) | Free setup (`render.free.yaml`) | Why |
| --- | --- | --- |
| A separate Background Worker runs the scheduled jobs | The one web service also runs every job: `PROCESS_ROLE` is `all` | Render's free tier has no Background Worker |
| `npm run migrate:deploy` runs as a Pre-Deploy Command | `npm run migrate:deploy` runs at the **end of the build command** | Free services have no Pre-Deploy Command |
| The web service never sleeps | It sleeps after 15 minutes with no visitors and takes about a minute to wake | Free tier rule. An uptime monitor (step F10) keeps it awake |
| Key Value keeps its data on disk | The free Key Value loses everything when it restarts | The app puts every job schedule back by itself on every start and every 10 minutes; `/health/ready` says `schedules` while any is missing |
| Supabase Pro, daily backups | Supabase Free, **no backups**, pauses after a week with no use | Made-up data only |
| Database in Singapore | Database in **Mumbai** (`ap-south-1`) | Owner decision, 12 Nov: the empty Supabase project is recreated in Mumbai |

The Render parts stay in **Singapore** (Render has no India region).

### Steps F1 to F13

**F1. Delete the old empty Supabase project (only if it is empty).** Go to **[supabase.com/dashboard](https://supabase.com/dashboard)** and sign in. If an empty Laboura project already exists in Singapore, open it, click **Project Settings** (gear icon, bottom left), then **General**, scroll down and click **Delete project**. Only do this if it holds no data you need.

**F2. Create the Supabase project in Mumbai.**
1. Click **New project**.
2. **Project name**: `laboura-test`.
3. **Database password**: click **Generate a password**. If it contains symbols such as `@ # / ? %`, click again until it is only letters and numbers. Copy it into your password manager now.
4. **Region**: **South Asia (Mumbai)** (`ap-south-1`).
5. If you see **Automatically expose new tables** (Data API), leave it **unticked**.
6. Click **Create new project** and wait one or two minutes.

**F3. Copy the two database addresses.** Do [Step 2](#step-2-copy-the-two-database-addresses) exactly as written, in the `laboura-test` project. The addresses will contain `ap-south-1` instead of `ap-southeast-1`; that is correct. You end with **DATABASE_URL** (Transaction pooler, port 6543, ending `?pgbouncer=true&connection_limit=5&sslmode=require`) and **DIRECT_URL** (Session pooler, port 5432, ending `?sslmode=require`).

**F4. Create the four private buckets and copy the storage keys.** Do [Step 3](#step-3-create-the-four-private-file-buckets-and-copy-the-storage-keys): buckets `candidate-photos`, `business-photos`, `agreements`, `recordings`, each with **Public bucket** off. You end with **SUPABASE_URL** and **SUPABASE_SERVICE_ROLE_KEY**.

**F5. Turn off the Supabase Data API.** Do [Step 4](#step-4-turn-off-the-supabase-data-api).

**F6. Create the two Render parts.** Go to **[dashboard.render.com](https://dashboard.render.com)** and sign in. Choose **one** of the two ways.

*Way A, from the free Blueprint (fewer clicks):*
1. Click **New** (top right), then **Blueprint**.
2. Pick the repository **Labouraos**, branch **main**.
3. In **Blueprint Path**, type `render.free.yaml` (instead of the default `render.yaml`).
4. Render lists two things: `laboura-test` (Web Service, Free, Singapore) and `laboura-test-redis` (Key Value, Free, Singapore). If it shows a price, or a Background Worker, stop: you picked `render.yaml` by mistake.
5. Render asks for the settings that have no value. Paste `DATABASE_URL`, `DIRECT_URL` (F3), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (F4), and `PUBLIC_APP_URL` = `https://laboura-test.onrender.com`. For `COMPANY_UPI_VPA` and `COMPANY_UPI_PAYEE_NAME` type a made-up UPI id and name (for example `test@upi` and `Laboura Test`). Leave `ALERT_WEBHOOK_URL` empty.
6. Click **Deploy Blueprint**.

*Way B, by hand:*
1. **Key Value first.** Click **New**, then **Key Value**. Name `laboura-test-redis`, Region **Singapore**, Instance Type **Free**, Maxmemory Policy **noeviction**. Click **Create Key Value**. When it is ready, copy the **Internal Key Value URL** (it looks like `redis://red-abc123:6379`). The part between `//` and `:` (here `red-abc123`) is **REDIS_HOST**; `6379` is **REDIS_PORT**.
2. **Web service.** Click **New**, then **Web Service**. Pick the repository **Labouraos**, branch **main**. Name `laboura-test`, Region **Singapore**, Language **Node**, Instance Type **Free**.
   - **Build Command**: `npm ci --include=dev && npx prisma generate && npm run build && npm run migrate:deploy`
   - **Start Command**: `npm run start:prod`
   - Under **Advanced**, **Health Check Path**: `/health`
3. Under **Environment Variables**, click **Add Environment Variable** for each line of the table below. For the five secrets, open your password manager, make a new random password of 40 letters and numbers for each, and paste it.

   | Setting | Value |
   | --- | --- |
   | `NODE_ENV` | `production` |
   | `PROCESS_ROLE` | `all` (one process serves the site **and** runs the jobs) |
   | `WORKER_HEARTBEAT_CHECK` | `true` |
   | `TRUST_PROXY_HOPS` | `1` (check it in step F11) |
   | `DATABASE_URL`, `DIRECT_URL` | From F3 |
   | `REDIS_HOST`, `REDIS_PORT` | From the Key Value (step 1 above) |
   | `REDIS_TLS` | `false` |
   | `PUBLIC_APP_URL` | `https://laboura-test.onrender.com` (the address Render shows at the top of the service page) |
   | `JWT_SECRET`, `LOGIN_CODE_SECRET`, `CALL_ROUTING_KEY`, `PAYOUT_ACCOUNT_KEY`, `STAFF_BOOTSTRAP_SECRET` | A new random 40-character secret each |
   | `JWT_EXPIRES_IN` | `15m` |
   | `CANDIDATE_PHOTO_STORAGE_MODE`, `BUSINESS_PHOTO_STORAGE_MODE`, `AGREEMENT_STORAGE_MODE`, `RECORDING_STORAGE_MODE` | `supabase` |
   | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | From F4 |
   | `COMPANY_LEGAL_NAME` | `Laboura Private Limited` |
   | `COMPANY_ADDRESS` | `Bengaluru, Karnataka, India` |
   | `COMPANY_UPI_VPA`, `COMPANY_UPI_PAYEE_NAME` | A made-up UPI id and name (payment links are refused while empty) |
   | `OTP_PROVIDER_MODE`, `SMS_PROVIDER_MODE`, `PAYMENT_PROVIDER_MODE`, `WHATSAPP_PROVIDER_MODE`, `TELEPHONY_PROVIDER_MODE`, `KYC_PROVIDER_MODE` | `mock` |
   | `CLOUDFLARE_ACCESS_ENFORCED` | `false` (testing only) |

4. Click **Deploy Web Service**.

**F7. Read the deploy log.** Open `laboura-test`, then **Events**, and click the newest deploy. The build takes several minutes. It must end with `All migrations have been successfully applied.`; then the start shows `Nest application successfully started` and `PROCESS_ROLE=all: serving the API and running every scheduled job`. If the migration step stops with an error and Supabase already had tables from an older try, start again from an empty project (F1, F2).

**F8. Check it is up.**
1. Open `https://laboura-test.onrender.com/health`. It shows `"status":"ok"`.
2. Open `https://laboura-test.onrender.com/health/ready`. It shows `"status":"ready"`, `"postgres":"ok"`, `"redis":"ok"`, a `"worker"` section with `"status":"alive"` and a `"schedules"` section with `"status":"ok"`. Right after the first start, wait one minute and reload if `schedules` is not `ok` yet.
3. In Supabase, open **Table Editor**: it lists `Staff`, `JobSeeker`, `Payment` and the rest. Then **Advisors**, **Security Advisor**, **Rerun**: there must be no "RLS disabled in public" error.

**F9. Create the first CEO, set up the authenticator and a second CEO.** Do [Step 7](#step-7-create-the-first-ceo-account) and [Step 8](#step-8-create-a-second-ceo-account-on-a-different-phone), using `https://laboura-test.onrender.com` as the address. The first CEO is created on the app's own set-up page; nothing is typed into any other website.

**F10. Keep it awake with an uptime monitor (every 10 minutes).**
1. Go to **[uptimerobot.com](https://uptimerobot.com)** and create a free account.
2. Click **New monitor**. Type **HTTP(s)**. Friendly name `Laboura test`. URL `https://laboura-test.onrender.com/health/ready`. Monitoring interval **10 minutes** (the free plan allows 5 minutes or more; do not go above 10).
3. Add your email under **Alert contacts** and click **Create monitor**.

This does three things: the web service never sleeps (it sleeps after 15 minutes without a visitor), so the nightly jobs can run at their times; Supabase sees daily use, so it does not pause the project; and you get an email when the database, the queue, the worker or the job schedules fail. One always-on free web service fits inside Render's 750 free hours a month; a second free web service would not.

**F11. Check the visitor address (`TRUST_PROXY_HOPS`) — on the first deploy.** Rate limits need the real address of each visitor.
1. Log in as the CEO, open **Team & Access**, then **Devices & logins**, and look at the address shown for your own login.
2. In another tab, search the web for "what is my IP" and note your public address.
3. If they match, nothing to do. If the app shows an address starting with `10.` or one that is not yours, open `laboura-test`, **Environment**, change `TRUST_PROXY_HOPS` from `1` to `2`, click **Save Changes**, wait for the restart, log in again and compare. Raise it by one until the addresses match (a Render community report needed `3`). Write the final number down.

**F12. Test OTP steps with the on-screen test code.** Every vendor is in `mock` mode, so no SMS is sent. Instead, whenever a screen asks for an OTP, a yellow banner **"Test mode code: 123456"** shows the code (and the server log shows it too). This test mode turns off by itself when `OTP_PROVIDER_MODE` is `real`, and is never shown when `NODE_ENV` is `production` with any live vendor.

**F12b. Forgot password (CEO, Managers, Finance) in test mode.** No email vendor is chosen yet (`EMAIL_PROVIDER_MODE` is `mock`, the default), so no email goes out. The screen always gives the same answer; the reset link is written to the server log next to a masked address (`p***@laboura.in`). Test mode turns off when `EMAIL_PROVIDER_MODE` is `real` (which also needs `EMAIL_API_URL`, `EMAIL_API_KEY` and `EMAIL_FROM`) or when `NODE_ENV` is `production` with any live vendor.

**F13. Open the field app on a phone.** Open `https://laboura-test.onrender.com/field` on an iPhone in Safari, then **Share**, **Add to Home Screen**. (Once laboura.com is connected, use `https://field.laboura.com` instead: see "Connect laboura.com at Hostinger".)

### If something stops on the free tier

- **`/health/ready` says `schedules` is missing.** The free Key Value restarted and lost the job schedules. The app puts them back within 10 minutes by itself. To do it at once: open `laboura-test`, click **Manual Deploy**, then **Restart service**. A CEO can also run any job straight away from **System Health** (or `POST /jobs/<job>/run-now`).
- **The log shows "max number of clients reached".** The free Key Value allows few connections and the single process opens about 45 (one queue and one worker per job). Jobs then fail. Tell Claude: the fix is to share connections or move to the paid Key Value.
- **The service restarts during testing.** A free instance has 512 MB of memory. Open **Metrics** and look at memory; if it touches the top, tell Claude.
- **The first page after a quiet spell takes a minute.** The service was asleep; check the uptime monitor (F10) is running.
- **A restart clears the in-memory test OTP codes and the rate-limit counters.** Ask for a new code after a restart.

### Before any real data

The free setup is for made-up data only. Before real data, move to the paid setup (Steps 1 to 11 above with `render.yaml`), Supabase Pro, Cloudflare Access on, new secrets everywhere, and the repository private.

---

## Connect laboura.com at Hostinger (app.laboura.com and field.laboura.com)

`laboura.com` itself stays the public website: **its records at Hostinger are left untouched.** The software gets two sub-addresses of it:

| Address | What opens there |
| --- | --- |
| `https://app.laboura.com` | One login page (`/login`) for the CEO, Managers, Team Leads, Finance and call agents, each landing in their own portal: `/ceo`, `/manager`, `/team-lead`, `/finance`, `/call-agent`. Also the public pages for job seekers and businesses (`/p/...`) and the API. |
| `https://field.laboura.com` | Laboura Field, the installable app for field agents. |

Both point at the same Render web service (`laboura-api`, or `laboura-test` on the free tier). Render gives both a free HTTPS certificate. The Render test address (`https://laboura-test.onrender.com`) keeps working too: the portals at its root and Laboura Field at `/field`.

**H1. Copy the Render address.** In Render, open the web service. At the top of its page is its address, like `laboura-test.onrender.com`. Copy it **without** `https://` and without a `/` at the end.

**H2. Add two records at Hostinger.**
1. Log in to Hostinger (`hpanel.hostinger.com`). Click **Domains**, then `laboura.com`, then **DNS / Nameservers** (in some accounts: **Manage DNS records**).
2. Under **Manage DNS records**, add the first record:
   - **Type:** `CNAME`
   - **Name:** `app` (only the word `app`; Hostinger adds `.laboura.com` itself)
   - **Points to** (or **Target**): the Render address from H1, for example `laboura-test.onrender.com`
   - **TTL:** leave the default
   - Click **Add Record**.
3. Add the second record the same way, with **Name** `field` and the same **Points to**.
4. Do not change or delete any other record. The records named `@` and `www` (and any `MX` email records) belong to the main website and email. If Hostinger already shows a record named exactly `app` or `field`, stop and ask before changing it.

**H3. Add both addresses in Render.**
1. In Render, open the web service, then **Settings**, then **Custom Domains**.
2. Click **+ Add Custom Domain**, type `app.laboura.com`, click **Save**.
3. Click **+ Add Custom Domain** again, type `field.laboura.com`, click **Save**. (If Render offers to add `www` or the bare `laboura.com` too, say no: those stay with the website.)
4. Next to each address, click **Verify**. Right after H2 it may say the record is not found yet: changes at Hostinger can take from a few minutes up to a few hours to reach the internet. Wait and click **Verify** again.
5. When verified, Render requests the free certificate by itself. Wait until both addresses show **Certificate Issued** (usually a few minutes).

**H4. Tell the app its addresses.** Only after both show **Certificate Issued**:
1. In Render, open the web service, then **Environment**.
2. Set `PUBLIC_APP_URL` to `https://app.laboura.com` (this is the address every SMS and WhatsApp link will use from now on).
3. Set `FIELD_HOST` to `field.laboura.com` (no `https://`).
4. Click **Save Changes**. The service restarts in a minute or two. On the paid setup the worker copies `PUBLIC_APP_URL` from the web service by itself.

**H5. Check.**
1. Open `https://app.laboura.com/login`: the staff sign-in page. Sign in as the CEO: you land on `https://app.laboura.com/ceo`.
2. Open an old address with `/app` in it, like `https://app.laboura.com/app/ceo`: it moves to `https://app.laboura.com/ceo` by itself. Links already sent by SMS or WhatsApp with `/app/...` keep working the same way, on whichever address they were sent with.
3. On a phone, open `https://field.laboura.com`: the Laboura Field sign-in. On an iPhone: Safari, **Share**, **Add to Home Screen**. On Android: Chrome, menu, **Install app** (or **Add to Home screen**).
4. A field agent who installed Laboura Field from the onrender.com address must install it again from `https://field.laboura.com`, then sign in once. A new address counts as a new phone, so their Team Lead approves the phone again (the same as for any new phone).

If something does not open: wait an hour (the Hostinger change may still be spreading), check that both records in H2 point at exactly the address from H1, and that Render shows **Certificate Issued** for both.

---

## All settings

`laboura-api` holds every setting. The worker copies the ones it needs from `laboura-api` (shown in Render as "from laboura-api"), except the fixed values written in `render.yaml`.

| Setting | Value | What it is |
| --- | --- | --- |
| `NODE_ENV` | `production` (fixed) | Production switches on the strict start-up checks |
| `PROCESS_ROLE` | `web` / `worker` (fixed); `all` on the free tier | Keeps scheduled jobs in the worker only; `all` makes one process serve the site and run the jobs (free tier, no worker) |
| `TRUST_PROXY_HOPS` | `1` (fixed; `2` behind Cloudflare) | How many proxies sit in front of the app, so rate limits see the real visitor address |
| `DATABASE_URL` | Step 2, transaction pooler, port 6543 | The database address the app uses |
| `DIRECT_URL` | Step 2, session pooler, port 5432 | The database address used for migrations |
| `REDIS_HOST`, `REDIS_PORT` | From `laboura-redis` (automatic) | The job queue's private address |
| `REDIS_TLS` | `false` (fixed) | The private Key Value address does not use TLS |
| `WORKER_HEARTBEAT_CHECK` | `true` on web (fixed) | `/health/ready` reports the worker as failed when its heartbeat stops, and `schedules` as failed when a job schedule is missing from the queue |
| `JWT_SECRET` | Generated by Render | Signs login tokens |
| `JWT_EXPIRES_IN` | `15m` (fixed) | How long a login token lasts |
| `LOGIN_CODE_SECRET` | Generated by Render, shared with the worker | Computes the 6-digit login codes |
| `STAFF_BOOTSTRAP_SECRET` | Generated by Render | Needed once, to create the first CEO (Step 7) |
| `CALL_ROUTING_KEY` | Generated by Render, shared with the worker | Encrypts staff phone numbers used for call routing |
| `PAYOUT_ACCOUNT_KEY` | Generated by Render, shared with the worker | Encrypts payout UPI and bank details |
| `CUSTOMER_JWT_SECRET` | Generated by Render | Signs sign-ins of the Laboura customer app (job seekers, businesses, referral partners). Separate from `JWT_SECRET`, so a customer can never use a staff door |
| `GOOGLE_CLIENT_ID_ANDROID`, `GOOGLE_CLIENT_ID_IOS`, `GOOGLE_CLIENT_ID_WEB` | From the Laboura Firebase project (Project settings, then Your apps; for Android the client id appears once the app's SHA-1 fingerprint is added) | Turns on "Continue with Google" in the customer app. Leave all three empty and the app shows mobile + OTP only. Changing them needs no redeploy of the app, only a restart of `laboura-api` |
| `PUBLIC_APP_URL` | `https://app.laboura.com` (the onrender.com address until the domain is connected) | The public web address of the app. Every link the software sends (invites, password resets, the public `/p/...` pages, receipts) starts with it; required to start. Links are never built from the address a visitor happened to use. |
| `FIELD_HOST` | `field.laboura.com` (empty until connected) | The address that opens Laboura Field at its root. Every other address opens the office app, with Laboura Field also at `/field` |
| `CANDIDATE_PHOTO_STORAGE_MODE`, `BUSINESS_PHOTO_STORAGE_MODE`, `AGREEMENT_STORAGE_MODE`, `RECORDING_STORAGE_MODE` | `supabase` on both services (fixed) | Keeps uploads in Supabase Storage; production refuses to start otherwise. `CANDIDATE_PHOTO_STORAGE_MODE` also covers referral partner selfies and staff photos |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Step 3 | Lets the app read and write the four private buckets |
| `COMPANY_LEGAL_NAME`, `COMPANY_GSTIN`, `COMPANY_ADDRESS` | Company details | Printed on GST invoices |
| `COMPANY_UPI_VPA`, `COMPANY_UPI_PAYEE_NAME` | Bank UPI details | UPI payment links and QR codes |
| `CLOUDFLARE_ACCESS_ENFORCED`, `CLOUDFLARE_ACCESS_TEAM_DOMAIN`, `CLOUDFLARE_ACCESS_AUD` | Step 9 | Identity check in front of the office consoles |
| `ALERT_WEBHOOK_URL` | Slack-style webhook | Where error alerts are posted |
| `OTP_PROVIDER_MODE`, `SMS_PROVIDER_MODE`, `PAYMENT_PROVIDER_MODE`, `WHATSAPP_PROVIDER_MODE`, `TELEPHONY_PROVIDER_MODE`, `KYC_PROVIDER_MODE` | `mock` (fixed) until each vendor is signed up | Picks the mock or the real vendor; the only switch for each vendor |
| `SMS_API_KEY`, `SMS_API_URL`, `DLT_SENDER_ID`, `DLT_TEMPLATE_ID`, `DLT_ENTITY_ID`, `SMS_DLT_TEMPLATE_IDS` | From the SMS gateway | OTP and SMS messages |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | From Meta | WhatsApp messages |
| `TELEPHONY_VENDOR`, `TOLL_FREE_NUMBER` | From the calling vendor | Calls |
| `KYC_API_KEY`, `KYC_API_URL` | From the licensed Aadhaar vendor | Identity checks |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAYX_WEBHOOK_SECRET`, `RAZORPAYX_ACCOUNT_NUMBER` | From Razorpay | Card payments (only when a payer picks a card) and payouts |
| `BANK_FEED_WEBHOOK_SECRET`, `PAYMENT_WEBHOOK_SECRET`, `PAYOUT_WEBHOOK_SECRET`, `TELEPHONY_WEBHOOK_SECRET`, `MESSAGE_WEBHOOK_SECRET` | At least 32 characters each, shared with the vendor | Proves an incoming webhook really came from the vendor |

Bucket names default to `candidate-photos`, `business-photos`, `agreements` and `recordings`; you do not set them. `.env.example` in the code lists every setting with the same names.

---

## Webhook addresses for vendors

When a vendor is signed up, give them the matching address below and agree a signing secret of at least 32 characters. Put the same secret in Render (`laboura-api`, **Environment**).

| What | Address to give the vendor | Secret setting | Signature header the app accepts |
| --- | --- | --- | --- |
| Bank credits | `https://<your laboura-api address>/payments/bank-feed/webhook` | `BANK_FEED_WEBHOOK_SECRET` | `X-Bank-Signature`, `X-Bank-Feed-Signature`, `X-Signature` or `X-Webhook-Signature` |
| Card payments | `https://<your laboura-api address>/payments/webhook` | `PAYMENT_WEBHOOK_SECRET` | `X-Razorpay-Signature`, `X-Signature` or `X-Webhook-Signature` |
| Incoming calls | `https://<your laboura-api address>/telephony/inbound` | `TELEPHONY_WEBHOOK_SECRET` | `X-Telephony-Signature` or `X-Signature` |
| Missed calls | `https://<your laboura-api address>/telephony/webhook/missed-call` | `TELEPHONY_WEBHOOK_SECRET` | `X-Telephony-Signature` or `X-Signature` |
| Call status | `https://<your laboura-api address>/telephony/webhook/call-status` | `TELEPHONY_WEBHOOK_SECRET` | `X-Telephony-Signature` or `X-Signature` |
| WhatsApp delivery | `https://<your laboura-api address>/messages/webhook/whatsapp` | `MESSAGE_WEBHOOK_SECRET` | `X-Message-Signature`, `X-Signature` or `X-Hub-Signature-256` |
| SMS delivery | `https://<your laboura-api address>/messages/webhook/sms` | `MESSAGE_WEBHOOK_SECRET` | `X-Message-Signature` or `X-Signature` |

---

## If Laboura was already on Render before this guide

An older version of the setup used a Redis service outside Render for the queue, and different setting names. When this version reaches the `main` branch, Render syncs the Blueprint and creates `laboura-redis`. Render does **not** add new "paste a value" settings to services that already exist, and does not remove old ones. So, once, by hand:

1. Open **`laboura-api`**, then **Environment**:
   - **Add** `DIRECT_URL` (Step 2, session pooler). Without it the database changes fail with "Environment variable not found: DIRECT_URL".
   - **Change** `DATABASE_URL` to the transaction pooler address from Step 2 (port 6543 with `?pgbouncer=true&connection_limit=5&sslmode=require`).
   - **Delete** `REDIS_PASSWORD` if it is there. The Key Value's private address has no password, and an old password from the previous Redis service makes every connection fail.
   - **Delete** `TRUSTED_PROXY_HOPS`, `WHATSAPP_API_KEY`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `TELEPHONY_API_KEY` and `RECORDINGS_BUCKET` if they are there. They are old names the code no longer reads.
   - Click **Save Changes**.
2. Open **`laboura-worker`**, then **Environment**, and delete `REDIS_PASSWORD` there too. Check that `DIRECT_URL` shows "from laboura-api".
3. Do Steps 3 and 4 if the four buckets or the Data API switch are not done yet.
4. Open **Blueprints**, then `laboura`, and click **Manual Sync** if Render has not synced by itself.
5. Do Step 6 to check everything.
6. If the old services were made by hand rather than from this Blueprint, ask Claude before applying the Blueprint: the names would clash.
7. The old Redis service outside Render can be closed once `/health/ready` shows `"redis":"ok"` and the worker as alive.

---

## Troubleshooting

- **The build fails with "nest: not found" or "prisma: not found".** The build command must start with `npm ci --include=dev`. It is set in `render.yaml`; check nobody changed it in the dashboard (**Settings**, **Build Command**).
- **The Pre-Deploy step fails.** Render stops before the new version takes any traffic; the old version keeps running. Open the deploy log. "Environment variable not found: DIRECT_URL": add `DIRECT_URL` (Step 2). "Can't reach database server": check `DIRECT_URL` uses the **session pooler** (port 5432), not "Direct connection".
- **"prepared statement already exists".** `DATABASE_URL` is on port 6543 without `pgbouncer=true`. Add `?pgbouncer=true&connection_limit=5&sslmode=require` to the end.
- **Database error P1001 or "password authentication failed".** The password in the address is wrong or contains symbols. Reset it to letters and numbers only (Supabase, **Project Settings**, **Database**, **Reset database password**) and update both `DATABASE_URL` and `DIRECT_URL`.
- **The web service will not start: "PUBLIC_APP_URL environment variable is missing".** Fill in `PUBLIC_APP_URL` (Step 5).
- **"Refusing to start in production: uploaded files would be kept in memory".** One of the four `*_STORAGE_MODE` settings is not `supabase`. They are fixed in `render.yaml`; a manual change in the dashboard caused this.
- **"file storage is set to Supabase but SUPABASE_URL ... is empty".** Paste `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (Step 3) on `laboura-api`.
- **The worker keeps restarting with "Worker cannot reach Redis".** Check `laboura-redis` is running (Render dashboard) and that `REDIS_PASSWORD` is not set on the worker. `REDIS_TLS` must be `false`.
- **`/health/ready` says `worker` failed.** The worker has not written its heartbeat for 2 minutes. Open `laboura-worker`, **Logs**, and look at the last lines.
