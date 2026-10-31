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
6. Create Initial CEO Account (Bootstrap)

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
| `STAFF_BOOTSTRAP_SECRET` | *Auto-generated or random secret* | Secret required for initial CEO account creation |
| `OTP_PROVIDER_MODE` | `mock` | Default mock mode (§3) until SMS gateway is active |
| `PAYMENT_PROVIDER_MODE` | `mock` | Default mock mode (§3) until Razorpay keys are active |
| `WHATSAPP_PROVIDER_MODE` | `mock` | Default mock mode (§3) until WhatsApp API is active |
| `TELEPHONY_PROVIDER_MODE` | `mock` | Default mock mode (§3) until telephony vendor is active |
| `KYC_PROVIDER_MODE` | `mock` | Default mock mode (§3) until SurePass keys are active |

4. Click **Save Changes** at the bottom of the Environment page.
5. In the Render Dashboard, navigate to the **`laboura-worker`** service.
6. In `laboura-worker`, the environment variables (`DATABASE_URL`, `REDIS_*`, `JWT_SECRET`) are automatically linked from `laboura-api` by the blueprint (`fromService`). Confirm that `PROCESS_ROLE` shows `worker`.

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

### Step 6: Initial CEO Account Bootstrap (One-Time Setup)

Once the application is live, no staff accounts exist in the database. Use the bootstrap endpoint to create the CEO account.

You can perform this directly from your browser using an online API tool like **[ReqBin](https://reqbin.com)** or **Postman**:

1. Set request method to: `POST`
2. Set URL to: `https://<your-render-api-url>.onrender.com/staff/bootstrap`
3. Add Headers:
   - `Content-Type`: `application/json`
   - `x-bootstrap-secret`: *(The `STAFF_BOOTSTRAP_SECRET` you set in Render in Step 4)*
4. Set Request Body (JSON):
   ```json
   {
     "name": "Chief Executive Officer",
     "email": "ceo@laboura.in",
     "password": "ReplaceWithSecurePassword123!",
     "city": "Bengaluru"
   }
   ```
5. Click **Send**.
6. The server will respond with `201 Created` and output the created staff profile:
   ```json
   {
     "id": "...",
     "code": "STF-CE-00001",
     "name": "Chief Executive Officer",
     "email": "ceo@laboura.in",
     "role": "ceo"
   }
   ```
7. Now open the internal management console in your browser:
   ```text
   https://<your-render-api-url>.onrender.com/console/admin
   ```
8. Log in with your email and password. Follow the on-screen instructions to scan the QR code with Google Authenticator or Microsoft Authenticator to enable two-factor authentication (TOTP).

---

### Troubleshooting & Rollbacks

- **Database Connection Error (`P1001`)**:
  Verify the `DATABASE_URL` in the Render Environment tab. Ensure the password does not contain unescaped special characters (e.g. use `%23` for `#` if required in URI encoding).
- **Redis Connection Warning**:
  Confirm that `REDIS_TLS` is set to `true` when using Upstash. Upstash rejects non-TLS connections on port `6379`.
- **Pre-Deploy Migration Failure**:
  If a migration fails, Render halts deployment before switching web traffic. Check the deploy log in Render to view the specific Prisma migration error.
