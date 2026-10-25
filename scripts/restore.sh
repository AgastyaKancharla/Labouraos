#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Laboura Database Restore Script
# Restores a compressed SQL dump into a target database (default: scratch DB).
# ==============================================================================

if [ $# -lt 1 ]; then
  echo "Usage: $0 <backup_file.sql.gz> [target_database_name]" >&2
  exit 1
fi

BACKUP_FILE="$1"
TARGET_DB="${2:-laboura_scratch_restore}"
DB_USER="${DB_USER:-postgres}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"

if [ ! -f "${BACKUP_FILE}" ]; then
  echo "Error: Backup file '${BACKUP_FILE}' not found." >&2
  exit 1
fi

echo "=== [Laboura Restore] Starting restore into '${TARGET_DB}' ==="
START_TIME=$(date +%s)

# Verify checksum if .sha256 file exists
CHECKSUM_FILE="${BACKUP_FILE}.sha256"
if [ -f "${CHECKSUM_FILE}" ]; then
  EXPECTED_CHECKSUM=$(cat "${CHECKSUM_FILE}")
  ACTUAL_CHECKSUM=$(sha256sum "${BACKUP_FILE}" | awk '{print $1}')
  if [ "${EXPECTED_CHECKSUM}" != "${ACTUAL_CHECKSUM}" ]; then
    echo "Error: SHA-256 checksum mismatch! Expected: ${EXPECTED_CHECKSUM}, Got: ${ACTUAL_CHECKSUM}" >&2
    exit 2
  fi
  echo "Checksum verified: ${ACTUAL_CHECKSUM}"
fi

# Execute restore via docker container or host psql
if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -q "^laboura-postgres$"; then
  echo "Ensuring target database '${TARGET_DB}' exists in docker..."
  docker exec -i laboura-postgres psql -U "${DB_USER}" -c "CREATE DATABASE ${TARGET_DB};" 2>/dev/null || true
  
  echo "Streaming backup into target database..."
  gzip -dc "${BACKUP_FILE}" | docker exec -i laboura-postgres psql -U "${DB_USER}" -d "${TARGET_DB}" -q
elif command -v psql >/dev/null 2>&1; then
  echo "Ensuring target database '${TARGET_DB}' exists on host..."
  PGPASSWORD="${DB_PASSWORD:-postgres}" psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -c "CREATE DATABASE ${TARGET_DB};" 2>/dev/null || true

  echo "Streaming backup into target database..."
  gzip -dc "${BACKUP_FILE}" | PGPASSWORD="${DB_PASSWORD:-postgres}" psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${TARGET_DB}" -q
else
  echo "Error: neither docker container 'laboura-postgres' nor host psql found." >&2
  exit 1
fi

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo "=== [Laboura Restore] SUCCESS ==="
echo "Target DB : ${TARGET_DB}"
echo "Duration  : ${DURATION}s"
echo "================================="
