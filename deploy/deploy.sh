#!/usr/bin/env bash
# MiniRouter Docker deploy script
#
# Builds the image locally, copies it + source to the server, and
# reconstructs the container with the same env / ports / mounts.
#
# Usage: ./deploy/deploy.sh <server-ip> [ssh-port]
#   or just run on the server: ./deploy/deploy.sh
set -euo pipefail

do_ssh() {
  local dest="${1?}"
  shift
  ssh -p "${SSH_PORT}" "${dest}" "$@"
}

# ── Detect local vs remote mode ─────────────────────────────────
if [ $# -ge 1 ]; then
  SERVER_IP="${1}"
  SSH_PORT="${2:-22}"
  SSH_DEST="root@${SERVER_IP}"
  REMOTE=true
else
  REMOTE=false
fi

if $REMOTE; then
  echo "=========================================="
  echo " MiniRouter Deploy"
  echo " Target: ${SERVER_IP}:${SSH_PORT}"
  echo "=========================================="

  # 1. Build image locally
  echo "[1/3] Building Docker image..."
  docker build --build-arg USE_CHINA_MIRROR=true \
    --build-arg NPM_REGISTRY=https://registry.npmmirror.com \
    -t minirouter:latest .

  # 2. Push current branch (so server can pull)
  echo "[2/3] Pushing to git..."
  git push origin HEAD

  # 3. Copy image + deploy on server
  echo "[3/3] Deploying to server..."
  docker save minirouter:latest | gzip > /tmp/minirouter-latest.tar.gz
  scp -P "${SSH_PORT}" /tmp/minirouter-latest.tar.gz "${SSH_DEST}:/tmp/"
  rm -f /tmp/minirouter-latest.tar.gz

  do_ssh "${SSH_DEST}" <<'REMOTE_SCRIPT'
set -euo pipefail

# Source directory on server
SRC_DIR="/opt/minirouter-src"

# Pull latest code
cd "${SRC_DIR}"
git fetch origin
git reset --hard origin/main

# Load the new image
docker load < /tmp/minirouter-latest.tar.gz
rm -f /tmp/minirouter-latest.tar.gz

# Stop and remove old container
docker stop minirouter 2>/dev/null || true
docker rm minirouter 2>/dev/null || true

# Recreate container with the same settings
docker run -d \
  --name minirouter \
  --restart unless-stopped \
  -p 8402:8402 \
  -v /opt/minirouter-data:/data \
  --env-file "${SRC_DIR}/.env" \
  minirouter:latest

echo "  Container started. Checking health..."
sleep 3
docker ps --filter name=minirouter --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
REMOTE_SCRIPT

  echo ""
  echo "✅ Deploy complete!"
  echo "   Logs: docker logs -f minirouter"

else
  # ── Local / on-server mode ────────────────────────────────────
  echo "=========================================="
  echo " MiniRouter Deploy (local)"
  echo "=========================================="

  echo "[1/2] Building Docker image..."
  docker build --build-arg USE_CHINA_MIRROR=true \
    --build-arg NPM_REGISTRY=https://registry.npmmirror.com \
    -t minirouter:latest .

  echo "[2/2] Recreating container..."
  docker stop minirouter 2>/dev/null || true
  docker rm minirouter 2>/dev/null || true

  docker run -d \
    --name minirouter \
    --restart unless-stopped \
    -p 8402:8402 \
    -v /opt/minirouter-data:/data \
    --env-file "$(pwd)/.env" \
    minirouter:latest

  sleep 3
  docker ps --filter name=minirouter --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
  echo ""
  echo "✅ Deploy complete!"
  echo "   Logs: docker logs -f minirouter"
fi