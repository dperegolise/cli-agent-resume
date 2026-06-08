#!/usr/bin/env bash
# build.sh — Build and deploy the CLI Portfolio
# Usage: bash deploy/build.sh
# Must be run from the repo root as a user with sudo access.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_TARGET="/var/www/portfolio/dist"
DEPLOY_DIR="/var/www/portfolio"

echo "=== CLI Portfolio — Build & Deploy ==="
echo "Repo root: $REPO_ROOT"
echo ""

# ── Frontend build ───────────────────────────────────────────────────────────
echo "=== [1/4] Building frontend ==="
cd "$REPO_ROOT"
npm ci
npm run build

# Quick sanity checks on the build output
ASSET_COUNT=$(ls dist/assets/ 2>/dev/null | wc -l)
echo "Frontend built: dist/ contains ${ASSET_COUNT} files in assets/"

if [ -f "dist/assets/manifest.json" ]; then
    ENTRY_COUNT=$(python3 -c "import json; d=json.load(open('dist/assets/manifest.json')); print(len(d['entries']))" 2>/dev/null || echo "unknown")
    echo "Manifest entries: ${ENTRY_COUNT}"
else
    echo "WARNING: dist/assets/manifest.json not found — www/ may be empty or Vite plugin failed"
fi

# ── Deploy static files ──────────────────────────────────────────────────────
echo ""
echo "=== [2/4] Deploying static files to ${DIST_TARGET} ==="
sudo mkdir -p "$DIST_TARGET"
# rsync --delete ensures stale hashed assets are removed on each deploy
sudo rsync -av --delete dist/ "$DIST_TARGET/"
echo "Static files deployed."

# ── Python backend virtualenv ────────────────────────────────────────────────
echo ""
echo "=== [3/4] Setting up Python virtualenv ==="
cd "$REPO_ROOT"

sudo chown -R "$(whoami)":"$(whoami)" "$DEPLOY_DIR"

if [ ! -d "$DEPLOY_DIR/.venv" ]; then
    echo "Creating new virtualenv at ${DEPLOY_DIR}/.venv"
    python3 -m venv "$DEPLOY_DIR/.venv"
fi

"$DEPLOY_DIR/.venv/bin/pip" install --upgrade pip --quiet
"$DEPLOY_DIR/.venv/bin/pip" install -r backend/requirements.txt --quiet
echo "Backend dependencies installed."

# routr fallback proxy lives in src/routr/
if [ -f "$REPO_ROOT/src/routr/requirements.txt" ]; then
    "$DEPLOY_DIR/.venv/bin/pip" install -r src/routr/requirements.txt --quiet
    echo "routr dependencies installed."
fi

# ── Sync repo code to deploy directory ───────────────────────────────────────
echo ""
echo "=== [4/4] Syncing backend code to ${DEPLOY_DIR} ==="
sudo rsync -av --delete \
    --exclude='.venv/' \
    --exclude='node_modules/' \
    --exclude='dist/' \
    --exclude='.git/' \
    --exclude='.env' \
    --exclude='.env.local' \
    --exclude='__pycache__/' \
    --exclude='*.pyc' \
    "$REPO_ROOT/" "$DEPLOY_DIR/"
echo "Code synced."

echo ""
echo "=== Done! ==="
echo ""
echo "Next steps (first deploy only):"
echo "  1. Copy .env:         sudo cp /path/to/.env ${DEPLOY_DIR}/.env"
echo "  2. Install service:   sudo cp deploy/portfolio-agent.service /etc/systemd/system/"
echo "                        sudo systemctl daemon-reload"
echo "                        sudo systemctl enable --now portfolio-agent"
echo "  3. Configure nginx:   sudo cp deploy/nginx.conf /etc/nginx/sites-available/portfolio"
echo "                        sudo ln -s /etc/nginx/sites-available/portfolio /etc/nginx/sites-enabled/"
echo "                        sudo nginx -t && sudo systemctl reload nginx"
echo ""
echo "For subsequent deploys:"
echo "  bash deploy/build.sh && sudo systemctl restart portfolio-agent"
echo ""
echo "See deploy/README.md for full instructions."
