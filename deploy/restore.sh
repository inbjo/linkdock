#!/bin/bash
# Linkdock restore script
#
# Restores a backup file to the data directory.
# The server must be stopped before running this.
#
# Usage: ./restore.sh <backup_file> [data_dir]
#   backup_file: path to .sqlite3 or .sqlite3.gz backup
#   data_dir:    default: /opt/linkdock/data

set -euo pipefail

BACKUP_FILE="${1:?Usage: restore.sh <backup_file> [data_dir]}"
DATA_DIR="${2:-${DOCK_DATA_DIR:-/opt/linkdock/data}}"
DB_PATH="${DATA_DIR}/linkdock.sqlite3"

if [ ! -f "${BACKUP_FILE}" ]; then
    echo "Error: backup file not found: ${BACKUP_FILE}" >&2
    exit 1
fi

mkdir -p "${DATA_DIR}"

# Decompress if gzipped
if [[ "${BACKUP_FILE}" == *.gz ]]; then
    echo "Decompressing ${BACKUP_FILE}..."
    gunzip -c "${BACKUP_FILE}" > "${DB_PATH}.tmp"
else
    cp "${BACKUP_FILE}" "${DB_PATH}.tmp"
fi

# Move into place
mv "${DB_PATH}.tmp" "${DB_PATH}"
# Remove old WAL/SHM (will be recreated on next open)
rm -f "${DB_PATH}-wal" "${DB_PATH}-shm"

echo "Restored to ${DB_PATH}"
echo "Start the server to apply migrations if needed."
