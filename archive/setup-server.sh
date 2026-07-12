#!/usr/bin/env bash
set -euo pipefail

# DEPRECATED: This script sets up systemd + direct Node.js deployment.
# MiniRouter now uses Docker as the primary deployment method.
# See docker-compose.yml and deploy/deploy.sh for the Docker workflow.
#
# ============================================================
# Usage: chmod +x setup-server.sh && sudo ./setup-server.sh
#
# Environment variables you can override before running:
#   MINIROUTER_USER   – system user name   (default: minirouter)
#   MINIROUTER_BRANCH – git branch to clone (default: main)
# ============================================================

MINIROUTER_USER="${MINIROUTER_USER:-minirouter}"
MINIROUTER_HOME="/opt/${MINIROUTER_USER}"
GIT_REPO="https://github.com/lpffernando/minirouter.git"
GIT_BRANCH="${MINIROUTER_BRANCH:-main}"
NODE_MAJOR=22

echo "=========================================="
echo " MiniRouter Server Setup"
echo "=========================================="

# ─── Step 1: System dependencies ──────────────────────────
echo "[1/8] Installing system dependencies..."
apt-get update -qq
apt-get install -y -qq curl gnupg build-essential python3 git

# ─── Step 2: Node.js 22 ───────────────────────────────────
echo "[2/8] Installing Node.js ${NODE_MAJOR}..."
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash -
  apt-get install -y -qq nodejs
fi
echo "  node $(node -v) | npm $(npm -v)"

# ─── Step 3: Create system user ───────────────────────────
echo "[3/8] Creating '${MINIROUTER_USER}' user..."
id -u "${MINIROUTER_USER}" &>/dev/null || useradd --system --create-home \
  --home-dir "${MINIROUTER_HOME}" \
  --shell /usr/sbin/nologin \
  "${MINIROUTER_USER}"

# ─── Step 4: Clone / pull ─────────────────────────────────
echo "[4/8] Cloning repository..."
if [[ -d "${MINIROUTER_HOME}/minirouter/.git" ]]; then
  cd "${MINIROUTER_HOME}/minirouter"
  git fetch origin
  git checkout "${GIT_BRANCH}"
  git pull origin "${GIT_BRANCH}"
else
  git clone --branch "${GIT_BRANCH}" "${GIT_REPO}" "${MINIROUTER_HOME}/minirouter"
fi

# ─── Step 5: .env file ────────────────────────────────────
echo "[5/8] Setting up .env..."
if [[ ! -f "${MINIROUTER_HOME}/minirouter/.env" ]]; then
  cp "${MINIROUTER_HOME}/minirouter/.env.example" "${MINIROUTER_HOME}/minirouter/.env"
  echo "  >>> .env created from .env.example"
  echo "  >>> ⚠️  Edit it NOW: sudo nano ${MINIROUTER_HOME}/minirouter/.env"
  echo "  >>> Set your API keys before starting the service!"
else
  echo "  .env already exists — keeping it"
fi

# ─── Step 6: Install dependencies ─────────────────────────
echo "[6/8] Installing npm dependencies..."
cd "${MINIROUTER_HOME}/minirouter"
npm ci

# ─── Step 7: Build ────────────────────────────────────────
echo "[7/8] Building project (tsup)..."
npm run build
echo "  Build complete: $(ls -la dist/ | wc -l) files in dist/"

# ─── Step 8: Install systemd service ──────────────────────
echo "[8/8] Installing systemd service..."
cp "${MINIROUTER_HOME}/minirouter/deploy/minirouter.service" \
   "/etc/systemd/system/minirouter.service"

# Correct working directory in service file (deploy dir path vs workdir)
sed -i "s|/opt/minirouter|${MINIROUTER_HOME}/minirouter|g" \
  "/etc/systemd/system/minirouter.service"

systemctl daemon-reload

# Fix ownership
chown -R "${MINIROUTER_USER}:${MINIROUTER_USER}" "${MINIROUTER_HOME}"

echo ""
echo "=========================================="
echo " ✅ Setup complete!"
echo "=========================================="
echo ""
echo "下一步:"
echo "  1) 检查 .env:     sudo nano ${MINIROUTER_HOME}/minirouter/.env"
echo "  2) 启动服务:       sudo systemctl enable --now minirouter"
echo "  3) 查看状态:       sudo systemctl status minirouter"
echo "  4) 查看日志:       sudo journalctl -u minirouter -f"
echo ""
echo "服务端口: \$(grep MINIROUTER_PORT ${MINIROUTER_HOME}/minirouter/.env | cut -d= -f2)"
echo "默认: 8402"
echo ""
echo "Optional — Nginx + HTTPS:"
echo "  sudo apt-get install -y nginx certbot python3-certbot-nginx"
echo "  sudo cp deploy/nginx-minirouter.conf /etc/nginx/sites-available/minirouter"
echo "  # edit server_name in the config, then:"
echo "  sudo ln -s /etc/nginx/sites-available/minirouter /etc/nginx/sites-enabled/"
echo "  sudo certbot --nginx -d your-domain.com"
echo "  sudo systemctl reload nginx"
echo ""
