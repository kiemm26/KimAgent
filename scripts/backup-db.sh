#!/usr/bin/env bash
# ================================================================
# scripts/backup-db.sh
# SQLite WAL-safe Database Backup Script
# ================================================================
set -euo pipefail

DB_PATH="${DB_PATH:-/app/data/db/kim.db}"
BACKUP_DIR="${BACKUP_DIR:-/app/data/backups}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/kim_backup_$TIMESTAMP.db"
MAX_BACKUPS=7

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] BACKUP: $*"
}

main() {
  log "Starting database backup..."

  if [ ! -f "$DB_PATH" ]; then
    log "ERROR: Database not found at $DB_PATH"
    exit 1
  fi

  mkdir -p "$BACKUP_DIR"

  # Use SQLite VACUUM INTO for a clean, WAL-safe backup
  sqlite3 "$DB_PATH" "VACUUM INTO '$BACKUP_FILE';"
  log "✅ Backup created: $BACKUP_FILE ($(du -sh "$BACKUP_FILE" | cut -f1))"

  # Rotate: keep only MAX_BACKUPS most recent
  BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/kim_backup_*.db 2>/dev/null | wc -l)
  if [ "$BACKUP_COUNT" -gt "$MAX_BACKUPS" ]; then
    EXCESS=$((BACKUP_COUNT - MAX_BACKUPS))
    ls -1t "$BACKUP_DIR"/kim_backup_*.db | tail -n "$EXCESS" | xargs rm -f
    log "🗑️  Rotated $EXCESS old backup(s)"
  fi

  log "Backup complete. Total: $(ls -1 "$BACKUP_DIR"/kim_backup_*.db 2>/dev/null | wc -l) backups"
}

main "$@"
