#!/bin/bash
# Linkwarden backup script
#
# Creates a backup of the SQLite database using the online backup API
# (safe even while the server is running).
#
# Usage: ./backup.sh [data_dir] [backup_dir]
#   data_dir:   default: /opt/linkwarden/data
#   backup_dir: default: /opt/linkwarden/data/backups

set -euo pipefail

DATA_DIR="${1:-${LW_DATA_DIR:-/opt/linkwarden/data}}"
BACKUP_DIR="${2:-${DATA_DIR}/backups}"
DB_PATH="${DATA_DIR}/linkwarden.sqlite3"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/linkwarden_${TIMESTAMP}.sqlite3"

mkdir -p "${BACKUP_DIR}"

if [ ! -f "${DB_PATH}" ]; then
    echo "Error: database not found at ${DB_PATH}" >&2
    exit 1
fi

echo "Backing up ${DB_PATH} to ${BACKUP_FILE}..."

# Use sqlite3 .backup command (safe online backup)
if command -v sqlite3 &>/dev/null; then
    sqlite3 "${DB_PATH}" ".backup '${BACKUP_FILE}'"
else
    # Fallback: copy with WAL checkpoint
    cp "${DB_PATH}" "${BACKUP_FILE}"
    cp "${DB_PATH}-wal" "${BACKUP_FILE}-wal" 2>/dev/null || true
    cp "${DB_PATH}-shm" "${BACKUP_FILE}-shm" 2>/dev/null || true
fi

# Compress
gzip -f "${BACKUP_FILE}"
echo "Backup created: ${BACKUP_FILE}.gz"

# Retention: keep last 30 backups
ls -t "${BACKUP_DIR}"/linkwarden_*.sqlite3.gz 2>/dev/null | tail -n +31 | xargs rm -f 2>/dev/null || true
echo "Retention: keeping last 30 backups"

echo "Done."
