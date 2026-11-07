# Production Deployment Guide — Laboura

This guide explains how to deploy the Laboura Staffing Marketplace API and Background Worker to production using managed cloud providers.

This guide is written for non-technical operators and management. **No command line or terminal is required.** Everything is done entirely using web browser dashboards.

---

## Architecture Overview

The system consists of four managed components:

| Component | Provider | Role |
| --- | --- | --- |
| **Web Service (`laboura-api`)** | Render | Serves the REST API, webhooks, and internal agent consoles |
| **Background Worker (`laboura-worker`)** | Render | Executes recurring sweeps (midnight no-pickup evaluation) and queues via BullMQ |
| **Relational Database** | Supabase | Managed PostgreSQL 17 database storing all business records |
| **Message Queue / Cache** | Upstash | Managed Redis with TLS for BullMQ queues and job scheduling |

### How Database Migrations Are Handled (Schema Creation)

Render does not create database tables on its own. To ensure the database schema and all tables exist before any traffic is served, the deployment uses Render's **Pre-Deploy Command**:

```bash
npx prisma migrate deploy
```

- **Where it runs**: On the `laboura-api` Web Service only.
- **When it runs**: Automatically during every deployment, after the application compiles but *before* the new version begins receiving web requests.
- **Why it does not run on the Worker**: The `laboura-worker` service has no pre-deploy step. This guarantees migrations run **sequentially from a single process**, preventing database locking or race conditions from concurrent migrations.

---

## Deployment Steps (In Order)

Follow these steps in exact sequential order:
1. Create Database on Supabase
2. Create Redis on Upstash
3. Deploy Blueprint on Render
4. Enter Environment Variables in Render
5. Verify Deployment & Database Tables
6. Create Initial CEO Account (Bootstrap & First Login 2FA Enrolment)
7. Create Second CEO Account on a Different Device (Mandatory Immediate Redundancy)
8. Last-Resort Emergency Manual Recovery (Agastya Only)

---

### Step 1: Create Database on Supabase

1. Open your browser and navigate to **[https://supabase.com](https://supabase.com)**.
2. Sign in or create an account.
3. In the Supabase dashboard, click the green **New project** button.
4. Fill in the project creation form:
   - **Organization**: Choose your organization.
   - **Name**: Enter `laboura-production`.
   - **Database Password**: Click **Generate a password** or create a strong password. **Important:** Copy and save this password immediately in a password manager.
   - **Region**: Select **Southeast Asia (Singapore)** (or the region closest to Bengaluru).
5. Click **Create new project** and wait 1–2 minutes for the database to provision.
6. Once provisioned, look at the left sidebar menu and click the **Project Settings** icon (gear icon at the bottom left).
7. In the settings menu, click **Database**.
8. Scroll down to the **Connection string** section.
9. Click the **URI** tab.
10. Ensure the mode is set to **Transaction** or **Session** (Port `5432` or `6543`).
11. Copy the connection string displayed. It looks like:
    ```text
    postgresql://postgres.[project-ref]:[YOUR-PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
    ```
12. Replace `[YOUR-PASSWORD]` in that string with the real password you saved in step 4.
13. Keep this final connection string ready for Step 4. This is your `DATABASE_URL`.

---

### Step 2: Create Redis on Upstash

1. Open your browser and navigate to **[https://console.upstash.com](https://console.upstash.com)**.
2. Sign in or create an account.
3. On the Upstash dashboard, click the **Create Database** button.
4. Fill in the form:
   - **Name**: Enter `laboura-redis`.
   - **Type**: Select **Regional**.
   - **Region**: Select **ap-southeast-1 (Singapore)** (matching your Supabase region).
   - **TLS (SSL)**: Ensure TLS is enabled.
5. Click **Create**.
6. On the database overview page, scroll down to the **Connect your database** section.
7. Click the **ioredis** or **Node** tab.
8. Locate the following four connection values:
   - **Endpoint / Host**: (e.g. `ap1-xxxx.upstash.io`) → this is your `REDIS_HOST`.
   - **Port**: `6379` → this is your `REDIS_PORT`.
   - **Password**: Click the eye icon to reveal and copy → this is your `REDIS_PASSWORD`.
   - **TLS**: Upstash requires TLS → your `REDIS_TLS` is `true`.
9. Keep these four values ready for Step 4.

---

### Step 3: Deploy Blueprint on Render

1. Open your browser and navigate to **[https://dashboard.render.com](https://dashboard.render.com)**.
2. Sign in or create an account.
3. In the top right corner, click the blue **New +** button, then select **Blueprint**.
4. Connect your GitHub repository containing Laboura (`Labouraos`).
5. Render will automatically detect the [`render.yaml`](file:///home/agastyaone/Labouraos/render.yaml) file at the root of the repository.
6. Render will show you a blueprint preview listing two services:
   - **`laboura-api`** (Web Service)
   - **`laboura-worker`** (Background Worker)
7. Click **Apply**.
8. Render will initialize both services. It will pause or highlight environment variables that need values.

---

### Step 4: Configure Environment Variables in Render Dashboard

1. In the Render Dashboard, click on the **`laboura-api`** service.
2. Click the **Environment** tab on the left sidebar.
3. Enter or verify the following variables:

| Variable Name | Value to Enter | Description |
| --- | --- | --- |
| `NODE_ENV` | `production` | Production environment flag |
| `PROCESS_ROLE` | `web` | **Critical:** Gates HTTP process from running worker sweeps |
| `DATABASE_URL` | *Paste your Supabase URI from Step 1* | PostgreSQL connection string |
| `REDIS_HOST` | *Paste Upstash Host from Step 2* | Redis hostname |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_PASSWORD` | *Paste Upstash Password from Step 2* | Redis password |
| `REDIS_TLS` | `true` | Enables TLS for Upstash |
| `JWT_SECRET` | *Auto-generated or 32+ char secret* | Secret used to sign authentication tokens |
| `PUBLIC_APP_URL` | *e.g. `https://app.laboura.in`* | Public web address of the app, used to create absolute links sent by SMS and WhatsApp |
| `COMPANY_UPI_VPA` | *e.g. `laboura@bank`* | Company's UPI ID used to create payment links and QR codes; payment requests fail clearly while unset, but the server can start without it |
| `COMPANY_UPI_PAYEE_NAME` | *e.g. `Laboura`* | Payee name displayed by UPI apps and on the public payment page; payment requests fail clearly while unset |
| `LOGIN_CODE_SECRET` | *Auto-generated. Do not type one.* | Secret used to compute the 6-digit login code. See "Where to find LOGIN_CODE_SECRET" below |
| `STAFF_BOOTSTRAP_SECRET` | *Auto-generated or random secret* | Secret required for initial CEO account creation |
| `OTP_PROVIDER_MODE` | `mock` | Default mock mode (§3) until SMS gateway is active |
| `PAYMENT_PROVIDER_MODE` | `mock` | Default mock mode (§3) until Razorpay keys are active |
| `WHATSAPP_PROVIDER_MODE` | `mock` | Default mock mode (§3) until WhatsApp API is active |
| `TELEPHONY_PROVIDER_MODE` | `mock` | Default mock mode (§3) until telephony vendor is active |
| `KYC_PROVIDER_MODE` | `mock` | Default mock mode (§3) until SurePass keys are active |
| `CALL_ROUTING_KEY` | *Auto-generated. Do not type one.* | 32-byte secret used to AES-256-GCM encrypt staff call routing phone numbers |
| `TELEPHONY_WEBHOOK_SECRET` | *32+ char shared secret* | Shared secret configured in the calling provider webhook |
| `MESSAGE_WEBHOOK_SECRET` | *32+ char shared secret* | Shared secret configured in the WhatsApp/SMS messaging webhook |
| `SUPABASE_URL` | *https://<project-ref>.supabase.co* | Supabase project URL from Supabase Settings > API |
| `SUPABASE_SERVICE_ROLE_KEY` | *Supabase service_role secret key* | Secret service role API key from Supabase Settings > API |
| `RECORDINGS_BUCKET` | `recordings` | Name of the private Supabase Storage bucket for call audio |
| `COMPANY_LEGAL_NAME` | *e.g. Laboura Private Limited* | Registered company entity name used on GST invoices |
| `COMPANY_GSTIN` | *e.g. 29AABCL1234F1ZQ* | 15-digit GSTIN used on tax invoices |
| `CLOUDFLARE_ACCESS_ENFORCED` | `false` (testing) / `true` (live) | **Security boundary:** Enforces Cloudflare Access on office consoles |
| `CLOUDFLARE_ACCESS_TEAM_DOMAIN` | *e.g. your-team.cloudflareaccess.com* | Cloudflare Zero Trust team domain |
| `CLOUDFLARE_ACCESS_AUD` | *Audience Tag from Cloudflare Access* | Access Application AUD tag |

> [!WARNING]
> **CRITICAL SECURITY REQUIREMENT: CLOUDFLARE ACCESS BEFORE GO-LIVE**
>
> In `render.yaml`, `CLOUDFLARE_ACCESS_ENFORCED` is set to `"false"`. This setting is **only acceptable for initial testing with synthetic / fake test data**.
>
> **`CLOUDFLARE_ACCESS_ENFORCED` MUST be set to `"true"` before any real candidate, worker, or business data is entered into this system.**
>
> When set to `"false"`, the browser office consoles (`/admin`, `/console/admin`, `/call-agent`, `/console/call-agent`) are not gated by Cloudflare Zero Trust. To enforce identity-gating before real data enters:
>
> 1. In **Cloudflare Zero Trust** (`dash.teams.cloudflare.com`), navigate to **Access** > **Applications**.
> 2. Create an **Access Application** for your domain covering the console paths (`/admin*`, `/console/admin*`, `/call-agent*`, `/console/call-agent*`).
> 3. Define an Access Policy restricting login to your company's identity provider or authorized staff email domain.
> 4. Copy the **Audience Tag (AUD)** from Application Settings.
> 5. In the **Render Dashboard** -> **`laboura-api`** -> **Environment**:
>    - Set `CLOUDFLARE_ACCESS_ENFORCED` to `true`.
>    - Set `CLOUDFLARE_ACCESS_TEAM_DOMAIN` to your Cloudflare team domain (e.g. `your-team.cloudflareaccess.com`).
>    - Set `CLOUDFLARE_ACCESS_AUD` to the Audience Tag copied from step 4.
> 6. Click **Save Changes**. The server will immediately reject requests to office consoles that lack a cryptographically valid `Cf-Access-Jwt-Assertion` token.

4. Click **Save Changes** at the bottom of the Environment page.
5. In the Render Dashboard, navigate to the **`laboura-worker`** service.
6. In `laboura-worker`, the environment variables (`DATABASE_URL`, `REDIS_*`, `JWT_SECRET`, `LOGIN_CODE_SECRET`) are automatically linked from `laboura-api` by the blueprint (`fromService`). Confirm that `PROCESS_ROLE` shows `worker` and that `LOGIN_CODE_SECRET` is present. Both services must share that one secret. A code shown on the login code screen will not match if the two services have different secrets.

#### Where to find `LOGIN_CODE_SECRET`

You do not invent this value and you do not paste it into email or chat.

1. In the Render Dashboard, open **`laboura-api`**.
2. Click **Environment**.
3. Find the row named `LOGIN_CODE_SECRET`. Render fills it in by itself the first time the blueprint is applied. Click the eye icon to look at it. Leave the value as Render generated it.
4. Open **`laboura-worker`**, then **Environment**. The same name should already be listed, copied from `laboura-api`, in the same way `JWT_SECRET` is copied. If that row is missing, add an environment variable that takes its value from the `laboura-api` service's `LOGIN_CODE_SECRET`, then save.

#### Where to find `CALL_ROUTING_KEY`

Like `LOGIN_CODE_SECRET`, you do not invent `CALL_ROUTING_KEY` and never commit it to git:
1. In the Render Dashboard, open **`laboura-api`** -> **Environment**.
2. Find `CALL_ROUTING_KEY`. Render generates a cryptographically random 32-byte secret when the blueprint is applied.
3. Open **`laboura-worker`** -> **Environment**. Verify that `CALL_ROUTING_KEY` is linked from `laboura-api`.

#### How to Create the Private Call Recordings Bucket in Supabase Dashboard (No Terminal Required)

All completed call audio recordings are saved to private Supabase Storage:
1. Open your browser and navigate to **[https://supabase.com](https://supabase.com)** and open your project.
2. In the left navigation menu, click the **Storage** icon (bucket icon).
3. Click the green **New bucket** button at the top of the Storage screen.
4. In the dialog:
   - **Name**: Type `recordings`.
   - **Public bucket**: Ensure the toggle is switched **OFF** (Private). Call recordings contain confidential audio and MUST NOT be publicly accessible.
5. Click **Save bucket**.
6. To get your Supabase Storage API keys:
   - In Supabase, click **Project Settings** (gear icon) -> **API**.
   - Copy the **Project URL** (e.g. `https://xxxx.supabase.co`) -> paste as `SUPABASE_URL` in Render.
   - Under **Project API keys**, find `service_role` (click "Reveal") -> copy and paste as `SUPABASE_SERVICE_ROLE_KEY` in Render. Keep this key confidential.

#### Webhook Addresses to Give to Calling and Messaging Companies

When onboarding with your telephony and messaging providers (e.g. Exotel, Tata Tele Business Services, Gupshup, Meta WhatsApp Cloud API), configure the following webhook destination URLs in their dashboards:

| Channel / Event | Webhook URL to Configure in Vendor Dashboard | Signature Header Expected |
| --- | --- | --- |
| **Telephony Call Status & Recordings** | `https://<your-render-api-url>.onrender.com/telephony/webhook/call-status` | `X-Telephony-Signature` or `X-Exotel-Signature` |
| **WhatsApp Message Delivery Status** | `https://<your-render-api-url>.onrender.com/messages/webhook/whatsapp` | `X-Message-Signature` or `X-Hub-Signature-256` |
| **SMS Delivery Status** | `https://<your-render-api-url>.onrender.com/messages/webhook/sms` | `X-Message-Signature` |

In both vendor dashboards, configure the shared secret to match the values you entered for `TELEPHONY_WEBHOOK_SECRET` and `MESSAGE_WEBHOOK_SECRET` in Render.

---

### Step 5: Verify Deployment & Database Schema

1. Go to the **`laboura-api`** service in Render and click the **Events** / **Logs** tab.
2. Click on the latest deployment log.
3. Observe the deployment phases:
   - **Build phase**: `npm install && npm run build` compiles `dist/main.js` and `dist/worker.js`.
   - **Pre-deploy phase**: Render runs `npx prisma migrate deploy`.
     You will see:
     ```text
     Prisma schema loaded from prisma/schema.prisma
     Datasource "db": PostgreSQL database
     Applying migration `...`
     All migrations have been successfully applied.
     ```
   - **Start phase**: Render runs `npm run start:prod` and prints:
     ```text
     Nest application successfully started
     Listening on port ...
     ```
4. Verify the database tables in Supabase:
   - Return to your **Supabase Dashboard** -> click the **Table Editor** icon (table grid icon on left sidebar).
   - Confirm all tables exist: `JobSeeker`, `Business`, `Vacancy`, `Placement`, `Payment`, `Staff`, `AuditLog`, etc.
5. Verify the Web Service health check:
   - In your browser, open:
     ```text
     https://<your-render-api-url>.onrender.com/health
     ```
   - It will display:
     ```json
     {"status":"ok"}
     ```
6. Verify the Background Worker in Render:
   - Click on the **`laboura-worker`** service -> **Logs**.
   - Confirm it started cleanly:
     ```json
     {"level":"INFO","message":"Starting background worker application context...","context":"WorkerBootstrap"}
     {"level":"INFO","message":"Worker application context initialized and running (PROCESS_ROLE=worker)","context":"WorkerBootstrap"}
     ```
   - BullMQ scheduler is registered against Redis.

---

### Step 6: Initial CEO Account Bootstrap & First Login 2FA Enrolment

Once the application is live, no staff accounts exist in the database. Use the bootstrap endpoint to create the CEO account.

#### 1. Locate the Bootstrap Secret in Render
1. Open the **Render Dashboard** (`https://dashboard.render.com`).
2. Click on the **`laboura-api`** service.
3. Click the **Environment** tab on the left sidebar.
4. Locate `STAFF_BOOTSTRAP_SECRET`. Render auto-generates this secret on first blueprint deploy. Click the eye icon next to `STAFF_BOOTSTRAP_SECRET` to reveal and copy it.

#### 2. Execute the Bootstrap Request
You can call the bootstrap endpoint using **curl**, **Postman**, or **[ReqBin](https://reqbin.com)**.

The secret can be passed either as the HTTP header `x-bootstrap-secret` or directly in the JSON request body (`secret` or `bootstrapSecret`):

**Option A: Using curl with HTTP header**
```bash
curl -X POST https://<your-render-api-url>.onrender.com/staff/bootstrap \
  -H "Content-Type: application/json" \
  -H "x-bootstrap-secret: YOUR_COPIED_BOOTSTRAP_SECRET" \
  -d '{
    "name": "Chief Executive Officer",
    "email": "ceo@laboura.in",
    "password": "ReplaceWithSecurePassword123!"
  }'
```

**Option B: Using JSON body in ReqBin / Postman**
- Method: `POST`
- URL: `https://<your-render-api-url>.onrender.com/staff/bootstrap`
- Headers: `Content-Type: application/json`
- Body (JSON):
```json
{
  "name": "Chief Executive Officer",
  "email": "ceo@laboura.in",
  "password": "ReplaceWithSecurePassword123!",
  "secret": "YOUR_COPIED_BOOTSTRAP_SECRET"
}
```

The server responds with `201 Created`:
```json
{
  "staff": {
    "id": "...",
    "code": "CEO-00001",
    "name": "Chief Executive Officer",
    "email": "ceo@laboura.in",
    "role": "ceo",
    "city": "Bengaluru",
    "status": "active"
  }
}
```

> [!NOTE]
> **2FA Enrolment on First Login**: For defense-in-depth, bootstrap does **not** return a TOTP secret in the HTTP response. The account is created with `totpEnabled: false`. The new CEO enrols 2FA on their very first login.

#### 3. Complete 2FA Enrolment on First Login
1. Open the Admin Dashboard in your browser:
   ```text
   https://<your-render-api-url>.onrender.com/admin
   ```
2. Log in with the **staff code** from the bootstrap response (for example `CEO-00001`) and the password you chose. The email address is not a way to log in. Leave the authenticator box empty on this first attempt.
3. The page asks you to enrol an authenticator app and shows a secret key. Type that key into Google Authenticator, Microsoft Authenticator, or Authy.
4. Type the 6-digit code from the app and click **Verify & Enable 2FA**.
5. Log in again with the same staff code, the same password, and a fresh 6-digit code from the app. That login approves this browser as the CEO's device. The CEO does not ask a Team Lead for a login code. A Manager and Finance use this same authenticator step. A Team Lead, call agent, or field agent instead waits on the page that says "Ask your Team Lead for your code" until someone reveals a code on the Login codes screen.

#### 4. Add the office network range once the office opens

Until you do this, nobody is treated as being on the office network, and no staff member is limited to it. Leave it that way until the office actually has an internet connection you want to allow.

When the office opens, a CEO or a Manager adds the range from the browser. You need the range from the person who set up the office internet. It looks like `203.0.113.0/24` (IPv4) or an IPv6 range. Do not guess it.

1. Log in to the Admin Dashboard as the CEO or a Manager.
2. Open the browser's page menu and choose **Inspect** (or press F12). Open **Application** in Chrome, or **Storage** in Firefox. Under **Session storage**, click the Laboura site and copy the value named `laboura_token`. Close Inspect. That value is your login token. It lasts about 15 minutes. If a later step says unauthorized, log in again and copy it again.
3. Open **[https://reqbin.com](https://reqbin.com)** in the browser.
4. Method: `POST`. URL: `https://<your-render-api-url>.onrender.com/office-networks`.
5. Header: `Authorization` with the value `Bearer ` followed by the token you copied. Header: `Content-Type` with the value `application/json`.
6. Body:
   ```json
   { "label": "Bengaluru office", "cidr": "203.0.113.0/24" }
   ```
   Replace the example range with the real one. Send it. A successful reply means the range is saved.
7. For each person who may log in only from the office, send another request. Method: `POST`. URL: `https://<your-render-api-url>.onrender.com/staff/<their staff id>/works-from-office`. Same headers. Body: `{ "worksFromOffice": true }`. Their staff id is the long id on their staff row, not the staff code. Until this is set, that person can still log in from outside the office.

---

### Step 7: Create a Second CEO Account on a Different Device (Mandatory Immediate Redundancy)

As the immediate next action after the first CEO enrols 2FA:

1. Log into the Admin Dashboard (`https://<your-render-api-url>.onrender.com/admin`) with the primary CEO account.
2. In the Staff Management section, invite a **second CEO account** (e.g. `ceo2@laboura.in` or a dedicated recovery executive address).
3. From a **different physical device** (a secondary executive smartphone, tablet, or separate hardware authenticator), open the invitation link.
4. Set the password and complete the 2FA QR code scan on that separate device's authenticator app.
5. Verify successful login using the secondary credentials.

> [!IMPORTANT]
> **Why this step is mandatory:** If only one CEO account exists and that phone is lost, damaged, or wiped before another account is provisioned, administrative access cannot be recovered through the software. Having a second CEO enrolled on an independent device eliminates this single point of failure.

---

### Step 8: Last-Resort Emergency Manual Recovery (Agastya Only)

If all CEO credentials and 2FA devices are lost simultaneously:

- **Authorization:** Performed by **Agastya only**.
- **Audit Requirement:** Must be documented and audit-logged afterwards.
- **Procedure via Supabase Dashboard:**
  1. Open the **Supabase Dashboard** (`https://supabase.com`) and navigate to `laboura-production`.
  2. Click the **SQL Editor** on the left menu.
  3. Execute the following SQL query to reset the 2FA state of the targeted CEO account:
     ```sql
     UPDATE "Staff"
     SET "status" = 'active',
         "totpSecret" = NULL,
         "totpEnabled" = false
     WHERE "email" = 'ceo@laboura.in';
     ```
  4. Revoke any existing active sessions:
     ```sql
     DELETE FROM "StaffSession"
     WHERE "staffId" IN (SELECT "id" FROM "Staff" WHERE "email" = 'ceo@laboura.in');
     ```
  5. The CEO can now log in at `/admin` using their password. The system will detect `totpEnabled: false` and immediately guide them through the first-login TOTP 2FA enrolment flow to link their new authenticator device.
  6. Log the recovery action and reason in the operational incident log.

---

### Troubleshooting & Rollbacks

- **Database Connection Error (`P1001`)**:
  Verify the `DATABASE_URL` in the Render Environment tab. Ensure the password does not contain unescaped special characters (e.g. use `%23` for `#` if required in URI encoding).
- **Redis Connection Warning**:
  Confirm that `REDIS_TLS` is set to `true` when using Upstash. Upstash rejects non-TLS connections on port `6379`.
- **Pre-Deploy Migration Failure**:
  If a migration fails, Render halts deployment before switching web traffic. Check the deploy log in Render to view the specific Prisma migration error.
