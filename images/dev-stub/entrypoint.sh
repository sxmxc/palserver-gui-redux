#!/bin/sh
set -eu

echo "[palserver] (dev-stub) installing/updating Palworld dedicated server..."
sleep 2
if [ -f /data/config/PalWorldSettings.ini ]; then
  echo "[palserver] (dev-stub) applied PalWorldSettings.ini from agent:"
  cat /data/config/PalWorldSettings.ini
fi
mkdir -p /data/saved/SaveGames/0/DEVSTUB0000000000000000000000000
echo "[palserver] (dev-stub) starting PalServer..."
echo "Shutdown handler: initialize."
echo "[$(date '+%Y.%m.%d-%H.%M.%S')] Running Palworld dedicated server (dev-stub)"

tick=0
while true; do
  sleep 30
  tick=$((tick + 1))
  echo "[$(date '+%Y.%m.%d-%H.%M.%S')] [dev-stub] heartbeat #$tick — players online: 0"
done
