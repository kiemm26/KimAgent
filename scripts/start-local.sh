#!/usr/bin/env bash
# scripts/start-local.sh — Build and run kim-agent in the background locally
set -euo pipefail

cd "$(dirname "$0")/.."

echo "🔨 Building with esbuild..."
npm run build

echo "🛑 Stopping any existing instances..."
pkill -f "node.*dist/bundle.mjs" 2>/dev/null || true
pkill -f "uvicorn.*runner.main:app" 2>/dev/null || true
sleep 1

mkdir -p logs data/db data/media data/backups /tmp/sandbox

# Start Python Runner if python3 is available
if command -v python3 >/dev/null 2>&1; then
  echo "🐍 Starting python-runner locally on port 8000..."
  export RUNNER_SECRET="${PYTHON_RUNNER_SECRET:-kim_secret_runner_key}"
  nohup python3 -m uvicorn runner.main:app --host 0.0.0.0 --port 8000 >> logs/runner.log 2>&1 &
fi

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
