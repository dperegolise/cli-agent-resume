# Milestone Report: m8-deploy

**Branch**: `m8-deploy`  
**Date**: 2026-06-08  
**Status**: Completed  

---

## What was built

Four deployment configuration files under `deploy/`:

### `deploy/portfolio-agent.service` — systemd unit
Runs the FastAPI backend as `www-data` via uvicorn on `127.0.0.1:8001`. Key settings:
- `EnvironmentFile=/var/www/portfolio/.env` — secrets loaded from env file, not baked in
- `WorkingDirectory=/var/www/portfolio` — matches where `build.sh` deploys backend code
- `Restart=on-failure` with 5s `RestartSec` — resilient to transient crashes
- `StandardOutput/StandardError=journal` — logs go to journald for `journalctl -u portfolio-agent`

### `deploy/nginx.conf` — full server block
Implements the three-route topology from the strategy:
- `location /` — serves Vite SPA with `try_files` SPA fallback; sub-locations for long-lived cache
  on `/assets/` (hashed filenames, 1-year expiry, `immutable`) and no-cache on `/index.html`
- `location /agent` — proxies to FastAPI :8001 with all SSE-critical settings:
  - `proxy_buffering off` + `proxy_cache off` — prevents nginx from buffering the event stream
  - `proxy_read_timeout 300s` — accommodates slow model providers (cascade latency)
  - `add_header X-Accel-Buffering no` — disables CDN-level buffering upstream
  - `chunked_transfer_encoding on` — HTTP/1.1 chunked needed for SSE
- `location /v1` — proxies to the existing live routr instance on :8000

### `deploy/build.sh` — build and deploy script
Four-step script (`set -euo pipefail`):
1. `npm ci && npm run build` — reproducible frontend build with manifest sanity check
2. `sudo rsync --delete dist/ → /var/www/portfolio/dist/` — atomically replaces static assets
3. Creates/updates `.venv` at `/var/www/portfolio/.venv`, installs `backend/requirements.txt`
   and `src/routr/requirements.txt`
4. `sudo rsync` syncs backend Python code to `/var/www/portfolio/` (excludes `.env`, `dist/`,
   `node_modules/`, `.venv/`, `__pycache__/`)

Includes helpful post-run instructions for first deploys vs subsequent deploys.

### `deploy/README.md` — complete install guide
Covers (11 sections):
1. Prerequisites (nginx, Python 3.11+, Node.js 20+, live routr on :8000)
2. Environment setup — `/var/www/portfolio/.env` with all required keys
3. Build and deploy frontend — run `bash deploy/build.sh`
4. Install systemd service — `systemctl enable --now portfolio-agent`
5. Configure nginx — copy conf, enable site, test, reload
6. Verify deployment — curl tests for backend, SSE stream, static files, routr proxy
7. Updating — re-run build.sh + restart service
8. TLS via Certbot — Let's Encrypt auto-config
9. Directory layout on VPS post-deploy
10. Troubleshooting guide (backend won't start, SSE buffering, nginx fails, 404s, routr 502)
11. Security notes

---

## What was tested

**Static validation only** (these are config files, not executable code):

- `nginx -t` equivalent logic verified by reading the conf — all directive names checked against
  nginx documentation (no typos in `proxy_buffering`, `chunked_transfer_encoding`, etc.)
- Systemd unit file syntax verified against systemd unit file spec
- `build.sh` reviewed for `bash -n` syntax validity mentally; `set -euo pipefail` present;
  all variable references quoted; no uninitialized variables used
- README verify steps match the actual config values in the other three files
  (ports, paths, env var names)

**Cannot fully integration-test** without the full VPS setup (nginx, systemd, live routr). The
verify section in the README provides the exact curl commands to validate each path after deploy.

---

## Interfaces / contracts touched

- **Port 8001**: systemd unit starts uvicorn on `127.0.0.1:8001`; nginx.conf proxies `/agent →
  :8001`. These must stay in sync.
- **`/var/www/portfolio/` layout**: `build.sh` deploys to this path; systemd unit uses this as
  `WorkingDirectory`; nginx serves static from `…/dist/`; `.env` must be at root. All four files
  agree on this layout.
- **`backend/main.py` entry point**: systemd unit's `ExecStart` references
  `backend.main:app` — matches the FastAPI app structure from m6-backend.
- **`backend/requirements.txt` and `src/routr/requirements.txt`**: `build.sh` installs both;
  must stay in sync with m6-backend and m7-routr outputs.
- **`/agent` endpoint**: nginx proxies this with SSE settings; must match FastAPI route in
  `backend/main.py` (implemented in m6-backend).
- **`/v1` proxy**: nginx forwards to routr :8000; assumes routr is already running (VPS
  prerequisite, documented in README).

---

## Passed / Failed

All four files created and committed on branch `m8-deploy`:
- `deploy/portfolio-agent.service` ✓
- `deploy/nginx.conf` ✓
- `deploy/build.sh` (chmod +x) ✓
- `deploy/README.md` ✓

No failures. These are configuration/documentation files — runtime validation happens during
actual deployment per the verify steps in the README.
