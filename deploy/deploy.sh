#!/usr/bin/env bash
# MiniRouter deploy — uploads source to the server and recreates the
# container via docker compose. Secrets stay on the server's .env
# (gitignored); this script only needs SSH creds from the local .env.
#
# Local .env (gitignored) must define:
#   MINIROUTER_SSH_HOST, MINIROUTER_SSH_PORT, MINIROUTER_SSH_USER,
#   MINIROUTER_SSH_PASSWORD   (the password is optional if using SSH keys)
#
# Usage: ./deploy/deploy.sh [remote-dir]
set -euo pipefail
cd "$(dirname "$0")/.."

REMOTE_DIR="${1:-/opt/minirouter-src}"
if [ -f .env ]; then set -a; source .env; set +a; fi

HOST="${MINIROUTER_SSH_HOST:?set MINIROUTER_SSH_HOST in .env}"
PORT="${MINIROUTER_SSH_PORT:-22}"
USER="${MINIROUTER_SSH_USER:-root}"
PASS="${MINIROUTER_SSH_PASSWORD:-}"

# SSH transport: use sshpass when a password is provided, else SSH keys.
SSH_OPTS=(-p "$PORT" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null)
if [ -n "$PASS" ]; then
  if ! command -v sshpass >/dev/null 2>&1; then
    echo "sshpass is required for password auth (MINIROUTER_SSH_PASSWORD)." >&2
    echo "Install it (e.g. apt-get install sshpass) or switch to SSH keys." >&2
    exit 1
  fi
  SSH=("sshpass" "-p" "$PASS" "ssh")
else
  SSH=(ssh)
fi

echo "[1/3] Packing source (excl node_modules/.git/.env)..."
tar -czf - --exclude=node_modules --exclude=.git --exclude=.env \
  --exclude='*.db' --exclude=dist --exclude=logs --exclude=.tmp \
  --exclude=.tmp-e2e --exclude=.worktrees . | \
  "${SSH[@]}" "${SSH_OPTS[@]}" "${USER}@${HOST}" \
  "set -e; mkdir -p ${REMOTE_DIR}; tar -xzf - -C ${REMOTE_DIR}"

echo "[2/3] Building + recreating container via docker compose..."
"${SSH[@]}" "${SSH_OPTS[@]}" "${USER}@${HOST}" \
  "cd ${REMOTE_DIR} && docker compose up -d --build --force-recreate"

echo "[3/3] Status:"
"${SSH[@]}" "${SSH_OPTS[@]}" "${USER}@${HOST}" \
  "docker ps --filter name=minirouter --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'"

echo "Done."
