# Laboura backups and disaster recovery

Written for someone without a terminal: every step is in the Supabase or Render dashboard. `DEPLOY.md` explains how the system is set up.

## 1. What is backed up, and where

| What | Where it lives | Backed up by | Kept for |
| --- | --- | --- | --- |
| All records (staff, job seekers, businesses, payments, audit log) | Supabase Postgres, Singapore | Supabase daily backups (**Pro** plan) | 7 days |
| Uploaded files (selfies, shop photos, signed agreements, call recordings) | Supabase Storage, four private buckets | **Not** included in database backups (see section 5) | — |
| Job queue | Render Key Value | Nothing needed: it holds only waiting jobs. On start, the worker re-registers every scheduled job | — |
| The application | GitHub (`Labouraos`) | GitHub; Render rebuilds from it | — |
| Settings and secrets | Render, `laboura-api` → Environment | **You** (see section 4) | — |

- Supabase takes one backup a day on the Pro plan and keeps the last 7. The Free plan has no usable backups, so the project must be on Pro before real data goes in.
- Point-in-time recovery (restore to any minute) is a paid Supabase add-on. Without it, a restore goes back to the last daily backup and anything entered after it is lost.
- `scripts/backup.sh` and `scripts/restore.sh` work on a local development database only (the automated test `src/jobs/backup-restore.spec.ts` uses them). They are not the production backup.

## 2. Test one restore (every three months, and once before real data)

This never touches the live database.

1. Supabase → project `laboura-production` → **Database** → **Backups**.
2. Open the **Restore to a New Project** tab. Choose the newest daily backup and click **Restore**. Supabase shows the cost first; the new project is charged only while it exists.
3. Wait until the new project is ready (minutes for a small database).
4. In the new project, open **SQL Editor**, paste and **Run**:
   ```sql
   SELECT 'Staff' AS tbl, count(*) FROM "Staff" UNION ALL
   SELECT 'JobSeeker', count(*) FROM "JobSeeker" UNION ALL
   SELECT 'Business', count(*) FROM "Business" UNION ALL
   SELECT 'Placement', count(*) FROM "Placement" UNION ALL
   SELECT 'Payment', count(*) FROM "Payment";
   ```
5. Run the same in the live project. The counts should match, or the live ones be slightly higher (work done since the backup).
6. Record the result in section 6 below.
7. Delete the scratch project: **Project Settings** → **General** → **Delete project**.

Not copied into a restored project: Storage files and bucket settings, API keys, Auth settings and extensions. That does not matter for a test.

## 3. A real disaster: the live database is damaged or data was deleted

Stop and think before clicking. A restore goes back to the last daily backup; work entered after it has to be re-entered.

**Preferred: restore to a new project, then switch Render to it.** The damaged database stays untouched in case something must be copied out of it.

1. Tell the team to stop entering data.
2. Supabase → `laboura-production` → **Database** → **Backups** → **Restore to a New Project** → pick the last backup made **before** the damage → **Restore**.
3. In the new project: create the four private buckets again (`candidate-photos`, `business-photos`, `agreements`, `recordings`, all with **Public bucket** off), turn off the Data API (**Integrations** → **Data API**), and copy the new **Project URL** and **service_role** key (DEPLOY.md Steps 3 and 4).
4. Copy the new project's two database addresses (DEPLOY.md Step 2: transaction pooler for `DATABASE_URL`, session pooler for `DIRECT_URL`).
5. Render → `laboura-api` → **Environment**: replace `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` with the new values. **Save Changes**. Render restarts the web service, and the worker picks up the new values from `laboura-api`; if it does not restart by itself, open `laboura-worker` and click **Manual Deploy** → **Deploy latest commit**.
6. Check `/health/ready` shows `"status":"ready"` and the worker as alive, and log in to `/admin`.
7. Uploaded files stayed in the old project's buckets. Until they are copied over (ask Claude to do it with the Supabase tools), photos, agreements and recordings uploaded before the switch will not open.

**Faster, but destructive: restore over the live project.** Supabase → **Database** → **Backups** → choose a backup → **Restore**. The live database is replaced, the project is offline while it runs, and everything after that backup is lost. Use this only when the live data is worthless and speed matters.

## 4. Secrets that must be kept outside Render

Two of the secrets Render generated encrypt data stored in the database. If they are lost, that data can never be read again, even from a backup:

- `CALL_ROUTING_KEY`: staff phone numbers used to route calls.
- `PAYOUT_ACCOUNT_KEY`: payout UPI and bank details for candidates, referral partners and businesses.

After the first deploy, open Render → `laboura-api` → **Environment**, reveal both, and store them in the company password manager. Store `LOGIN_CODE_SECRET` and `JWT_SECRET` there too; losing those only logs everyone out.

## 5. Uploaded files are not in the database backups

Supabase database backups hold only the file list, not the files. A deleted file cannot be brought back by a database restore. Today the only copy of each selfie, shop photo, signed agreement and call recording is in Supabase Storage. Before real data, decide whether to accept this or to add a scheduled copy of the four buckets to a second storage service (ask Claude to set it up).

## 6. Exercise record

| Date | What was restored | Into | Time | Counts (Staff / JobSeeker / Business / Placement / Payment) | Result |
| --- | --- | --- | --- | --- | --- |
| 2026-10-25 | Local development dump `laboura_laboura_dev_20261025_163224Z.sql.gz` (292 KB) with `scripts/restore.sh` | Local scratch database `laboura_scratch_restore` | 3 s backup, 8 s restore | 1075 / 26 / 643 / 7 / 524, all matched | PASS (development data only; not a production restore) |
| _to do_ | Newest Supabase daily backup | Supabase "Restore to a New Project" | | | Required before real data (DEPLOY.md Step 10) |
