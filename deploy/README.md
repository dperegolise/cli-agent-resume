# CLI Portfolio — Deployment Guide

This document covers deploying the CLI Portfolio to a Linux VPS running nginx, systemd, and a
pre-existing `routr` instance on `:8000`.

---

## Topology

```
internet
    │
    ▼
nginx (reverse proxy, TLS termination)
    ├── /        → /var/www/portfolio/dist/    (Vite static build)
    ├── /agent   → FastAPI :8001               (SSE streaming, LangChain agent)
    └── /v1      → routr :8000                 (existing live routr instance)
```

---

## 1. Prerequisites

| Requirement | Minimum version | Notes |
|-------------|-----------------|-------|
| Linux VPS | Ubuntu 22.04+ / Debian 12+ | Any systemd-based distro |
| nginx | 1.18+ | `apt install nginx` |
| Python | 3.11+ | 3.12 recommended |
| Node.js | 20+ | For `npm ci` and `npm run build` |
| npm | 9+ | Ships with Node.js 20 |
| routr | live | Must already be running on `127.0.0.1:8000` |
| sudo access | — | For nginx config, systemd units, `/var/www/` |
| rsync | any | For syncing built artifacts |

Check versions:
```bash
python3 --version   # must be 3.11+
node --version      # must be 20+
npm --version
nginx -v
```

---

## 2. Environment Setup

Create `/var/www/portfolio/.env`:

```bash
sudo mkdir -p /var/www/portfolio
sudo nano /var/www/portfolio/.env
```

Paste and fill in:

```bash
# ── Model cascade API keys ──────────────────────────────────────────────────
# OpenRouter (first-priority provider; free-tier models available)
OPENROUTER_API_KEY=sk-or-v1-...
# Comma-separated list of model IDs to try (in order)
OPENROUTER_MODELS=mistralai/mistral-7b-instruct:free,meta-llama/llama-3-8b-instruct:free

# HuggingFace Inference API (second-priority provider)
HF_API_KEY=hf_...
HF_MODELS=mistralai/Mistral-7B-Instruct-v0.2

# ── routr (existing live instance on this host) ─────────────────────────────
ROUTR_URL=http://127.0.0.1:8000

# ── Rate limiting ───────────────────────────────────────────────────────────
# Max requests per IP per 60-second sliding window before ban
AGENT_RATE_LIMIT=20
# How long a banned IP stays banned (hours)
AGENT_BAN_DURATION_HOURS=24
```

Protect the file — it contains API keys:
```bash
sudo chmod 600 /var/www/portfolio/.env
sudo chown www-data:www-data /var/www/portfolio/.env
```

---

## 3. Build and Deploy Frontend

From the repo root:

```bash
bash deploy/build.sh
```

The script:
1. Runs `npm ci && npm run build` — produces `dist/` with hashed assets and `dist/assets/manifest.json`
2. `rsync`s `dist/` → `/var/www/portfolio/dist/` (with `--delete` to remove stale assets)
3. Creates/updates a Python virtualenv at `/var/www/portfolio/.venv`
4. Installs `backend/requirements.txt` (and `src/routr/requirements.txt` if present)
5. Syncs backend Python code to `/var/www/portfolio/`

> **First run**: the script will prompt for your `sudo` password when syncing files.

---

## 4. Install and Start the Backend systemd Service

```bash
sudo cp deploy/portfolio-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now portfolio-agent
sudo systemctl status portfolio-agent
```

Expected output from `status`:
```
● portfolio-agent.service - Portfolio Agent Backend
     Loaded: loaded (/etc/systemd/system/portfolio-agent.service; enabled; ...)
     Active: active (running) since ...
   Main PID: 12345 (uvicorn)
```

**View live logs**:
```bash
sudo journalctl -u portfolio-agent -f
```

**Restart after code changes**:
```bash
sudo systemctl restart portfolio-agent
```

The unit file (`deploy/portfolio-agent.service`) configures:
- **User**: `www-data` (same as nginx)
- **WorkingDirectory**: `/var/www/portfolio`
- **EnvironmentFile**: `/var/www/portfolio/.env` (API keys loaded here)
- **Port**: `127.0.0.1:8001` (only accessible via nginx proxy)
- **Restart policy**: `on-failure` with 5s delay

---

## 5. Configure nginx

```bash
# Install config
sudo cp deploy/nginx.conf /etc/nginx/sites-available/portfolio

# Enable site
sudo ln -s /etc/nginx/sites-available/portfolio /etc/nginx/sites-enabled/portfolio

# Remove default site if still present
sudo rm -f /etc/nginx/sites-enabled/default

# Verify config
sudo nginx -t

# Reload nginx (no downtime)
sudo systemctl reload nginx
```

Before reloading, optionally update the `server_name` directive in `nginx.conf` to your domain:
```bash
sudo nano /etc/nginx/sites-available/portfolio
# Change:  server_name _;
# To:      server_name yourdomain.com www.yourdomain.com;
```

**Key nginx settings for SSE** (already in `nginx.conf`):
- `proxy_buffering off` — tokens stream immediately to the browser
- `proxy_read_timeout 300s` — long timeout for slow model providers
- `add_header X-Accel-Buffering no` — disables buffering at CDN/upstream level
- `chunked_transfer_encoding on` — required for SSE over HTTP/1.1

---

## 6. Verify the Deployment

```bash
# ── Backend health ──────────────────────────────────────────────────────────
# FastAPI docs UI (confirms backend is alive)
curl http://localhost:8001/docs
# → Should return HTML (Swagger UI page)

# ── nginx → backend proxy ───────────────────────────────────────────────────
curl http://localhost/agent -X POST \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"hello"}],"session_id":"test-deploy-check"}' \
  -N --no-buffer
# → Should print SSE events:
#   data: {"type": "token", "content": "..."}
#   ...
#   data: {"type": "done"}

# ── Static frontend ─────────────────────────────────────────────────────────
curl -I http://localhost/
# → Should return 200 with HTML

curl -I http://localhost/assets/manifest.json
# → Should return 200 with Content-Type: application/json

# ── routr proxy ─────────────────────────────────────────────────────────────
curl http://localhost/v1/health
# → Should return 200 (routr health endpoint)
```

---

## 7. Updating

After making code changes:

```bash
# 1. Pull latest code
git pull

# 2. Rebuild frontend and sync backend
bash deploy/build.sh

# 3. Restart backend (picks up new Python code)
sudo systemctl restart portfolio-agent

# nginx does not need a restart for frontend changes —
# the new hashed asset filenames are already in the new index.html
```

**Zero-downtime static update**: Vite's content-hashed asset filenames mean users with the old
`index.html` continue to load old assets until they refresh. New visitors get the new build
immediately.

---

## 8. TLS — Let's Encrypt via Certbot

Install Certbot:
```bash
sudo apt install certbot python3-certbot-nginx
```

Issue certificate and auto-configure nginx:
```bash
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

Certbot will:
1. Update `/etc/nginx/sites-available/portfolio` to add `listen 443 ssl` blocks
2. Add the certificate paths and HTTPS redirect
3. Install a cron job for auto-renewal

Verify auto-renewal:
```bash
sudo certbot renew --dry-run
```

After adding TLS, update `OPENROUTER_API_KEY`'s `HTTP-Referer` header in `backend/cascade.py` to
use your `https://` domain so OpenRouter grants higher rate limits.

---

## 9. Directory Layout on the VPS

After a successful deploy:

```
/var/www/portfolio/
├── .env                        ← API keys (chmod 600, owned by www-data)
├── .venv/                      ← Python virtualenv (created by build.sh)
│   └── bin/uvicorn             ← Entry point in systemd unit
├── backend/
│   ├── main.py                 ← FastAPI app
│   ├── agent.py
│   ├── cascade.py
│   ├── limiter.py
│   ├── manifest.py
│   ├── models.py
│   ├── search.py
│   └── tools.py
├── src/
│   └── routr/                  ← Thin completions proxy (fallback)
├── www/                        ← Markdown content files (for search index)
│   ├── index.md
│   ├── about.md
│   ├── contact.md
│   ├── experience/
│   └── projects/
└── dist/                       ← Vite build output (served by nginx)
    ├── index.html
    └── assets/
        ├── manifest.json
        ├── index-[hash].js
        └── index-[hash].css
```

---

## 10. Troubleshooting

### Backend won't start
```bash
# Check logs
sudo journalctl -u portfolio-agent --no-pager -n 50

# Common causes:
# - Missing .env file at /var/www/portfolio/.env
# - Port 8001 already in use: sudo ss -tlnp | grep 8001
# - Python package missing: /var/www/portfolio/.venv/bin/pip list
# - Wrong working directory: confirm /var/www/portfolio/backend/main.py exists
```

### SSE streaming is broken (tokens don't appear until agent finishes)
```bash
# Verify nginx proxy_buffering is off
sudo nginx -T | grep -A5 "location /agent"
# Must show: proxy_buffering off;

# Also check if a CDN or load balancer is in front — those often buffer SSE.
# Solution: add X-Accel-Buffering: no response header (already in nginx.conf).
```

### nginx config test fails
```bash
sudo nginx -t
# Read the error — usually a typo in the conf file or a conflicting site in sites-enabled/
```

### Static files return 404
```bash
ls /var/www/portfolio/dist/
# If empty: re-run `bash deploy/build.sh`

# Check nginx root directive points to the right path
sudo nginx -T | grep root
```

### routr `/v1` proxy returns 502
```bash
# Verify routr is actually running
curl http://127.0.0.1:8000/health
# If not: start or restart the routr service on this host
```

---

## 11. Security Notes

- **No user content is stored** — conversation history lives only in the browser session.
- **Agent system prompt is server-side only** — never sent to the client.
- **IP-based rate limiter**: 20 requests / 60s sliding window; ban on breach (24h by default).
  Ban list is in-memory and resets on server restart — acceptable for VPS, document for ops.
- **`focus_item` paths are validated** against the manifest before any SSE event is emitted.
- **`.env` must not be committed** — it is listed in `.gitignore`.
- Regularly rotate `OPENROUTER_API_KEY` and `HF_API_KEY` if you suspect exposure.

---

*For architecture details see `.teamwork/strategy/strategy-m0.md`.*
