# Putting Laboura online (Render + Supabase)

This guide is for someone who has never used a terminal. **No command line or terminal is required.** Every step is a click in a web browser, in the Render dashboard or the Supabase dashboard.

Read each step to the end before you start clicking. Keep a password manager (or a private note) open: you will copy several long values from one website and paste them into another.

---

## What you are building

| Part | Where | What it does |
| --- | --- | --- |
| **Web service** `laboura-api` | Render, Singapore | The API, the webhooks and the staff consoles (`/admin`, `/call-agent`, `/field-agent`) |
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

Uploaded files are kept in Supabase Storage. Laboura needs four buckets, all **private**. They hold personal data (selfies, shop photos, signed agreements, recorded calls) and must never be public.

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

When the app first starts, no staff accounts exist. A one-time "bootstrap" request creates the CEO. You send it from a web page called ReqBin, so no terminal is needed.

1. **Copy the bootstrap secret.** In Render, open **`laboura-api`**, then **Environment**. Find `STAFF_BOOTSTRAP_SECRET` and click the eye icon to show it. Copy it.
2. **Send the request.** Open **[reqbin.com](https://reqbin.com)**.
   - Method: **POST**.
   - Address: `https://<your laboura-api address>/staff/bootstrap`
   - Open the **Content** (body) tab, choose **JSON**, and paste, replacing the three values:
     ```json
     {
       "name": "Sanket",
       "email": "ceo@laboura.in",
       "password": "A-long-password-you-will-remember",
       "secret": "PASTE-THE-BOOTSTRAP-SECRET-HERE"
     }
     ```
   - Click **Send**. The answer is `201` and includes `"code": "CEO-00001"` (the staff code). Write the staff code down. This only works while no staff account exists.
3. **Set up the authenticator app on the first login.** Open `https://<your laboura-api address>/admin`.
   - Log in with the **staff code** (for example `CEO-00001`) and the password. Not the email. Leave the authenticator box empty this first time.
   - The page shows a secret key. Add it to Google Authenticator, Microsoft Authenticator or Authy.
   - Type the 6-digit code from the app and click **Verify & Enable 2FA**.
   - Log in again with the staff code, the password and a fresh 6-digit code. That login also approves this browser as the CEO's device.

Managers and Finance also use an authenticator app. Team Leads and agents instead wait on the "Ask your Team Lead for your code" page until someone reveals their code on the Login codes screen.

#### Office network (once the office opens)

Until an office network is added, nobody is limited to it. Add it only when the office has its own internet connection. You need the address range from whoever set it up (it looks like `203.0.113.0/24`); never guess it.

1. Log in to `/admin` as the CEO or a Manager.
2. Right-click the page, choose **Inspect**, open **Application** (Chrome) or **Storage** (Firefox), then **Session storage**, click the Laboura address and copy the value named `laboura_token`. Close Inspect. This token lasts about 15 minutes; if a later step says "unauthorized", log in again and copy it again.
3. In **[reqbin.com](https://reqbin.com)**: method **POST**, address `https://<your laboura-api address>/office-networks`. In **Headers** add `Authorization` with the value `Bearer ` followed by the token. Body (JSON): `{ "label": "Bengaluru office", "cidr": "203.0.113.0/24" }` with the real range. Click **Send**.
4. For each person who may log in only from the office: method **POST**, address `https://<your laboura-api address>/staff/<their staff id>/works-from-office`, same header, body `{ "worksFromOffice": true }`. The staff id is the long id on their staff row, not the staff code.

---

### Step 8: Create a second CEO account on a different phone

Do this straight after Step 7. If the only CEO phone is lost before a second CEO exists, nobody can get back in through the software.

1. Log in to `/admin` as the first CEO.
2. In Staff, invite a second CEO account (for example `ceo2@laboura.in`).
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
> In `render.yaml`, `CLOUDFLARE_ACCESS_ENFORCED` is `"false"`. That is acceptable **only** while testing with made-up data. **`CLOUDFLARE_ACCESS_ENFORCED` MUST be set to `"true"` before any real candidate, worker or business data is entered into this system.** While it is `false`, the office consoles (`/admin`, `/console/admin`, `/call-agent`, `/console/call-agent`) are not behind Cloudflare's identity check.
>
> 1. In **Cloudflare Zero Trust** (`one.dash.cloudflare.com`), open **Access**, then **Applications**, and add a self-hosted application for your domain covering `/admin*`, `/console/admin*`, `/call-agent*` and `/console/call-agent*`. Leave `/field-agent` out: field agents use it from their phones.
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
4. The CEO logs in at `/admin` with the password and is taken through the authenticator set-up again.
5. Record what was done and why in the incident log.

---

## All settings

`laboura-api` holds every setting. The worker copies the ones it needs from `laboura-api` (shown in Render as "from laboura-api"), except the fixed values written in `render.yaml`.

| Setting | Value | What it is |
| --- | --- | --- |
| `NODE_ENV` | `production` (fixed) | Production switches on the strict start-up checks |
| `PROCESS_ROLE` | `web` / `worker` (fixed) | Keeps scheduled jobs in the worker only |
| `TRUST_PROXY_HOPS` | `1` (fixed; `2` behind Cloudflare) | How many proxies sit in front of the app, so rate limits and the office-network rule see the real visitor address |
| `DATABASE_URL` | Step 2, transaction pooler, port 6543 | The database address the app uses |
| `DIRECT_URL` | Step 2, session pooler, port 5432 | The database address used for migrations |
| `REDIS_HOST`, `REDIS_PORT` | From `laboura-redis` (automatic) | The job queue's private address |
| `REDIS_TLS` | `false` (fixed) | The private Key Value address does not use TLS |
| `WORKER_HEARTBEAT_CHECK` | `true` on web (fixed) | `/health/ready` reports the worker as failed when its heartbeat stops |
| `JWT_SECRET` | Generated by Render | Signs login tokens |
| `JWT_EXPIRES_IN` | `15m` (fixed) | How long a login token lasts |
| `LOGIN_CODE_SECRET` | Generated by Render, shared with the worker | Computes the 6-digit login codes |
| `STAFF_BOOTSTRAP_SECRET` | Generated by Render | Needed once, to create the first CEO (Step 7) |
| `CALL_ROUTING_KEY` | Generated by Render, shared with the worker | Encrypts staff phone numbers used for call routing |
| `PAYOUT_ACCOUNT_KEY` | Generated by Render, shared with the worker | Encrypts payout UPI and bank details |
| `PUBLIC_APP_URL` | Your app's `https://` address | The public web address of the app, used in links sent by SMS and WhatsApp; required to start |
| `CANDIDATE_PHOTO_STORAGE_MODE`, `BUSINESS_PHOTO_STORAGE_MODE`, `AGREEMENT_STORAGE_MODE`, `RECORDING_STORAGE_MODE` | `supabase` on both services (fixed) | Keeps uploads in Supabase Storage; production refuses to start otherwise |
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
