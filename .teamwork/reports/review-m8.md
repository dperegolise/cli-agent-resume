# Review Report: m8-deploy

**Date**: 2026-06-08
**Branch**: m8-deploy
**Verdict**: CHANGES-REQUESTED

## Summary

The four deployment files are well-structured and cover all required deployment surfaces. Three of the four files pass all checklist items cleanly. One REQUIRED bug exists in `build.sh`: the Python virtualenv creation step runs without `sudo` into a directory that is created with `sudo`, making first-run venv creation fail on a fresh VPS. Additionally there are two ADVISORY issues around missing nginx SSE connection hygiene and the HF env var alias discrepancy.

---

## Checklist Results

### `deploy/portfolio-agent.service`

- ✅ User is `www-data` (line 8)
- ✅ ExecStart runs `uvicorn backend.main:app` on `127.0.0.1:8001` (line 11)
- ✅ EnvironmentFile points to `/var/www/portfolio/.env` (line 10)
- ✅ WorkingDirectory is `/var/www/portfolio` (line 9)
- ✅ `Restart=on-failure` with `RestartSec=5` (lines 12-13)
- ✅ `StandardOutput=journal` / `StandardError=journal` (lines 14-15)
- ✅ `Type=simple` (line 7)

All 7 items: **PASS**

---

### `deploy/nginx.conf`

- ✅ Static files served from `dist/` with `try_files $uri $uri/ /index.html` SPA fallback (lines 7-8)
- ✅ `/assets/` has `expires 1y` + `Cache-Control: public, immutable` (lines 11-14)
- ✅ `/index.html` has `Cache-Control: no-cache, no-store, must-revalidate` (lines 17-19)
- ✅ `/agent` proxied to `127.0.0.1:8001` (line 25) — NOT 8000
- ✅ SSE settings on `/agent`: `proxy_buffering off` (line 32), `proxy_read_timeout 300s` (line 36), `add_header X-Accel-Buffering no` (line 40)
- ✅ `/v1` proxied to routr at `127.0.0.1:8000` (lines 47-52)
- ✅ No hardcoded domain: `server_name _` (line 3)

All 7 items: **PASS** (see advisory notes below)

---

### `deploy/build.sh`

- ✅ `set -euo pipefail` at line 5
- ✅ Runs `npm ci && npm run build` (lines 18-19)
- ✅ Rsyncs `dist/` to `/var/www/portfolio/dist/` with `--delete` (lines 36-37)
- ✅ Creates `.venv` and installs `backend/requirements.txt` (lines 45-51)
- ✅ Rsyncs backend Python to `/var/www/portfolio/` (lines 63-72)
- ✅ Excludes `.env` and `.env.local` from rsync (lines 68-69)
- ❌ **`sudo mkdir -p "$DIST_TARGET"` creates `/var/www/portfolio` owned by root, but `python3 -m venv "$DEPLOY_DIR/.venv"` (line 47) runs without `sudo`** — venv creation fails on a fresh VPS.

6/7 items pass.

---

### `deploy/README.md`

- ✅ `OPENROUTER_API_KEY` documented (line 59)
- ✅ HuggingFace key documented as `HF_API_KEY` (line 64) — this is the preferred alias; `cascade.py` accepts both `HF_API_KEY` and `HUGGINGFACE_API_KEY` (line 43 of cascade.py)
- ✅ Instructions for enabling and starting systemd service (section 4, lines 107-129)
- ✅ Instructions for nginx configuration (section 5, lines 141-169)
- ✅ Verify steps with curl commands for each endpoint (section 6, lines 175-203)
- ✅ TLS / certbot section (section 8, lines 232-253)
- ✅ Ports consistent across all files: uvicorn `:8001`, routr `:8000`

All 7 items: **PASS** (see advisory note below)

---

## Findings

### REQUIRED

#### F1 — `build.sh` virtualenv creation fails on fresh VPS due to missing sudo  
**File**: `deploy/build.sh`, lines 44-51  
```bash
# Line 35: sudo mkdir -p "$DIST_TARGET"   <- /var/www/portfolio is created as root:root
# ...
if [ ! -d "$DEPLOY_DIR/.venv" ]; then
    python3 -m venv "$DEPLOY_DIR/.venv"   # line 47: NO sudo — fails if /var/www/portfolio is root-owned
fi
"$DEPLOY_DIR/.venv/bin/pip" install ...  # line 50: also fails for same reason
```
The script uses `sudo mkdir -p "$DIST_TARGET"` which implicitly creates `/var/www/portfolio` owned by `root:root`. The venv creation and pip install then run without `sudo` as the calling user, who has no write permission to a `root`-owned directory.

**Fix**: Either add `sudo chown -R "$(whoami)" "$DEPLOY_DIR"` before the venv block (making the deploy dir user-owned for the duration of the script), or pre-provision the dir with the correct ownership in the README's prerequisites section (`sudo mkdir -p /var/www/portfolio && sudo chown "$(whoami)" /var/www/portfolio`). The README currently only does `sudo mkdir -p /var/www/portfolio` without a `chown` (line 50), so a first-run user following the README exactly will hit this failure.

---

### ADVISORY

#### A1 — nginx `/agent` missing `proxy_set_header Connection ""`  
**File**: `deploy/nginx.conf`, lines 24-44  
When `proxy_http_version 1.1` is set (line 26), nginx by default forwards the client's `Connection` header. For SSE (and especially for clients behind intermediate proxies that set `Connection: close`), adding `proxy_set_header Connection ""` clears that header and ensures the upstream keep-alive connection is used. Without it, a client-sent `Connection: close` propagates to the FastAPI backend and can cause premature stream termination. This is a well-known SSE gotcha in nginx configs.

**Fix**: Add `proxy_set_header Connection "";` inside `location /agent`.

---

#### A2 — README env var name diverges from strategy doc (minor confusion risk)  
**File**: `deploy/README.md`, line 64  
The strategy doc (`strategy-m0.md` lines 983, 1048, 1154) uses `HUGGINGFACE_API_KEY`, but the README documents `HF_API_KEY`. The actual backend (`cascade.py` line 43) accepts **both** via `os.getenv("HF_API_KEY") or os.getenv("HUGGINGFACE_API_KEY")`, so neither name is wrong. However, an operator comparing the strategy doc to the README will see a discrepancy. A comment in the README noting that both aliases are accepted would prevent confusion.

---

### MINOR

#### M1 — nginx `location /agent` is a prefix match, catches `/agentXYZ`  
**File**: `deploy/nginx.conf`, line 24  
`location /agent` is a prefix match; it also intercepts requests like `/agentinfo` or `/agent-test`. The FastAPI backend only exposes `POST /agent` (exact path), so a spurious match just gets a 404 or 405 from FastAPI rather than a security issue. Using `location = /agent` (exact match) or `location ^~ /agent` would be more precise, but this is low-risk given the backend's limited route surface.

---

## Verdict

**CHANGES-REQUESTED**

The one REQUIRED finding (F1 — venv creation fails on fresh VPS) is a concrete bug that prevents a first-time deploy from succeeding as documented. It requires either a one-line `chown` addition to `build.sh` or a README prerequisite step. The advisory items (A1, A2) are good practice but not blockers. Once F1 is resolved, this milestone is ready to merge.
