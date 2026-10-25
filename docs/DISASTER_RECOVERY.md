# Laboura Database Backup & Disaster Recovery Runbook

## 1. Backup Architecture & Schedule

- **Platform Managed Backups (Render Managed PostgreSQL):**
  - **WAL Archiving**: Continuous Write-Ahead Log (WAL) archiving enabling Point-In-Time Recovery (PITR) up to 7-30 days.
  - **Automated Snapshots**: Daily automated full cluster snapshots taken during off-peak hours (02:00 IST / 20:30 UTC).
- **Logical SQL Archive (Automated Offsite Script):**
  - Script: `./scripts/backup.sh`
  - Mechanism: Generates a compressed, checksummed PostgreSQL SQL dump (`.sql.gz`) with SHA-256 integrity verification (`.sha256`).
  - Flags: `--clean --if-exists --no-owner --no-privileges` to ensure portability across different host environments.

---

## 2. Recovery Procedure (Step-by-Step)

### Prerequisites:
- Target PostgreSQL host URL or container access with `psql`.
- The desired backup archive (`.sql.gz`) and its companion `.sha256` checksum.

### Step 1: Verify Backup Archive Integrity
```bash
sha256sum -c backups/laboura_laboura_dev_<TIMESTAMP>.sql.gz.sha256
```
Confirm the output indicates `OK`.

### Step 2: Execute Restore Script
```bash
./scripts/restore.sh backups/laboura_laboura_dev_<TIMESTAMP>.sql.gz <TARGET_DB_NAME>
```

### Step 3: Run Database Sanity Verification
Verify table count parity against expectations:
```bash
docker exec -i laboura-postgres psql -U postgres -d <TARGET_DB_NAME> -c \
  "SELECT 'Staff' as tbl, count(*) FROM \"Staff\" UNION ALL \
   SELECT 'JobSeeker', count(*) FROM \"JobSeeker\" UNION ALL \
   SELECT 'Business', count(*) FROM \"Business\" UNION ALL \
   SELECT 'Placement', count(*) FROM \"Placement\" UNION ALL \
   SELECT 'Payment', count(*) FROM \"Payment\";"
```

---

## 3. Disaster Recovery Exercise Record

- **Date Exercised:** 2026-10-25
- **Backup File:** `laboura_laboura_dev_20261025_163224Z.sql.gz` (Size: 292 KB, SHA-256: `c4d42e8af994d92d04cb11fdc21a0d7ea2d723b24db95267e5a4269cb30833a5`)
- **Target Scratch Database:** `laboura_scratch_restore`
- **Execution Time:**
  - Backup generation: **3 seconds**
  - Full restore: **8 seconds**
- **Manual Steps Required:** None; automated via `./scripts/restore.sh`.
- **Restored Entity Invariant Verification:**
  - `Staff`: 1075 / 1075 (100% matched)
  - `JobSeeker`: 26 / 26 (100% matched)
  - `Business`: 643 / 643 (100% matched)
  - `Placement`: 7 / 7 (100% matched)
  - `Payment`: 524 / 524 (100% matched)
- **Status:** PASS (verified by automated test suite `src/jobs/backup-restore.spec.ts`).
