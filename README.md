# Xian Playground

An interactive Reflex-based web playground for the Xian Contracting engine. Users can author, lint, deploy, and call smart contracts directly in the browser while the backend runs a full `xian-contracting` runtime per session.

## Prerequisites

- Python **3.12** (required by the current `pyproject.toml`, `xian-tech-contracting`, and `xian-tech-linter`).
- [Poetry](https://python-poetry.org/docs/#installation) for dependency management.
- Node.js ≥ 18 **or** Bun ≥ 1.1 (Reflex builds the React frontend via whichever runtime is on your `PATH`).
- A compiler toolchain for any transitive dependencies (e.g., system `make`, `gcc`, `pkg-config`).

## Configuration

Runtime settings are declared directly in `rxconfig.py`. For local development you
can use the stock file:

```python
"""Reflex runtime configuration for the playground app."""

from __future__ import annotations

import reflex as rx

config = rx.Config(
    app_name="playground",
    disable_plugins=["reflex.plugins.sitemap.SitemapPlugin"],
)
```

On the production server we override ports and other flags via CLI arguments (see
“Running the app” below), so the same file works in both environments.

### Environment variables

- `PLAYGROUND_STATE_IMPORT_MAX_BYTES` – Maximum allowed size (in bytes) for uploaded state snapshots.
  Defaults to 10 MB. Lower this if you want to guard a shared deployment against large uploads.
- `PLAYGROUND_ACTIVITY_LOG_MAX_ENTRIES` – Number of activity log entries to retain in memory/client
  state. Defaults to 50. Increase for debugging-heavy sessions; lower to minimize persisted state.
- `PLAYGROUND_SESSION_LOCK_IDLE_SECONDS` – How long (seconds) an unused session metadata lock stays cached
  before being dropped. Defaults to 600 s; lower it if you expect many short-lived sessions.
- `PLAYGROUND_SESSION_LOCK_CACHE` – Maximum number of session metadata locks held in memory at once (default 2048).
  Excess idle locks are evicted LRU-style.
- `PLAYGROUND_SESSION_TTL_SECONDS` – How long (seconds) a session may remain idle on disk before it is
  automatically deleted (default 7 d). Set to 0 to keep sessions forever.
- `PLAYGROUND_WORKER_RPC_TIMEOUT` – Maximum time (seconds) to wait for a worker process to reply to a request.
  Defaults to 30 s. Set to 0 to disable the timeout (not recommended in production).

## Installation

```bash
poetry install
```

The project currently resolves its Xian dependencies as editable sibling checkouts:

- `../xian-contracting` as `xian-tech-contracting`
- `../xian-linter` as `xian-tech-linter`
- `../xian-py` as `xian-tech-py`

Keep those repositories present next to `xian-playground-web` when working from source.

## Contract naming

- User-submitted contracts now follow current `submission` contract rules: names must start with `con_`.
- All contract names must stay lowercase and may contain only ASCII letters, digits, and underscores, up to 64 characters.
- The only exception is when the sandbox signer is explicitly set to `sys`, which mirrors the system-contract path in `xian-contracting`.

## Running the app

### Local development

```bash
poetry run reflex run
```

This launches the Vite dev server with hot reload plus a single backend worker.
The terminal prints the URLs it binds to (typically `http://localhost:3000`).

### Production (single-port recommended)

```bash
poetry run reflex run --env prod --single-port --frontend-port 8001 --backend-port 8001
```

- A single Granian process serves both the static bundle and websocket/events on port **8001** (adjust as needed).
- Keep this process alive (or run it via `systemd`; see below). If the port is already bound you will see a startup error.

### Production (split ports)

```bash
poetry run reflex run --env prod
```

- Frontend Sirv server listens on **3000**, backend on **8000**.
- Use the split-port nginx config below so `/` goes to 3000 and only the socket/API endpoints hit 8000.

### Development mode

```bash
poetry run reflex run --env dev
```

This launches the Vite dev server with hot reload and a single backend worker on whatever open ports Reflex negotiates.

## Reverse proxy / deployment notes

- For **single-port** deployments, forward every path (including `/_event`) to the chosen backend port and enable websocket headers.
- For **split-port** deployments, send `/` to port 3000 and proxy only `/_event` + `/sessions` to port 8000 with `proxy_http_version 1.1`, `Upgrade`, and `Connection "upgrade"` so the websocket works.
- Add a CSP header that includes `'unsafe-eval'` in `script-src`. Reflex bundles (Monaco, Radix) rely on `new Function`, and blocking it causes hydration failures.
- All session state (contract storage, metadata, UI snapshots) lives under `playground/.sessions/`. Ensure the runtime user can read/write this directory and monitor it for growth.
- Do **not** set `REFLEX_REDIS_URL` unless you also add cross-process locking. The playground’s session manager is intentionally single-process; Redis would cause Reflex to spawn multiple workers and corrupt the per-session filesystem state.

### Example Nginx config (single-port mode)

```nginx
server
{
        server_name playground.xian.technology;

        location /
        {
                proxy_pass http://127.0.0.1:8001;
                proxy_http_version 1.1;
                proxy_set_header Upgrade $http_upgrade;
                proxy_set_header Connection "upgrade";
                proxy_set_header Host $host;
                proxy_set_header X-Real-IP $remote_addr;
                proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
                proxy_set_header X-Forwarded-Proto $scheme;
        }

        listen 443 ssl;
        ssl_certificate /etc/letsencrypt/live/xian.technology/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/xian.technology/privkey.pem;
        include /etc/letsencrypt/options-ssl-nginx.conf;
        ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}

server
{
        if ($host = playground.xian.technology)
        {
                return 301 https://$host$request_uri;
        }
        listen 80;
        server_name playground.xian.technology;
        return 404;
}
```

Reload Nginx after editing: `sudo nginx -s reload`.

### Example Nginx config (split ports)

Use this when running `poetry run reflex run --env prod` without `--single-port`.

```nginx
server {
        server_name playground.xian.technology;

        location /_event {
                proxy_pass http://127.0.0.1:8000;
                proxy_http_version 1.1;
                proxy_set_header Upgrade $http_upgrade;
                proxy_set_header Connection "upgrade";
                proxy_set_header Host $host;
                proxy_set_header X-Real-IP $remote_addr;
                proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
                proxy_set_header X-Forwarded-Proto $scheme;
        }

        location ^~ /sessions {
                proxy_pass http://127.0.0.1:8000;
                proxy_set_header Host $host;
                proxy_set_header X-Real-IP $remote_addr;
                proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
                proxy_set_header X-Forwarded-Proto $scheme;
        }

        location / {
                proxy_pass http://127.0.0.1:3000;
                proxy_set_header Host $host;
                proxy_set_header X-Real-IP $remote_addr;
                proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
                proxy_set_header X-Forwarded-Proto $scheme;
        }

        listen 443 ssl;
        ssl_certificate /etc/letsencrypt/live/xian.technology/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/xian.technology/privkey.pem;
        include /etc/letsencrypt/options-ssl-nginx.conf;
        ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}

server {
        if ($host = playground.xian.technology) {
                return 301 https://$host$request_uri;
        }
        listen 80;
        server_name playground.xian.technology;
        return 404;
}
```

### systemd unit

To keep the playground running after boot, install a service such as (uses the single-port 8001 command—adjust if you choose different ports or the split-port mode):
`/etc/systemd/system/xian-playground.service`

```
[Unit]
Description=Xian Playground
After=network.target

[Service]
Type=simple
User=endogen
WorkingDirectory=/home/endogen/xian-playground
Environment="PATH=/home/endogen/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/home/endogen/.cache/pypoetry/virtualenvs/xian-playground--o3SVNIl-py3.11/bin"
ExecStart=/home/endogen/.local/bin/poetry run reflex run --env prod --single-port --frontend-port 8001 --backend-port 8001
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```
sudo systemctl daemon-reload
sudo systemctl enable --now xian-playground
```

Use `journalctl -u xian-playground -f` to follow logs.

## Testing

Run the fast unit suite before committing changes:

```bash
poetry run pytest tests/unit
```

Use `poetry run pytest tests/integration -k <pattern>` when touching runtime, storage, or session logic.

## Troubleshooting

- Missing env vars: `rxconfig.py` raises a `RuntimeError` naming the missing key. Double-check `.env`.
- Frontend build errors: verify Node/Bun are installed and run `poetry run reflex run --env prod --frontend-only` to see the raw logs inside `.web/`.
- Session cookie not set: confirm `PLAYGROUND_SESSION_COOKIE_SECURE=1` when serving through HTTPS; browsers discard insecure cookies on secure origins.

With the prerequisites satisfied and `.env` configured, the playground can be started locally or deployed on a server by copying the repository and running the single command `poetry run reflex run --env prod`. Front the two internal ports with your preferred process manager and reverse proxy to make it available at `https://playground.xian.technology`.
