#!/usr/bin/env bash
# scripts/start-local.sh — Build and run kim-agent in the background locally
set -euo pipefail

cd "$(dirname "$0")/.."

echo "🔨 Building with esbuild..."
npm run build

echo "🛑 Stopping any existing instances..."
pkill -f "node.*dist/bundle.mjs" 2>/dev/null || true
sleep 1

mkdir -p logs data/db data/media data/backups

echo "🚀 Starting kim-agent in background..."
nohup node dist/bundle.mjs >> logs/app.log 2>&1 &
PID=$!
echo "✅ Started with PID: $PID"

echo "⏳ Waiting for health check..."
for i in {1..10}; do
  if curl -sf http://localhost:4000/api/health >/dev/null 2>&1; then
    echo "🎉 kim-agent is UP and healthy!"
    curl -s http://localhost:4000/api/health
    echo ""
    exit 0
  fi
  sleep 1
done

echo "⚠️  Server took longer than 10s to respond, check logs/app.log"
tail -n 20 logs/app.log
