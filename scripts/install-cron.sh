#!/usr/bin/env bash
set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_BIN="$(which node)"

if [ -z "$NODE_BIN" ]; then
  echo "Error: node not found in PATH"
  exit 1
fi

CRON_CMD="*/30 * * * * cd \"$REPO_DIR\" && $NODE_BIN src/scheduler.js >> workdir/cron.log 2>&1"

# Check if already installed
if crontab -l 2>/dev/null | grep -q "garbage-time"; then
  echo "Garbage Time cron job already installed:"
  crontab -l | grep "garbage-time\|scheduler.js"
  echo ""
  echo "To reinstall, remove it first: crontab -e"
  exit 0
fi

# Add to crontab
(crontab -l 2>/dev/null; echo ""; echo "# Garbage Time agent shift runner"; echo "$CRON_CMD") | crontab -

echo "Cron job installed:"
echo "  $CRON_CMD"
echo ""
echo "Fires every 30 minutes. The agent decides its own wake time within that."
echo "Logs: $REPO_DIR/workdir/cron.log"
echo ""
echo "To remove: crontab -e and delete the garbage-time lines"
