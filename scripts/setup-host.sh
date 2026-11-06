#!/usr/bin/env bash
# ================================================================
# scripts/setup-host.sh
# VPS Host Provisioner — Run once on fresh InstaBox VPS
# ================================================================
set -euo pipefail

log() { echo "[SETUP] $*"; }

log "=== KIM-AGENT Host Setup ==="

# 1. Update & install dependencies
log "Installing system dependencies..."
apt-get update -qq
apt-get install -y -qq \
  curl git sqlite3 \
  ca-certificates gnupg lsb-release

# 2. Install Docker
if ! command -v docker &>/dev/null; then
  log "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  log "✅ Docker installed"
else
  log "✅ Docker already installed"
fi

# 3. Create application directory
APP_DIR="/opt/kim-agent"
mkdir -p "$APP_DIR"
log "✅ App directory: $APP_DIR"

# 4. Create log directory
mkdir -p /var/log/kim
log "✅ Log directory created"

# 5. Set permissions for sandbox
mkdir -p /tmp/kim-sandbox
chmod 1777 /tmp/kim-sandbox
log "✅ Sandbox temp dir ready"

# 6. Install cron job for resilience check
CRON_JOB="*/5 * * * * /opt/kim-agent/scripts/instabox-resilience.sh >> /var/log/kim/resilience.log 2>&1"
(crontab -l 2>/dev/null | grep -qF "instabox-resilience" || (crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -)
log "✅ Resilience cron installed"

log "=== Host Setup Complete! ==="
log "Next: cd $APP_DIR && cp .env.example .env && nano .env && docker compose up -d"
