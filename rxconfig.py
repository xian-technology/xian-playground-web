"""Reflex runtime configuration for the playground app."""

from __future__ import annotations

import os

import reflex as rx


# Disable SSR/prerendered HTML to avoid hydration mismatches behind the proxy.
os.environ.setdefault("REFLEX_SSR", "0")


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw, 0)
    except ValueError:
        return default

FRONTEND_PORT = _env_int("PLAYGROUND_FRONTEND_PORT", 3000)
BACKEND_PORT = _env_int("PLAYGROUND_BACKEND_PORT", 8000)

config = rx.Config(
    app_name="playground",
    frontend_port=FRONTEND_PORT,
    backend_port=BACKEND_PORT,
    deploy_url=os.getenv("PLAYGROUND_DEPLOY_URL", f"http://localhost:{FRONTEND_PORT}"),
    api_url=os.getenv("PLAYGROUND_API_URL", f"http://localhost:{BACKEND_PORT}"),
    show_built_with_reflex=False,
    disable_plugins=[rx.plugins.SitemapPlugin()],
)
