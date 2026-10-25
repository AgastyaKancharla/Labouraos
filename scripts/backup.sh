#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Laboura Database Backup Script
# Generates a compressed, checksummed SQL dump of the PostgreSQL database.
# ==============================================================================

BACKUP_DIR="${BACKUP_DIR:-./backups}"
# DB_NAME wins; otherwise take the database from DATABASE_URL (so CI's
# laboura_test is backed up, not a hardcoded dev name); finally laboura_dev.
if [ -z "${DB_NAME:-}" ] && [ -n "${DATABASE_URL:-}" ]; then
  DB_NAME="${DATABASE_URL##*/}"
  DB_NAME="${DB_NAME%%\?*}"
fi
DB_NAME="${DB_NAME:-laboura_dev}"
DB_USER="${DB_USER:-postgres}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"

TIMESTAMP=$(date -u +"%Y%m%d_%H%M%SZ")
mkdir -p "${BACKUP_DIR}"
OUTPUT_FILE="${BACKUP_DIR}/laboura_${DB_NAME}_${TIMESTAMP}.sql.gz"
CHECKSUM_FILE="${OUTPUT_FILE}.sha256"

echo "=== [Laboura Backup] Starting database dump for '${DB_NAME}' at ${TIMESTAMP} ==="

START_TIME=$(date +%s)

# Perform dump via docker container if running, or via native pg_dump
if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -q "^laboura-postgres$"; then
  echo "Using docker container 'laboura-postgres' for pg_dump..."
  docker exec laboura-postgres pg_dump -U "${DB_USER}" -d "${DB_NAME}" --clean --if-exists --no-owner --no-privileges | gzip -9 > "${OUTPUT_FILE}"
elif command -v pg_dump >/dev/null 2>&1; then
  echo "Using host pg_dump..."
  PGPASSWORD="${DB_PASSWORD:-postgres}" pg_dump -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" --clean --if-exists --no-owner --no-privileges | gzip -9 > "${OUTPUT_FILE}"
else
  echo "Error: neither docker container 'laboura-postgres' nor host pg_dump found." >&2
  exit 1
fi

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

# Compute SHA-256 checksum
sha256sum "${OUTPUT_FILE}" | awk '{print $1}' > "${CHECKSUM_FILE}"
CHECKSUM=$(cat "${CHECKSUM_FILE}")
FILE_SIZE=$(ls -lh "${OUTPUT_FILE}" | awk '{print $5}')

echo "=== [Laboura Backup] SUCCESS ==="
echo "Backup File : ${OUTPUT_FILE}"
echo "File Size   : ${FILE_SIZE}"
echo "SHA-256     : ${CHECKSUM}"
echo "Duration    : ${DURATION}s"
echo "================================"
