# Report: m8-fix-2 — critic-m8 findings

**Branch**: `m8-deploy`  
**Commit**: `m8-fix-2: fix XFF spoofing ($remote_addr), systemd hardening, README order note`

---

## Changes Made

### FIX 1 — VUL-1 (HIGH): XFF spoofing allows rate limiter bypass
**File**: `deploy/nginx.conf`

Changed the `/agent` location block from:
```nginx
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```
to:
```nginx
proxy_set_header X-Forwarded-For $remote_addr;
```

`$proxy_add_x_forwarded_for` appends `$remote_addr` to any client-supplied `X-Forwarded-For` value, letting attackers inject an arbitrary IP as the leftmost entry. Since `_get_client_ip()` trusts the leftmost entry, an attacker could bypass rate limiting entirely. Using `$remote_addr` exclusively ensures the backend always rate-limits the actual connecting IP (nginx's view), which a client cannot forge.

### FIX 2 — VUL-3 (MEDIUM): systemd unit missing sandbox directives
**File**: `deploy/portfolio-agent.service`

Added to `[Service]` section:
```ini
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/var/www/portfolio
```

- `NoNewPrivileges=yes` — prevents privilege escalation via setuid binaries
- `PrivateTmp=yes` — service gets its own private `/tmp`
- `ProtectSystem=strict` — `/usr`, `/boot`, `/etc` mounted read-only
- `ProtectHome=yes` — home directories inaccessible to the service
- `ReadWritePaths=/var/www/portfolio` — counteracts `ProtectSystem=strict` for the deploy directory the service needs to read/write

### FIX 3 — VUL-6 (LOW): README ordering inconsistency
**File**: `deploy/build.sh`

Updated the "Next steps" comment from:
```
1. Copy .env:  sudo cp /path/to/.env ...
```
to:
```
1. Create .env:  cp deploy/.env.example ...  # then fill in values (see deploy/README.md §2)
```

This aligns the script's guidance with README §2 (create `.env` before running `build.sh`), removing the confusing instruction to copy from an arbitrary path.

---

## Testing

These are configuration/service files — no unit tests applicable. Changes were verified by:
- Manual inspection of `git diff` output confirming each fix is scoped correctly
- Confirmed the `/v1` location block in nginx.conf is intentionally untouched (it proxies a different service and the fix scope was `/agent` only)
- `ProtectSystem=strict` + `ReadWritePaths` pattern is standard systemd hardening per `systemd.exec(5)`

---

## Interfaces / Contracts Affected

- **nginx.conf `/agent` block**: Backend `_get_client_ip()` will now always receive the real client IP in `X-Forwarded-For`. No code change needed on the backend — this is the correct behavior the backend already expects.
- **systemd unit**: No functional change; sandbox directives only restrict attack surface.
- **build.sh**: Documentation/comment change only; no behavior change.
