#!/usr/bin/env bash
# ================================================================
# scripts/instabox-resilience.sh
# InstaBox VPS Auto-Restart & Health Recovery Script
# Run this via cron every 5 minutes on the VPS host
# ================================================================
set -euo pipefail

LOG_FILE="/var/log/kim-resilience.log"
COMPOSE_DIR="/opt/kim-agent"
HEALTH_URL="http://localhost:4000/api/health"
WAHA_HEALTH_URL="http://localhost:3000/api/health"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

check_service() {
  local url="$1"
  local name="$2"
  if curl -sf "$url" > /dev/null 2>&1; then
    log "✅ $name is healthy"
    return 0
  else
    log "⚠️  $name is NOT responding"
    return 1
  fi
}

restart_stack() {
  log "🔄 Restarting Docker Compose stack..."
  cd "$COMPOSE_DIR"
  docker compose down --timeout 10 || true
  sleep 3
  docker compose up -d
  log "✅ Stack restarted"
}

checkpoint_wal() {
  local db_path="$COMPOSE_DIR/data/db/kim.db"
  if [ -f "$db_path" ]; then
    log "🗄️  Running WAL checkpoint..."
    sqlite3 "$db_path" "PRAGMA wal_checkpoint(TRUNCATE);" || log "⚠️  WAL checkpoint failed"
  fi
}

main() {
  log "=== InstaBox Resilience Check ==="

  kim_ok=true
  waha_ok=true

  check_service "$HEALTH_URL" "kim-core" || kim_ok=false
  check_service "$WAHA_HEALTH_URL" "waha" || waha_ok=false

  if [ "$kim_ok" = false ] || [ "$waha_ok" = false ]; then
    log "🚨 Service(s) down — initiating recovery"
    checkpoint_wal
    restart_stack
  else
    log "✅ All services healthy — no action needed"
  fi
}

main "$@"
