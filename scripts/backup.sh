#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Laboura Database Backup Script
# Writes an ENCRYPTED, compressed, checksummed SQL dump of the PostgreSQL database.
#
# Required in the environment (INF-11; there are no defaults):
#   BACKUP_ENCRYPTION_KEY  at least 32 characters. The dump is encrypted with
#                          AES-256 (openssl enc -aes-256-cbc -pbkdf2, 200000
#                          rounds) before it touches the disk. Keep the key in a
#                          password manager, never next to the backups: without
#                          it a backup cannot be restored.
#   DB_PASSWORD            the database password (host pg_dump only; the local
#                          docker container 'laboura-postgres' needs none).
# The backups folder (./backups by default) is in .gitignore.
# ==============================================================================

if [ -z "${BACKUP_ENCRYPTION_KEY:-}" ] || [ "${#BACKUP_ENCRYPTION_KEY}" -lt 32 ]; then
  echo "Error: set BACKUP_ENCRYPTION_KEY (at least 32 characters) in the environment. Backups are always encrypted." >&2
  exit 3
fi
if ! command -v openssl >/dev/null 2>&1; then
  echo "Error: openssl is needed to encrypt the backup." >&2
  exit 3
fi

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
umask 077
mkdir -p "${BACKUP_DIR}"
OUTPUT_FILE="${BACKUP_DIR}/laboura_${DB_NAME}_${TIMESTAMP}.sql.gz.enc"
CHECKSUM_FILE="${OUTPUT_FILE}.sha256"
# A failed dump leaves no half-written file behind.
trap 'rm -f "${OUTPUT_FILE}" "${CHECKSUM_FILE}"' ERR

# AES-256 with a key from the environment (never on the command line, so `ps` cannot show it).
encrypt() {
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_ENCRYPTION_KEY
}

echo "=== [Laboura Backup] Starting database dump for '${DB_NAME}' at ${TIMESTAMP} ==="

START_TIME=$(date +%s)

# Perform dump via docker container if running, or via native pg_dump
if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -q "^laboura-postgres$"; then
  echo "Using docker container 'laboura-postgres' for pg_dump..."
  docker exec laboura-postgres pg_dump -U "${DB_USER}" -d "${DB_NAME}" --clean --if-exists --no-owner --no-privileges | gzip -9 | encrypt > "${OUTPUT_FILE}"
elif command -v pg_dump >/dev/null 2>&1; then
  if [ -z "${DB_PASSWORD:-}" ]; then
    echo "Error: set DB_PASSWORD in the environment (there is no default password)." >&2
    rm -f "${OUTPUT_FILE}"
    exit 3
  fi
  echo "Using host pg_dump..."
  PGPASSWORD="${DB_PASSWORD}" pg_dump -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" --clean --if-exists --no-owner --no-privileges | gzip -9 | encrypt > "${OUTPUT_FILE}"
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
echo "Encrypted   : AES-256 (BACKUP_ENCRYPTION_KEY)"
echo "File Size   : ${FILE_SIZE}"
echo "SHA-256     : ${CHECKSUM}"
echo "Duration    : ${DURATION}s"
echo "================================"
